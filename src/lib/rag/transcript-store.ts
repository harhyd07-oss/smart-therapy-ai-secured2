import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import type { TranscriptChunk } from './types'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

const db = getFirestore()

// Therapist-only session data (notes, aiInsight, copilotEvents). Kept off the
// member-readable sessions/{id} doc; firestore.rules lets only the session's
// therapist read it.
function therapistPrivateRef(sessionId: string) {
  return db.collection('sessions').doc(sessionId).collection('private').doc('therapist')
}

export async function appendTranscriptChunk(
  sessionId: string,
  chunk: TranscriptChunk
): Promise<void> {
  const ref = db.collection('sessions').doc(sessionId)

  await ref.set(
    {
      transcript: FieldValue.arrayUnion({
        text: chunk.text,
        speaker: chunk.speaker,
        timestamp: chunk.timestamp,
        sessionMinute: chunk.sessionMinute,
      }),
      transcriptLastUpdated: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
}

export async function getSessionTranscript(
  sessionId: string
): Promise<TranscriptChunk[]> {
  const ref = db.collection('sessions').doc(sessionId)
  const doc = await ref.get()
  if (!doc.exists) return []
  return (doc.data()?.transcript ?? []) as TranscriptChunk[]
}

export async function deleteSessionTranscript(
  sessionId: string
): Promise<void> {
  const ref = db.collection('sessions').doc(sessionId)
  const doc = await ref.get()
  if (!doc.exists) return
  await ref.update({
    transcript: FieldValue.delete(),
    transcriptLastUpdated: FieldValue.delete(),
  })
}

export async function checkAIConsent(
  sessionId: string
): Promise<boolean> {
  const ref = db.collection('sessions').doc(sessionId)
  const doc = await ref.get()
  if (!doc.exists) return false
  const consent = doc.data()?.aiConsent
  return consent?.therapist === true && consent?.client === true
}

export interface SessionActivity {
  // Human-readable summaries of what happened inside therapy modules this session.
  moduleEvents: string[]
  // The therapist's in-call typed notes (optional — often empty).
  inCallNotes: string[]
}

// Pull the in-session activity timeline (from `sessions/{id}`) and the in-call
// notes (from its private/therapist doc). Feeds the copilot so suggestions
// account for what was actually DONE, not just what was said.
export async function getSessionActivity(
  sessionId: string
): Promise<SessionActivity> {
  const [doc, priv] = await Promise.all([
    db.collection('sessions').doc(sessionId).get(),
    therapistPrivateRef(sessionId).get(),
  ])
  const d = doc.exists ? doc.data() ?? {} : {}
  const p = priv.exists ? priv.data() ?? {} : {}
  const moduleEvents = Array.isArray(d.moduleEvents)
    ? (d.moduleEvents as Array<{ detail?: unknown }>)
        .map(e => (typeof e?.detail === 'string' ? e.detail : ''))
        .filter(Boolean)
    : []
  const inCallNotes = Array.isArray(p.therapistNotes)
    ? (p.therapistNotes as Array<{ content?: unknown }>)
        .map(n => (typeof n?.content === 'string' ? n.content : ''))
        .filter(Boolean)
    : []
  return { moduleEvents, inCallNotes }
}

export interface CopilotEventLog {
  timestamp: number
  summary: string
  module: string
  riskFlag: boolean
  riskLevel: string
  riskDetail: string
}

// The latest copilot insight (including riskDetail), for the therapist's panel.
export async function saveAIInsight(sessionId: string, insight: unknown): Promise<void> {
  await therapistPrivateRef(sessionId).set(
    {
      aiInsight: insight,
      aiInsightGeneratedAt: new Date().toISOString(),
    },
    { merge: true }
  )
}

// Lightweight audit trail of every copilot suggestion the therapist requested.
// Append-only on the therapist-private doc so it survives alongside the
// transcript and can later feed the end-of-session report ("copilot flagged a
// concern at 14:32"). Carries riskDetail, so the client must never see it.
// Fire-and-forget: a logging failure must never break the live copilot.
export async function appendCopilotEvent(
  sessionId: string,
  event: CopilotEventLog
): Promise<void> {
  try {
    await therapistPrivateRef(sessionId).set(
      {
        copilotEvents: FieldValue.arrayUnion(event),
        copilotEventsLastUpdated: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
  } catch (e) {
    console.warn('[transcript-store] Failed to log copilot event:', e)
  }
}

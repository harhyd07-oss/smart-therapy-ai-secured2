// One-off backfill for the tightened live-session rules (firestore.rules).
//
// MUST BE RUN (with --apply) BEFORE those rules are deployed. The new rules
// fail closed on documents that lack the fields below, so without it:
//   - existing sessions: both members are refused any update (consent, transcript)
//   - existing patients: every therapist loses access to quests
//   - existing sessions: therapist-only data stays readable by the client
//
// WHAT IT DOES, per Postgres Session row (the trusted source — the same
// relationship src/lib/session-provisioning.ts mirrors on every join):
//
//   1. liveSessions/{id}  — if the doc exists, set therapistUid / clientUid.
//                           Nothing else on the doc is touched. Missing docs are
//                           skipped; provisioning creates them on next join.
//   2. sessions/{id}      — if the doc holds any therapist-only field
//                           (therapistNotes, therapistNotesLastUpdated,
//                           aiInsight, aiInsightGeneratedAt, riskDetail,
//                           copilotEvents, copilotEventsLastUpdated), copy them
//                           into sessions/{id}/private/therapist and delete them
//                           from sessions/{id}, in ONE transaction. Array fields
//                           (therapistNotes, copilotEvents) are merged with any
//                           entries already in the private doc, never replaced.
//                           Other fields on either doc are left as they are.
//   3. patients/{clientUid} — arrayUnion the therapist's uid into
//                           therapistUids (creates the doc with only that field
//                           if absent). Never removes an existing entry.
//
// ASSUMPTIONS
//   - A therapist "treats" a patient if Postgres has at least one Session
//     between them (any status). That is the relationship provisioning uses.
//   - ProfileTherapist.userId / ProfileClient.userId are Firebase UIDs.
//   - Firestore sessions/liveSessions docs whose id matches no Postgres Session
//     are NOT touched (no trusted owner); they are counted and listed.
//   - Revocation is out of scope: a therapist is never removed from
//     therapistUids, matching provisioning's arrayUnion.
//
// SAFE TO RE-RUN: every step is a no-op once applied (fields already set,
// nothing left to move, arrayUnion of an existing uid).
//
// Dry run by default — prints what it WOULD do and writes nothing:
//   node --env-file=.env scripts/backfill-session-privacy.mjs
// Apply:
//   node --env-file=.env scripts/backfill-session-privacy.mjs --apply
//
// Check FIREBASE_PROJECT_ID and DATABASE_URL in .env point at the environment
// you mean to migrate before using --apply.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { PrismaClient } from '@prisma/client'

const apply = process.argv.includes('--apply')

const PRIVATE_FIELDS = [
  'therapistNotes',
  'therapistNotesLastUpdated',
  'aiInsight',
  'aiInsightGeneratedAt',
  'riskDetail',
  'copilotEvents',
  'copilotEventsLastUpdated',
]
const ARRAY_FIELDS = new Set(['therapistNotes', 'copilotEvents'])

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
})
const db = getFirestore(app)
const prisma = new PrismaClient()

console.log(
  `Firebase project: ${process.env.FIREBASE_PROJECT_ID} — ${apply ? 'APPLYING CHANGES' : 'dry run (no writes)'}`
)

const sessions = await prisma.session.findMany({
  select: {
    id: true,
    therapist: { select: { userId: true } },
    client: { select: { userId: true } },
  },
})
console.log(`${sessions.length} sessions in Postgres\n`)

const counts = { seats: 0, moved: 0, patientLinks: 0, noUids: 0, failed: 0 }
const patientPairs = new Map() // clientUid -> Set(therapistUid)

for (const s of sessions) {
  const therapistUid = s.therapist?.userId || null
  const clientUid = s.client?.userId || null
  if (!therapistUid || !clientUid) {
    console.warn(`  session ${s.id}: missing therapist or client uid — skipped`)
    counts.noUids++
    continue
  }

  try {
    // 1. Seats on the live room.
    const liveRef = db.collection('liveSessions').doc(s.id)
    const live = await liveRef.get()
    if (live.exists) {
      const d = live.data()
      if (d.therapistUid !== therapistUid || d.clientUid !== clientUid) {
        if (apply) await liveRef.update({ therapistUid, clientUid })
        console.log(`  ${apply ? 'set' : 'would set'} seats on liveSessions/${s.id}`)
        counts.seats++
      }
    }

    // 2. Move therapist-only fields off the shared session doc.
    const sessionRef = db.collection('sessions').doc(s.id)
    const privateRef = sessionRef.collection('private').doc('therapist')
    const moved = await db.runTransaction(async (tx) => {
      const [snap, privSnap] = await Promise.all([tx.get(sessionRef), tx.get(privateRef)])
      if (!snap.exists) return []
      const d = snap.data()
      const present = PRIVATE_FIELDS.filter((f) => f in d)
      if (present.length === 0) return []
      if (!apply) return present

      const existing = privSnap.exists ? privSnap.data() : {}
      const toPrivate = {}
      const toDelete = {}
      for (const f of present) {
        if (ARRAY_FIELDS.has(f) && Array.isArray(d[f])) {
          // Merge, never replace, anything already in the private doc.
          toPrivate[f] = [...(Array.isArray(existing[f]) ? existing[f] : []), ...d[f]]
        } else if (!(f in existing)) {
          // Scalars: the private doc wins if it already has a (newer) value.
          toPrivate[f] = d[f]
        }
        toDelete[f] = FieldValue.delete()
      }
      tx.set(privateRef, toPrivate, { merge: true })
      tx.update(sessionRef, toDelete)
      return present
    })
    if (moved.length) {
      console.log(`  ${apply ? 'moved' : 'would move'} [${moved.join(', ')}] on sessions/${s.id}`)
      counts.moved++
    }

    if (!patientPairs.has(clientUid)) patientPairs.set(clientUid, new Set())
    patientPairs.get(clientUid).add(therapistUid)
  } catch (e) {
    console.error(`  FAILED for session ${s.id}:`, e.message)
    counts.failed++
  }
}

// 3. Patient → therapist links.
for (const [clientUid, therapistUids] of patientPairs) {
  try {
    const ref = db.collection('patients').doc(clientUid)
    const snap = await ref.get()
    const have = new Set(snap.exists ? snap.data().therapistUids ?? [] : [])
    const add = [...therapistUids].filter((u) => !have.has(u))
    if (add.length === 0) continue
    if (apply) await ref.set({ therapistUids: FieldValue.arrayUnion(...add) }, { merge: true })
    console.log(`  ${apply ? 'linked' : 'would link'} ${add.length} therapist(s) to patients/${clientUid}`)
    counts.patientLinks++
  } catch (e) {
    console.error(`  FAILED for patient ${clientUid}:`, e.message)
    counts.failed++
  }
}

// Report Firestore session docs with no Postgres owner (left untouched).
const known = new Set(sessions.map((s) => s.id))
const orphans = (await db.collection('sessions').listDocuments()).filter((r) => !known.has(r.id))
if (orphans.length) {
  console.warn(`\n${orphans.length} sessions/* doc(s) have no Postgres Session and were NOT touched:`)
  for (const r of orphans) console.warn(`  sessions/${r.id}`)
}

const verb = apply ? '' : ' (would change)'
console.log(
  `\ndone${verb} — seats: ${counts.seats}, sessions moved: ${counts.moved}, ` +
    `patients linked: ${counts.patientLinks}, skipped (no uid): ${counts.noUids}, failed: ${counts.failed}`
)
await prisma.$disconnect()

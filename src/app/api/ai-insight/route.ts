import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { runAnalysis } from '@/lib/rag/analysis'
import { checkAIConsent, getSessionTranscript, appendCopilotEvent, saveAIInsight } from '@/lib/rag/transcript-store'
import { requireTherapist } from '@/lib/progressAuth'
import type { ClientProfile } from '@/lib/rag/retrieval'
import type { AIInsight } from '@/lib/rag/types'

export async function POST(request: Request) {
  try {
    // Identity comes from the verified Firebase token only. Any therapistId in
    // the body is ignored.
    const auth = await requireTherapist(request)
    if (!auth.ok) return auth.response
    const therapistId = auth.uid

    const body = await request.json()
    const { sessionId, clientProfile, transcriptWindowMinutes } = body

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json(
        { error: 'sessionId is required and must be a string' },
        { status: 400 }
      )
    }

    // Only the session's own therapist. 404 (not 403) so another therapist
    // can't probe which session ids exist.
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { therapistId: true },
    })
    if (!session || session.therapistId !== auth.therapist.id) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    if (!clientProfile || typeof clientProfile !== 'object') {
      return NextResponse.json(
        { error: 'clientProfile is required and must be an object' },
        { status: 400 }
      )
    }

    const profile: ClientProfile = {
      clientId: String(clientProfile.clientId ?? ''),
      name: String(clientProfile.name ?? 'Unknown'),
      age: Number(clientProfile.age ?? 0),
      conditions: Array.isArray(clientProfile.conditions)
        ? clientProfile.conditions.map(String)
        : [],
      sessionNumber: Number(clientProfile.sessionNumber ?? 1),
      therapistId,
    }

    if (!profile.clientId) {
      return NextResponse.json(
        { error: 'clientProfile.clientId is required' },
        { status: 400 }
      )
    }

    // Dev test mode bypasses the both-consent gate so the copilot can be verified
    // solo (matches NEXT_PUBLIC_STT_TEST_MODE used for transcription).
    //
    // Hard-gated to non-production for the same reason as the transcription gate:
    // this path sends session audio transcripts to a third-party LLM, and must
    // not run on a real deployment without both parties having consented,
    // whatever the environment file happens to say.
    const sttTestMode =
      process.env.NEXT_PUBLIC_STT_TEST_MODE === 'true' &&
      process.env.NODE_ENV !== 'production'
    const consent = await checkAIConsent(sessionId)
    if (!consent && !sttTestMode) {
      return NextResponse.json(
        {
          error: 'AI analysis not consented',
          detail: 'Both therapist and client must consent to AI analysis',
        },
        { status: 403 }
      )
    }

    const existingTranscript = await getSessionTranscript(sessionId)
    if (existingTranscript.length === 0) {
      return NextResponse.json(
        { error: 'No transcript data found for this session' },
        { status: 404 }
      )
    }

    const insight: AIInsight = await runAnalysis({
      sessionId,
      therapistId,
      clientProfile: profile,
      transcriptWindowMinutes: transcriptWindowMinutes ?? 5,
    })

    // Therapist-only: sessions/{id}/private/therapist, never the shared doc.
    await saveAIInsight(sessionId, insight)

    // Lightweight append-only audit trail of every copilot suggestion. Survives
    // alongside the transcript so the end-of-session report can reference it
    // (e.g. "copilot flagged a safeguarding concern mid-session"). Never blocks.
    await appendCopilotEvent(sessionId, {
      timestamp: Date.now(),
      summary: insight.summary,
      module: insight.module,
      riskFlag: insight.riskFlag,
      riskLevel: insight.riskLevel ?? 'none',
      riskDetail: insight.riskDetail ?? '',
    })

    // Log AI analysis as a usage event for the admin dashboard. Never block on this.
    try {
      await prisma.usageEvent.create({ data: { therapistId: auth.therapist.id, sessionId, type: 'AI_ANALYSIS' } })
    } catch (e) {
      console.error('Failed to log AI usage event:', e)
    }

    return NextResponse.json({ insight })
  } catch (error: any) {
    console.error('AI insight generation error:', error)
    return NextResponse.json(
      { error: error.message ?? 'Internal server error' },
      { status: 500 }
    )
  }
}

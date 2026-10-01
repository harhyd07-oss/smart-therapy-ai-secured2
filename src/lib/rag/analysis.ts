import { chatJSON, COPILOT_MODEL, extractJSON } from '@/lib/report/openrouter-client'
import { SYSTEM_PROMPT, buildAnalysisPrompt } from './prompt'
import { retrieveRAGContext, type ClientProfile } from './retrieval'
import { maxRisk, runSafetyScan, safetyUnavailableVerdict } from './safety'
import { checkLocalSafety } from './local-safety'
import type { AIInsight } from './types'

const LOCAL_RISK_DETAIL =
  'Possible risk language detected in the client\'s recent speech — review the transcript.'

export interface AnalysisOptions {
  sessionId: string
  therapistId: string
  clientProfile: ClientProfile
  transcriptWindowMinutes?: number
}

export async function runAnalysis(
  options: AnalysisOptions
): Promise<AIInsight> {
  const {
    sessionId,
    therapistId,
    clientProfile,
    transcriptWindowMinutes = 5,
  } = options

  console.log(`[Analysis] Starting for session ${sessionId}`)
  console.log(`[Analysis] Window: ${transcriptWindowMinutes}min`)

  const context = await retrieveRAGContext(
    sessionId,
    therapistId,
    clientProfile,
    transcriptWindowMinutes
  )

  console.log(`[Analysis] Context retrieved — transcript: ${context.transcript.length} chars`)
  console.log(`[Analysis] Study material chunks: ${context.studyMaterial.length}`)
  console.log(`[Analysis] Previous notes: ${context.previousNotes.length}`)

  const userPrompt = buildAnalysisPrompt(context)

  console.log(`[Analysis] Calling OpenRouter (${COPILOT_MODEL}) + parallel safety pass...`)
  const llmStart = Date.now()
  // Two calls in parallel: the main suggestion AND a dedicated safety scan. The
  // safety verdict must not depend on whether the suggestion model noticed the
  // cue, so it runs independently and is merged in. Total latency ≈ the slower
  // of the two, not the sum.
  //
  // allSettled, not all: either call failing must not take the other down with
  // it. In particular a failed safety call must never leave the therapist with
  // no verdict (or a stale one) — it becomes a conservative 'watch' instead.
  const [suggestion, safetyResult] = await Promise.allSettled([
    chatJSON(COPILOT_MODEL, SYSTEM_PROMPT, userPrompt),
    runSafetyScan(context.transcript),
  ])
  const llmDuration = Date.now() - llmStart

  // Error details are deliberately not logged: they can echo request content.
  if (safetyResult.status === 'rejected') {
    console.warn('[Analysis] Safety check failed — using watch fallback')
  }
  if (suggestion.status === 'rejected') {
    console.warn('[Analysis] Suggestion call failed — using fallback insight')
  }
  const safety =
    safetyResult.status === 'fulfilled' ? safetyResult.value : safetyUnavailableVerdict()
  console.log(`[Analysis] LLM + safety responded in ${llmDuration}ms (safety: ${safety.level})`)

  const insight =
    suggestion.status === 'fulfilled'
      ? parseInsight(suggestion.value, transcriptWindowMinutes)
      : fallbackInsight(transcriptWindowMinutes)

  // Local keyword net over the client's lines — independent of both AI calls.
  // It can only raise the level (to 'watch'), never lower it.
  const local = checkLocalSafety(clientLines(context.transcript))

  // The dedicated safety pass is authoritative for risk: a 'watch' or 'urgent'
  // verdict raises the flag even if the suggestion model set riskFlag=false.
  // The final level is the most severe of the AI verdict (or its fallback) and
  // the local check.
  insight.riskLevel = maxRisk(safety.level, local.level)
  insight.riskDetail =
    safety.rationale || (local.level !== 'none' ? LOCAL_RISK_DETAIL : '') || insight.riskDetail || ''
  if (insight.riskLevel !== 'none') insight.riskFlag = true
  if (safety.unavailable) insight.riskCheckUnavailable = true

  console.log(`[Analysis] Parsed — emotions: [${insight.emotions.join(', ')}], risk: ${insight.riskFlag} (${insight.riskLevel})`)

  return insight
}

function parseInsight(
  raw: string,
  transcriptWindowMinutes: number
): AIInsight {
  const parsed = extractJSON(raw)

  if (!parsed) {
    console.warn('[Analysis] LLM returned invalid JSON, using fallback')
    return fallbackInsight(transcriptWindowMinutes)
  }

  const emotions = normalizeArray(parsed.emotions)
  const summary = typeof parsed.summary === 'string' ? parsed.summary : ''
  const steps = normalizeArray(parsed.steps)
  const module = typeof parsed.module === 'string' ? parsed.module : ''
  const riskFlag = typeof parsed.riskFlag === 'boolean' ? parsed.riskFlag : false
  const riskDetail = typeof parsed.riskDetail === 'string' ? parsed.riskDetail : ''

  return {
    emotions,
    summary,
    steps,
    module,
    riskFlag,
    riskDetail,
    generatedAt: Date.now(),
    transcriptWindowMinutes,
  }
}

// The existing "suggestion unusable" result — used both when the reply can't be
// parsed and when the suggestion call fails outright. Risk is merged in after.
function fallbackInsight(transcriptWindowMinutes: number): AIInsight {
  return {
    emotions: [],
    summary: 'Analysis failed: could not parse LLM response',
    steps: ['Review the transcript manually'],
    module: '',
    riskFlag: false,
    generatedAt: Date.now(),
    transcriptWindowMinutes,
  }
}

// Only the client's lines from the "[SPEAKER]: text" transcript format
// (see formatTranscriptForLLM) — a therapist's screening question must not
// trip the local keyword check.
function clientLines(transcript: string): string {
  return transcript
    .split('\n')
    .filter((line) => line.startsWith('[CLIENT]:'))
    .join('\n')
}

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .slice(0, 10)
}

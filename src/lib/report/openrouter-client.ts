import OpenAI from 'openai'
import { assertAiEnv } from '../../../config/ai-env'

// The OpenRouter model comes ONLY from the MODEL env var — there is no
// hard-coded fallback. The same model serves the session report and the live
// copilot + safety passes. For the current validation period that is the free
// model `openai/gpt-oss-20b:free`; it is NOT a paid, private or zero-retention
// service. Missing MODEL is caught by assertAiEnv before any request.
export const REPORT_MODEL = process.env.MODEL ?? ''

// Lazily constructed so missing configuration never breaks builds/imports —
// assertAiEnv runs before every AI request and fails clearly (naming the
// missing variable, never its value). On Vercel this is the production check.
let client: OpenAI | null = null
function getClient(): OpenAI {
  assertAiEnv(process.env)
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://staad.therapy',
        'X-Title': 'STAAD Therapy',
      },
    })
  }
  return client
}

export async function generateReportText(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: REPORT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 2000,
  })
  return res.choices[0]?.message?.content ?? ''
}

// Live copilot + safety model — the same configured MODEL as the report. Kept
// as its own export so the call sites don't change.
export const COPILOT_MODEL = process.env.MODEL ?? ''

// Low-temperature chat for the copilot's structured (JSON) passes. We deliberately
// do NOT set response_format: json_object — gpt-oss models mangle their output under
// forced JSON mode (escaped-quote corruption + leaked harmony control tokens, and
// ~3x slower). Instead the prompts instruct "JSON only" and callers parse tolerantly
// via extractJSON. Returns the raw model string.
export async function chatJSON(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 1024
): Promise<string> {
  const res = await getClient().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: maxTokens,
  })
  return res.choices[0]?.message?.content ?? '{}'
}

// Tolerant JSON extraction for LLM output: strips markdown code fences and any
// prose around the object, then parses the outermost { ... }. Returns null on
// failure so callers can apply their own fallback. Use this instead of raw
// JSON.parse on any model response.
export function extractJSON<T = Record<string, unknown>>(raw: string): T | null {
  if (!raw) return null
  let t = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const i = t.indexOf('{')
  const j = t.lastIndexOf('}')
  if (i >= 0 && j > i) t = t.slice(i, j + 1)
  try {
    return JSON.parse(t) as T
  } catch {
    return null
  }
}

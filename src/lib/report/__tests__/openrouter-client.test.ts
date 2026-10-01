import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The OpenAI SDK is replaced: no network. We capture how the client is built
// and what each request carries. Synthetic values only.
const h = vi.hoisted(() => ({ ctor: vi.fn(), create: vi.fn() }))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: h.create } }
    constructor(opts: unknown) {
      h.ctor(opts)
    }
  },
}))

const SECRET = 'sk-or-SYNTHETIC-test-secret-value'
const MODEL = 'openai/gpt-oss-20b:free'
const SAVED = { ...process.env }

/** Fresh import, so the module re-reads MODEL for this test's environment. */
async function load(env: Record<string, string | undefined>) {
  vi.resetModules()
  for (const k of ['OPENROUTER_API_KEY', 'MODEL', 'OPENROUTER_MODEL', 'OPENROUTER_COPILOT_MODEL', 'OPENROUTER_SITE_URL']) {
    delete process.env[k]
  }
  Object.assign(process.env, env)
  return import('../openrouter-client')
}

beforeEach(() => {
  h.ctor.mockReset()
  h.create.mockReset()
  h.create.mockResolvedValue({ choices: [{ message: { content: '{"ok":true}' } }] })
})
afterEach(() => {
  process.env = { ...SAVED }
})

describe('openrouter-client configuration', () => {
  it('uses MODEL for both the report and the copilot/safety model', async () => {
    const m = await load({ OPENROUTER_API_KEY: SECRET, MODEL })
    expect(m.REPORT_MODEL).toBe(MODEL)
    expect(m.COPILOT_MODEL).toBe(MODEL)
  })

  it('sends the configured MODEL on report and copilot requests', async () => {
    const m = await load({ OPENROUTER_API_KEY: SECRET, MODEL })
    await m.generateReportText('sys', 'synthetic user prompt')
    await m.chatJSON(m.COPILOT_MODEL, 'sys', 'synthetic user prompt')
    expect(h.create.mock.calls.map(([req]) => req.model)).toEqual([MODEL, MODEL])
  })

  it('targets OpenRouter with OPENROUTER_API_KEY and keeps the existing headers', async () => {
    const m = await load({ OPENROUTER_API_KEY: SECRET, MODEL })
    await m.generateReportText('sys', 'u')
    expect(h.ctor).toHaveBeenCalledWith({
      apiKey: SECRET,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'HTTP-Referer': 'https://staad.therapy', 'X-Title': 'STAAD Therapy' },
    })
  })

  it('keeps the existing temperature / token settings and no forced JSON mode', async () => {
    const m = await load({ OPENROUTER_API_KEY: SECRET, MODEL })
    await m.generateReportText('sys', 'u')
    await m.chatJSON(m.COPILOT_MODEL, 'sys', 'u')
    await m.chatJSON(m.COPILOT_MODEL, 'sys', 'u', 256)
    const [report, copilot, safety] = h.create.mock.calls.map(([req]) => req)
    expect(report).toMatchObject({ temperature: 0.3, max_tokens: 2000 })
    expect(copilot).toMatchObject({ temperature: 0.2, max_tokens: 1024 })
    expect(safety).toMatchObject({ temperature: 0.2, max_tokens: 256 })
    for (const req of [report, copilot, safety]) expect(req).not.toHaveProperty('response_format')
  })

  it('has no gpt-oss-120b:free fallback — an unset MODEL stays empty', async () => {
    const m = await load({ OPENROUTER_API_KEY: SECRET })
    expect(m.REPORT_MODEL).toBe('')
    expect(m.COPILOT_MODEL).toBe('')
    const source = readFileSync(path.resolve(__dirname, '../openrouter-client.ts'), 'utf8')
    expect(source).not.toMatch(/gpt-oss-120b/)
  })

  it('ignores the retired OPENROUTER_MODEL / OPENROUTER_COPILOT_MODEL variables', async () => {
    const m = await load({
      OPENROUTER_API_KEY: SECRET,
      OPENROUTER_MODEL: 'retired/model:free',
      OPENROUTER_COPILOT_MODEL: 'retired/model:free',
    })
    expect(m.REPORT_MODEL).toBe('')
    await expect(m.generateReportText('sys', 'u')).rejects.toThrow(/MODEL/)
  })

  it('missing MODEL fails clearly before any request is sent', async () => {
    const m = await load({ OPENROUTER_API_KEY: SECRET })
    await expect(m.chatJSON(m.COPILOT_MODEL, 'sys', 'u')).rejects.toThrow(
      /Missing required AI configuration: MODEL/
    )
    expect(h.ctor).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('missing OPENROUTER_API_KEY fails clearly before any request is sent', async () => {
    const m = await load({ MODEL })
    await expect(m.generateReportText('sys', 'u')).rejects.toThrow(
      /Missing required AI configuration: OPENROUTER_API_KEY/
    )
    expect(h.create).not.toHaveBeenCalled()
  })

  it('importing the module with nothing configured does not throw (build-safe)', async () => {
    await expect(load({})).resolves.toBeDefined()
  })

  it('configuration errors never contain the secret', async () => {
    const m = await load({ OPENROUTER_API_KEY: SECRET })
    const err = await m.generateReportText('sys', 'u').catch((e: Error) => e)
    expect(String((err as Error).message)).not.toContain(SECRET)
  })
})

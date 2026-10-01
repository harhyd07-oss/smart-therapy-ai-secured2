import { vi } from 'vitest'

/**
 * Test-only recording stand-in for `@/lib/db`'s Prisma client, for routes that
 * touch models the in-memory fakePrisma doesn't implement (plans,
 * subscriptions, admins, transactions…).
 *
 * Every `prisma.<model>.<method>` is an auto-created vi.fn with a harmless
 * default (findMany → [], findUnique/findFirst → null, count → 0, …). Override
 * a specific one with `on('model', 'method', impl)`. `dataCalls()` lists every
 * call EXCEPT the auth lookup (user.findUnique) — so a test can assert that an
 * unauthorized request never reached the database.
 */
export function createMockPrisma() {
  const fns = new Map<string, ReturnType<typeof vi.fn>>()
  const defaults: Record<string, () => unknown> = {
    findMany: () => [],
    findUnique: () => null,
    findFirst: () => null,
    count: () => 0,
    groupBy: () => [],
    deleteMany: () => ({ count: 0 }),
    updateMany: () => ({ count: 0 }),
  }

  const fn = (model: string, method: string) => {
    const key = `${model}.${method}`
    if (!fns.has(key)) fns.set(key, vi.fn(async () => (defaults[method] ?? (() => ({})))()))
    return fns.get(key)!
  }

  const modelProxy = (model: string) =>
    new Proxy({}, { get: (_t, method: string) => fn(model, method) })

  const prisma: any = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === '$transaction') {
          return fn('$', 'transaction').mockImplementation(async (cb: any) => cb(prisma))
        }
        return modelProxy(prop)
      },
    }
  )

  return {
    prisma,
    /** The vi.fn behind prisma.<model>.<method> (created on first use). */
    fn,
    on(model: string, method: string, impl: (...args: any[]) => unknown) {
      fn(model, method).mockImplementation(async (...args: any[]) => impl(...args))
    },
    /** All recorded calls except the auth lookup. */
    dataCalls() {
      const out: string[] = []
      for (const [key, f] of fns) {
        if (key === 'user.findUnique') continue
        if (f.mock.calls.length > 0) out.push(key)
      }
      return out
    },
    reset() {
      fns.clear()
    },
  }
}

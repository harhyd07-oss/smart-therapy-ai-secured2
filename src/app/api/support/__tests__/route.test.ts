import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/test-utils/fakeAuth'

// No email is ever sent: nodemailer is replaced and we inspect what WOULD be sent.
const h = vi.hoisted(() => ({ db: null as any, sendMail: vi.fn() }))
vi.mock('@/lib/db', async () => {
  const { createMockPrisma } = await import('@/test-utils/mockPrisma')
  h.db = createMockPrisma()
  return { prisma: h.db.prisma }
})
vi.mock('@/lib/firebaseAdmin', () => import('@/test-utils/fakeAuth'))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: h.sendMail }) } }))

import { POST } from '../route'

const SAVED = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
beforeAll(() => {
  process.env.SMTP_USER = 'synthetic-smtp-user'
  process.env.SMTP_PASS = 'synthetic-smtp-pass'
})
afterAll(() => {
  process.env.SMTP_USER = SAVED.user
  process.env.SMTP_PASS = SAVED.pass
})

const USERS: Record<string, any> = {
  'uid-ca': { id: 'uid-ca', role: 'CLIENT', therapist: null, client: { firstName: 'Cara', lastName: 'Synthetic' }, admin: null },
  'uid-admin': { id: 'uid-admin', role: 'ADMIN', therapist: null, client: null, admin: { firstName: 'Ada', lastName: 'Admin' } },
}
beforeEach(() => {
  h.db.reset()
  h.sendMail.mockReset()
  h.sendMail.mockResolvedValue({})
  h.db.on('user', 'findUnique', ({ where }: any) => USERS[where.id] ?? null)
})

// Spoofed identity fields an attacker might put in the body.
const SPOOFED = {
  name: 'Spoofed Person',
  email: 'spoofed@evil.test',
  role: 'ADMIN',
  category: 'Other',
  subject: 'Synthetic subject',
  message: 'Synthetic message body',
}

describe('POST /api/support', () => {
  it('401 without a token — no email sent', async () => {
    expect((await POST(apiRequest('/api/support', { method: 'POST', body: SPOOFED }))).status).toBe(401)
    expect(h.sendMail).not.toHaveBeenCalled()
  })

  it('a fake Authorization header is rejected', async () => {
    for (const header of ['x', 'Bearer forged']) {
      const req = new Request('http://localhost/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: header },
        body: JSON.stringify(SPOOFED),
      })
      expect((await POST(req)).status).toBe(401)
    }
    expect(h.sendMail).not.toHaveBeenCalled()
  })

  it('reply-to and sender identity come from the verified token, not the body', async () => {
    const res = await POST(apiRequest('/api/support', { method: 'POST', body: SPOOFED, as: 'uid-ca' }))
    expect(res.status).toBe(200)
    const [mail] = h.sendMail.mock.calls[0]
    expect(mail.replyTo).toBe('uid-ca@token.test')
    expect(mail.text).toContain('Cara Synthetic <uid-ca@token.test>')
    expect(mail.text).toContain('Role:     CLIENT')
    for (const spoof of ['spoofed@evil.test', 'Spoofed Person']) {
      expect(JSON.stringify(mail)).not.toContain(spoof)
    }
  })

  it('admins may use it too', async () => {
    const res = await POST(apiRequest('/api/support', { method: 'POST', body: SPOOFED, as: 'uid-admin' }))
    expect(res.status).toBe(200)
    expect(h.sendMail.mock.calls[0][0].replyTo).toBe('uid-admin@token.test')
  })
})

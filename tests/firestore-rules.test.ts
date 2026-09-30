/**
 * Firestore security rules — emulator test suite.
 *
 * Runs against the Firestore emulator, never production:
 *   npm run test:rules
 *
 * Covers every collection the app touches (liveSessions, sessions,
 * sessions/private/therapist, sessions/rawSessionLog, moduleStates, patients)
 * plus the default-deny catch-all, from the perspective of each actor: the
 * therapist and client of a session, a different (real) therapist, an
 * unrelated authenticated user, and an anonymous visitor.
 *
 * Identity is the verified token (`authenticatedContext(uid, claims)`); the
 * "claims the seat in the data" cases show a uid written into a document
 * never stands in for it.
 *
 * The single most important assertions are the OUTSIDER cases. Under the old
 * catch-all rule (`allow read, write: if request.auth != null`) every one of
 * them PASSED, which is precisely the vulnerability being closed.
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore'

const PROJECT_ID = 'staad-rules-test'

// Session ids are UUIDs in production (Prisma @default(uuid())), so they never
// contain an underscore — which is what makes the moduleStates docId split safe.
const SESSION = '11111111-2222-4333-8444-555555555555'
const THERAPIST = 'uid-therapist'
const CLIENT = 'uid-client'
const OUTSIDER = 'uid-outsider'

// A second, fully legitimate session: OUTSIDER is the therapist of CLIENT_B.
// Proves that being a real, seated therapist SOMEWHERE grants nothing here.
const SESSION_B = '66666666-7777-4888-8999-000000000000'
const CLIENT_B = 'uid-client-b'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  // Seed as the server would (Admin SDK bypasses rules, same as production).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'liveSessions', SESSION), {
      sessionId: SESSION,
      allowedUids: [THERAPIST, CLIENT],
      therapistUid: THERAPIST,
      clientUid: CLIENT,
      activeModuleId: null,
      participants: {},
    })
    await setDoc(doc(db, 'sessions', SESSION), { sessionId: SESSION, aiConsent: {} })
    await setDoc(doc(db, 'sessions', SESSION, 'private', 'therapist'), {
      therapistNotes: [{ content: 'seen anxious at start', timestamp: '2026-01-01T10:00:00Z' }],
      aiInsight: { summary: 's', riskFlag: true, riskDetail: 'mentioned self-harm' },
    })
    await setDoc(doc(db, 'moduleStates', `${SESSION}_worry-vault`), { state: {} })
    await setDoc(doc(db, 'patients', CLIENT), { quests: [], therapistUids: [THERAPIST] })

    await setDoc(doc(db, 'liveSessions', SESSION_B), {
      sessionId: SESSION_B,
      allowedUids: [OUTSIDER, CLIENT_B],
      therapistUid: OUTSIDER,
      clientUid: CLIENT_B,
    })
    await setDoc(doc(db, 'sessions', SESSION_B), { sessionId: SESSION_B, aiConsent: {} })
    await setDoc(doc(db, 'patients', CLIENT_B), { quests: [], therapistUids: [OUTSIDER] })
  })
})

const therapistDb = () =>
  testEnv.authenticatedContext(THERAPIST, { role: 'THERAPIST' }).firestore()
const clientDb = () =>
  testEnv.authenticatedContext(CLIENT, { role: 'CLIENT' }).firestore()
const outsiderDb = () =>
  testEnv.authenticatedContext(OUTSIDER, { role: 'CLIENT' }).firestore()
// The therapist of SESSION_B / CLIENT_B — a different therapist from ours.
const outsiderTherapistDb = () =>
  testEnv.authenticatedContext(OUTSIDER, { role: 'THERAPIST' }).firestore()
const anonDb = () => testEnv.unauthenticatedContext().firestore()

describe('liveSessions', () => {
  it('lets an entitled therapist read the room', async () => {
    await assertSucceeds(getDoc(doc(therapistDb(), 'liveSessions', SESSION)))
  })

  it('lets an entitled client read the room', async () => {
    await assertSucceeds(getDoc(doc(clientDb(), 'liveSessions', SESSION)))
  })

  it('DENIES an unrelated authenticated user (old rules allowed this)', async () => {
    await assertFails(getDoc(doc(outsiderDb(), 'liveSessions', SESSION)))
  })

  it('DENIES an anonymous visitor', async () => {
    await assertFails(getDoc(doc(anonDb(), 'liveSessions', SESSION)))
  })

  it('lets a participant update room state', async () => {
    await assertSucceeds(
      updateDoc(doc(therapistDb(), 'liveSessions', SESSION), { activeModuleId: 'worry-vault' })
    )
  })

  it('lets a participant register themselves in participants', async () => {
    await assertSucceeds(
      updateDoc(doc(clientDb(), 'liveSessions', SESSION), {
        [`participants.${CLIENT}`]: { uid: CLIENT, role: 'client', isOnline: true },
      })
    )
  })

  it('DENIES an outsider writing room state', async () => {
    await assertFails(
      updateDoc(doc(outsiderDb(), 'liveSessions', SESSION), { activeModuleId: 'hijack' })
    )
  })

  it('DENIES a participant escalating their own entitlement', async () => {
    // The circularity guard: if this passed, allowedUids would be self-issued.
    await assertFails(
      updateDoc(doc(therapistDb(), 'liveSessions', SESSION), {
        allowedUids: [THERAPIST, CLIENT, OUTSIDER],
      })
    )
  })

  it('DENIES client-side creation of a new room', async () => {
    await assertFails(
      setDoc(doc(therapistDb(), 'liveSessions', 'invented-session'), {
        allowedUids: [THERAPIST],
      })
    )
  })

  it('DENIES deletion', async () => {
    await assertFails(deleteDoc(doc(therapistDb(), 'liveSessions', SESSION)))
  })

  it('DENIES a participant moving themselves into the therapist seat', async () => {
    await assertFails(
      updateDoc(doc(clientDb(), 'liveSessions', SESSION), { therapistUid: CLIENT })
    )
    await assertFails(
      updateDoc(doc(therapistDb(), 'liveSessions', SESSION), { clientUid: THERAPIST })
    )
  })

  it('DENIES access when the room has no allowedUids (fails closed)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'liveSessions', 'legacy'), { sessionId: 'legacy' })
    })
    await assertFails(getDoc(doc(therapistDb(), 'liveSessions', 'legacy')))
  })
})

describe('sessions', () => {
  it('lets both participants read the session record', async () => {
    await assertSucceeds(getDoc(doc(therapistDb(), 'sessions', SESSION)))
    await assertSucceeds(getDoc(doc(clientDb(), 'sessions', SESSION)))
  })

  it('DENIES an outsider reading the transcript and consent state', async () => {
    await assertFails(getDoc(doc(outsiderDb(), 'sessions', SESSION)))
  })

  it('DENIES an outsider with a THERAPIST claim (role alone is not entitlement)', async () => {
    await assertFails(getDoc(doc(outsiderTherapistDb(), 'sessions', SESSION)))
  })

  it('lets a participant append a transcript chunk', async () => {
    await assertSucceeds(
      updateDoc(doc(therapistDb(), 'sessions', SESSION), {
        transcript: [{ text: 'hello', speaker: 'therapist' }],
      })
    )
    await assertSucceeds(
      updateDoc(doc(clientDb(), 'sessions', SESSION), {
        moduleEvents: [{ module: 'worry-vault', type: 'open', detail: 'opened', timestamp: 1 }],
      })
    )
  })

  it('DENIES an outsider writing consent on behalf of the client', async () => {
    await assertFails(
      updateDoc(doc(outsiderDb(), 'sessions', SESSION), { 'aiConsent.client': true })
    )
  })

  it('DENIES deletion', async () => {
    await assertFails(deleteDoc(doc(therapistDb(), 'sessions', SESSION)))
  })

  it('DENIES any update from a member of a room with no seats (un-backfilled, fails closed)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'liveSessions', 'unseated'), { allowedUids: [THERAPIST, CLIENT] })
      await setDoc(doc(db, 'sessions', 'unseated'), { aiConsent: {} })
    })
    await assertFails(updateDoc(doc(therapistDb(), 'sessions', 'unseated'), { 'aiConsent.therapist': true }))
    await assertFails(updateDoc(doc(clientDb(), 'sessions', 'unseated'), { 'aiConsent.client': true }))
  })
})

describe('sessions — consent ownership', () => {
  it('lets the therapist record their own consent', async () => {
    await assertSucceeds(
      updateDoc(doc(therapistDb(), 'sessions', SESSION), { 'aiConsent.therapist': true })
    )
  })

  it('DENIES the therapist consenting on the client\'s behalf', async () => {
    await assertFails(
      updateDoc(doc(therapistDb(), 'sessions', SESSION), { 'aiConsent.client': true })
    )
  })

  it('lets the client record their own consent', async () => {
    await assertSucceeds(
      updateDoc(doc(clientDb(), 'sessions', SESSION), { 'aiConsent.client': true })
    )
  })

  it('DENIES the client setting the therapist\'s consent', async () => {
    await assertFails(
      updateDoc(doc(clientDb(), 'sessions', SESSION), { 'aiConsent.therapist': true })
    )
  })

  it('DENIES smuggling the other party\'s consent into a legitimate update', async () => {
    await assertFails(
      updateDoc(doc(therapistDb(), 'sessions', SESSION), {
        'aiConsent.therapist': true,
        'aiConsent.client': true,
      })
    )
    await assertFails(
      updateDoc(doc(clientDb(), 'sessions', SESSION), {
        transcript: [{ text: 'hi', speaker: 'client' }],
        'aiConsent.therapist': true,
      })
    )
  })

  it('DENIES the therapist withdrawing consent the client already gave', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'sessions', SESSION), { 'aiConsent.client': true })
    })
    await assertFails(
      updateDoc(doc(therapistDb(), 'sessions', SESSION), { 'aiConsent.client': false })
    )
  })

  it('DENIES replacing the whole aiConsent map to set both at once', async () => {
    await assertFails(
      updateDoc(doc(clientDb(), 'sessions', SESSION), { aiConsent: { client: true, therapist: true } })
    )
  })

  it('takes identity from the token, not from a claimed seat in the data', async () => {
    // The client claims the therapist seat in the very write — still refused,
    // because the rules read the seat from the server-written liveSessions doc.
    await assertFails(
      updateDoc(doc(clientDb(), 'sessions', SESSION), {
        therapistUid: CLIENT,
        'aiConsent.therapist': true,
      })
    )
  })
})

describe('sessions — therapist-only fields stay off the shared doc', () => {
  it('DENIES the client writing a fake aiInsight onto the session', async () => {
    await assertFails(
      updateDoc(doc(clientDb(), 'sessions', SESSION), { aiInsight: { summary: 'forged' } })
    )
  })

  it('DENIES the therapist writing notes onto the shared doc (they belong in private/)', async () => {
    await assertFails(
      updateDoc(doc(therapistDb(), 'sessions', SESSION), { therapistNotes: [{ content: 'x' }] })
    )
    await assertFails(
      updateDoc(doc(therapistDb(), 'sessions', SESSION), { riskDetail: 'x' })
    )
  })
})

describe('sessions/{id}/private/therapist — therapist-only data', () => {
  const priv = (db: ReturnType<typeof therapistDb>) => doc(db, 'sessions', SESSION, 'private', 'therapist')
  const note = { therapistNotes: [{ content: 'calmer after breathing', timestamp: 't' }] }

  it('lets the session\'s therapist read notes and the AI insight', async () => {
    await assertSucceeds(getDoc(priv(therapistDb())))
  })

  it('lets the session\'s therapist write notes', async () => {
    await assertSucceeds(setDoc(priv(therapistDb()), note, { merge: true }))
  })

  it('lets the therapist create the private doc with their first note', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'sessions', SESSION, 'private', 'therapist'))
    })
    await assertSucceeds(setDoc(priv(therapistDb()), note, { merge: true }))
  })

  it('DENIES the therapist forging the server-written AI insight or audit log', async () => {
    await assertFails(setDoc(priv(therapistDb()), { aiInsight: { riskFlag: false } }, { merge: true }))
    await assertFails(setDoc(priv(therapistDb()), { copilotEvents: [] }, { merge: true }))
  })

  it('DENIES the client reading therapist notes / risk detail', async () => {
    await assertFails(getDoc(priv(clientDb())))
  })

  it('DENIES the client writing therapist notes', async () => {
    await assertFails(setDoc(priv(clientDb()), note, { merge: true }))
  })

  it('DENIES a different therapist reading or writing', async () => {
    await assertFails(getDoc(priv(outsiderTherapistDb())))
    await assertFails(setDoc(priv(outsiderTherapistDb()), note, { merge: true }))
  })

  it('DENIES an anonymous visitor', async () => {
    await assertFails(getDoc(priv(anonDb())))
  })

  it('DENIES the client even when the written data claims the therapist seat', async () => {
    await assertFails(
      setDoc(priv(clientDb()), { ...note, therapistUid: CLIENT }, { merge: true })
    )
  })

  it('DENIES any other doc under private/', async () => {
    await assertFails(getDoc(doc(clientDb(), 'sessions', SESSION, 'private', 'client')))
    await assertFails(setDoc(doc(clientDb(), 'sessions', SESSION, 'private', 'client'), { a: 1 }))
  })

  it('DENIES deletion, even by the therapist', async () => {
    await assertFails(deleteDoc(priv(therapistDb())))
  })

  it('DENIES the therapist when the room has no seats (un-backfilled, fails closed)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'liveSessions', 'unseated'), { allowedUids: [THERAPIST, CLIENT] })
    })
    await assertFails(getDoc(doc(therapistDb(), 'sessions', 'unseated', 'private', 'therapist')))
  })
})

describe('sessions/{id}/rawSessionLog — the session diary', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    timestamp: serverTimestamp(),
    type: 'attention',
    value: 87,
    ...over,
  })

  it('lets the therapist append an attention score', async () => {
    await assertSucceeds(
      addDoc(collection(therapistDb(), 'sessions', SESSION, 'rawSessionLog'), entry())
    )
  })

  it('lets participants read the diary back', async () => {
    await assertSucceeds(getDoc(doc(clientDb(), 'sessions', SESSION, 'rawSessionLog', 'x')))
  })

  it('DENIES an outsider reading attention scores', async () => {
    await assertFails(getDoc(doc(outsiderDb(), 'sessions', SESSION, 'rawSessionLog', 'x')))
  })

  it('DENIES an outsider writing a fabricated score', async () => {
    await assertFails(
      addDoc(collection(outsiderDb(), 'sessions', SESSION, 'rawSessionLog'), entry())
    )
  })

  it('rejects an out-of-range attention score', async () => {
    await assertFails(
      addDoc(collection(therapistDb(), 'sessions', SESSION, 'rawSessionLog'), entry({ value: 101 }))
    )
    await assertFails(
      addDoc(collection(therapistDb(), 'sessions', SESSION, 'rawSessionLog'), entry({ value: -1 }))
    )
  })

  it('rejects an attention score that is not an integer', async () => {
    await assertFails(
      addDoc(collection(therapistDb(), 'sessions', SESSION, 'rawSessionLog'), entry({ value: 'high' }))
    )
  })

  it('rejects an unknown entry type', async () => {
    await assertFails(
      addDoc(collection(therapistDb(), 'sessions', SESSION, 'rawSessionLog'), entry({ type: 'diagnosis' }))
    )
  })

  it('rejects extra fields smuggled into an entry', async () => {
    await assertFails(
      addDoc(
        collection(therapistDb(), 'sessions', SESSION, 'rawSessionLog'),
        entry({ rawFrame: 'base64...' })
      )
    )
  })

  it('accepts a transcript entry (forward-compatible with the deferred dual-write)', async () => {
    await assertSucceeds(
      addDoc(
        collection(therapistDb(), 'sessions', SESSION, 'rawSessionLog'),
        entry({ type: 'transcript', value: 'the client said hello' })
      )
    )
  })

  it('is append-only — no edits or deletes, even by a participant', async () => {
    let id = ''
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const ref = await addDoc(
        collection(ctx.firestore(), 'sessions', SESSION, 'rawSessionLog'),
        { timestamp: serverTimestamp(), type: 'attention', value: 50 }
      )
      id = ref.id
    })
    await assertFails(
      updateDoc(doc(therapistDb(), 'sessions', SESSION, 'rawSessionLog', id), { value: 100 })
    )
    await assertFails(deleteDoc(doc(therapistDb(), 'sessions', SESSION, 'rawSessionLog', id)))
  })
})

describe('moduleStates', () => {
  const stateId = `${SESSION}_worry-vault`

  it('lets participants read and write shared module state', async () => {
    await assertSucceeds(getDoc(doc(clientDb(), 'moduleStates', stateId)))
    await assertSucceeds(
      setDoc(doc(therapistDb(), 'moduleStates', stateId), { state: { step: 2 } }, { merge: true })
    )
  })

  it('DENIES an outsider reading module state', async () => {
    await assertFails(getDoc(doc(outsiderDb(), 'moduleStates', stateId)))
  })

  it('DENIES an outsider writing module state', async () => {
    await assertFails(
      setDoc(doc(outsiderDb(), 'moduleStates', stateId), { state: { hijacked: true } })
    )
  })

  it('DENIES a docId whose session prefix does not exist', async () => {
    await assertFails(getDoc(doc(therapistDb(), 'moduleStates', 'no-such-session_worry-vault')))
  })

  it('DENIES deletion', async () => {
    await assertFails(deleteDoc(doc(therapistDb(), 'moduleStates', stateId)))
  })
})

describe('patients', () => {
  it('lets the patient read their own quests', async () => {
    await assertSucceeds(getDoc(doc(clientDb(), 'patients', CLIENT)))
  })

  it('lets the patient update their own quests', async () => {
    await assertSucceeds(
      setDoc(doc(clientDb(), 'patients', CLIENT), { quests: [{ id: 'q2' }] }, { merge: true })
    )
  })

  it('lets the patient\'s own therapist read quests', async () => {
    await assertSucceeds(getDoc(doc(therapistDb(), 'patients', CLIENT)))
  })

  it('lets the patient\'s own therapist assign quests', async () => {
    await assertSucceeds(
      setDoc(doc(therapistDb(), 'patients', CLIENT), { quests: [{ id: 'q1' }] }, { merge: true })
    )
  })

  it('DENIES a different therapist reading another therapist\'s patient', async () => {
    // OUTSIDER holds a THERAPIST claim AND is the real therapist of CLIENT_B.
    await assertFails(getDoc(doc(outsiderTherapistDb(), 'patients', CLIENT)))
  })

  it('DENIES a different therapist writing another therapist\'s patient', async () => {
    await assertFails(
      setDoc(doc(outsiderTherapistDb(), 'patients', CLIENT), { quests: [{ id: 'x' }] }, { merge: true })
    )
  })

  it('still lets that other therapist use their OWN patient', async () => {
    await assertSucceeds(getDoc(doc(outsiderTherapistDb(), 'patients', CLIENT_B)))
  })

  it('DENIES another patient reading someone else\'s quests', async () => {
    await assertFails(getDoc(doc(outsiderDb(), 'patients', CLIENT)))
  })

  it('DENIES an anonymous visitor', async () => {
    await assertFails(getDoc(doc(anonDb(), 'patients', CLIENT)))
  })

  it('DENIES a user with no role claim who is not in therapistUids', async () => {
    const noClaim = testEnv.authenticatedContext('uid-noclaim').firestore()
    await assertFails(getDoc(doc(noClaim, 'patients', CLIENT)))
  })

  it('DENIES a therapist adding themselves to therapistUids (no self-issued access)', async () => {
    await assertFails(
      setDoc(
        doc(outsiderTherapistDb(), 'patients', CLIENT),
        { therapistUids: [THERAPIST, OUTSIDER] },
        { merge: true }
      )
    )
  })

  it('DENIES the patient editing therapistUids', async () => {
    await assertFails(
      updateDoc(doc(clientDb(), 'patients', CLIENT), { therapistUids: [THERAPIST, OUTSIDER] })
    )
    await assertFails(updateDoc(doc(clientDb(), 'patients', CLIENT), { therapistUids: [] }))
  })

  it('DENIES the own therapist editing therapistUids', async () => {
    await assertFails(
      updateDoc(doc(therapistDb(), 'patients', CLIENT), { therapistUids: [THERAPIST, OUTSIDER] })
    )
  })

  it('lets a patient create their own doc, but never with therapistUids', async () => {
    const newPatient = testEnv.authenticatedContext('uid-new', { role: 'CLIENT' }).firestore()
    await assertSucceeds(setDoc(doc(newPatient, 'patients', 'uid-new'), { quests: [] }))
    await testEnv.clearFirestore()
    await assertFails(
      setDoc(doc(newPatient, 'patients', 'uid-new'), { quests: [], therapistUids: [OUTSIDER] })
    )
  })

  it('DENIES a therapist creating a patient doc (the server seeds it)', async () => {
    await assertFails(setDoc(doc(therapistDb(), 'patients', 'uid-unseen'), { quests: [] }))
  })

  it('DENIES a therapist when the patient doc has no therapistUids (fails closed)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'patients', 'uid-legacy'), { quests: [] })
    })
    await assertFails(getDoc(doc(therapistDb(), 'patients', 'uid-legacy')))
  })

  it('DENIES deletion', async () => {
    await assertFails(deleteDoc(doc(therapistDb(), 'patients', CLIENT)))
  })
})

describe('default deny', () => {
  it('refuses an unmatched collection even for a signed-in user', async () => {
    await assertFails(getDoc(doc(therapistDb(), 'users', THERAPIST)))
    await assertFails(setDoc(doc(therapistDb(), 'anythingElse', 'x'), { a: 1 }))
  })

  it('refuses the legacy presence collection', async () => {
    await assertFails(getDoc(doc(therapistDb(), 'presence', THERAPIST)))
  })
})

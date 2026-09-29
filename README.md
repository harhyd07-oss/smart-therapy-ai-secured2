# STAAD — Smart Therapy and AI Digital Platform

Next.js 14 (App Router, TypeScript) app for children's therapy sessions:
Prisma on Neon Postgres, Firebase Auth + Firestore, LiveKit video, Sarvam
speech-to-text, and OpenRouter / NVIDIA for AI.

> This app handles children's therapy data. Treat every database, Firebase
> project and API key as sensitive. Never point local development at production.

## 1. Install

```bash
git clone <repo-url>
cd smart-therapy-and-ai-digital-platform
npm install
```

## 2. Environment

```bash
cp .env.example .env
```

Fill `.env` with the **dev** keys from your lead. `.env` is gitignored — never
commit it. `server.js` loads it via `@next/env`, so restart `npm run dev` after
any change. `.env.example` explains which variables are required and which are
only needed for a specific feature.

## 3. Database (Prisma)

`DATABASE_URL` **must point to a Neon development branch, not production.**
The database needs the `vector` (pgvector) extension.

```bash
npx prisma generate
npx prisma db push
```

The project uses `prisma db push`; there is no `prisma/migrations` directory.
Do not run `prisma migrate dev` — it would create a new migration history and
may offer to reset the database.

## 4. Run

```bash
npm run dev
```

This runs `node server.js`, a custom server that serves Next.js and also proxies
Sarvam speech-to-text at `/api/sarvam-stream` (Next's App Router can't host a
WebSocket route). Open <http://localhost:3000>.

`npm run dev:next` runs plain `next dev`, without the STT proxy.

## Firebase: read this before logging in

**The app does not use the Firebase emulator.** The Firebase client config in
`src/lib/firebase.ts` is hard-coded, and the admin SDK uses the `FIREBASE_*`
credentials in `.env`. Local development reads and writes whichever Firebase
project those point to — Auth users, Firestore documents and all.

`npm run emulators` starts a Firestore emulator (project `staad-rules-test`)
that is **only** used by the security-rules tests (`npm run test:rules`). Running
it does not redirect the app.

Until there is a separate dev Firebase project, confirm with your lead which
project your config points at before signing up or creating data, and never use
real patient accounts locally.

## 5. Test a session in two browsers

Use two separate browser profiles (or one normal window and one private window)
so each has its own login.

1. **Browser A:** sign up at `/auth` and choose **Therapist** during onboarding.
2. In **Clients**, invite a test client and copy the invite link.
3. **Browser B:** open the invite link and sign up as the client.
4. **Browser A:** schedule a session with that client, then open it
   (`/session/<sessionId>`).
5. **Browser B:** open the same session from the client's sessions list.
6. Check that video connects both ways (needs the `LIVEKIT_*` variables).

Transcription and the AI copilot need consent from both participants. For solo
testing in development, set `NEXT_PUBLIC_STT_TEST_MODE=true`. It is ignored in
production builds.

## Checks

```bash
npx tsc --noEmit     # type check
npx vitest run       # unit tests (src/**/*.test.ts)
npm run test:rules   # Firestore rules tests against the emulator
```

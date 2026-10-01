// Required OpenRouter configuration, shared by the two places that enforce it:
//   - src/lib/report/openrouter-client.ts checks it before EVERY AI request.
//     That is what protects production on Vercel (where server.js never runs):
//     a missing value fails the AI call clearly instead of sending a request.
//   - server.js checks it at startup when self-hosted with `npm start`
//     (node server.js --prod) and refuses to boot without it.
// Neither runs during `next build`, so builds don't need production secrets.
//
// Plain CommonJS so server.js can require it without a build step.
//
// Errors name the missing VARIABLES only — never a value.

const REQUIRED_AI_ENV = ['OPENROUTER_API_KEY', 'MODEL']

/** Names of required AI variables that are missing or blank. */
function missingAiEnv(env) {
  return REQUIRED_AI_ENV.filter((name) => !env[name] || !String(env[name]).trim())
}

/** Throws a clear configuration error if any required AI variable is missing. */
function assertAiEnv(env) {
  const missing = missingAiEnv(env)
  if (missing.length > 0) {
    throw new Error(
      `Missing required AI configuration: ${missing.join(', ')}. ` +
        'Set it in the environment (see .env.example).'
    )
  }
}

module.exports = { REQUIRED_AI_ENV, missingAiEnv, assertAiEnv }

# Formcast

NestJS backend and Expo mobile app for the live voice form challenge. Speak continuously to preview proposed job changes, then press Finish to save or Cancel to discard them.

The backend uses NestJS 11 (Express 5), Better Auth with its Expo plugin, Prisma 7, and PostgreSQL hosted on Neon. The mobile app uses Expo Router, React Native Paper behind shared UI wrappers, and NativeWind. See [mobile setup](mobile/README.md) and the [mobile design guide](docs/mobile-design.md).

## Run the backend

Requires Node.js 22.12+ (Node 24 recommended). Run commands from `backend/`. On Windows PowerShell, use `npm.cmd` / `npx.cmd` if execution policy blocks npm's PowerShell shim.

```sh
npm ci
```

Copy `backend/.env.example` to `backend/.env`. Set `DATABASE_URL` to your Neon PostgreSQL connection string with `sslmode=verify-full` (explicit certificate and hostname verification). Optionally set `DIRECT_URL` to an unpooled connection for Prisma CLI migrations; otherwise migrations use `DATABASE_URL`. Generate a secret with the following command and place the output in `BETTER_AUTH_SECRET`. Set `DEMO_PASSWORD` to a password of at least 12 characters.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run db:deploy
npm run build
npm run db:seed
npm run start:dev
```

The API listens on port 3000. The seed creates one demo technician and three sample jobs (an empty cable installation, an active inspection, and completed maintenance). Running it again preserves existing job values and does not reset the user's password. Sign in with `DEMO_EMAIL` and `DEMO_PASSWORD` from your environment.

Hosted database connections can take a few seconds after idle periods. The PostgreSQL
driver allows 15 seconds to acquire a connection; Prisma allows 20 seconds to start
a transaction and 10 seconds to execute it. Mobile auth requests allow 45 seconds.
This avoids Prisma's default 2-second acquisition timeout ending auth requests before
the driver can connect. Transactions remain enabled; a database outage or exhausted
pool can still cause a timeout. Restart the backend after changing `.env` settings.

`npm start` runs the compiled app. `npm run db:migrate -- --name your_change` creates a development migration; `npm run db:deploy` applies checked-in migrations. `npm run db:studio` opens the database viewer.

For voice, set `OPENAI_API_KEY` and `DEEPGRAM_API_KEY` in `backend/.env` and restart the backend. Models default to GPT-5 mini and Nova-3. Keys stay on the server; CRUD works without them. Install updated dependencies in both folders. Voice uses the native iPhone/Android app; the browser supports CRUD only. No new migration is needed. See the [voice architecture and protocol](docs/voice-architecture.md) for setup, corrections, failure handling and tests.

## API

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /api/health` | Public | Database connectivity |
| `POST /api/auth/sign-up/email` | Public | `{ "name", "email", "password" }` |
| `POST /api/auth/sign-in/email` | Public | `{ "email", "password" }` |
| `POST /api/auth/sign-out` | Session | Revoke session |
| `GET /api/auth/get-session` | Session | Better Auth session |
| `GET /api/me` | Session | Current user |
| `GET /api/jobs/schema` | Session | Fixed form definition |
| `GET /api/jobs` | Session | Current user's jobs |
| `GET /api/jobs/:id` | Session | Committed fields and material rows |
| `POST /api/jobs` | Session | Create a job |
| `PATCH /api/jobs/:id` | Session | Edit job details |
| `DELETE /api/jobs/:id` | Session | Delete job and its materials |
| `POST /api/jobs/:id/voice-sessions` | Session | Create an owned voice session and single-use socket ticket |
| `WS /api/voice` | Ticket | PCM upload and live transcript/proposal events |
| `POST /api/voice-sessions/:id/finish` | Session | Commit a drained proposal revision |
| `POST /api/voice-sessions/:id/cancel` | Session | Discard uncommitted proposals |

Better Auth manages passwords and session cookies. Auth routes are mounted before JSON body parsing, following its [Express integration](https://better-auth.com/docs/integrations/express). Database access uses the [Prisma adapter](https://better-auth.com/docs/adapters/prisma). Missing and unowned jobs both return 404. New signups start with no jobs; the seed provisions demo jobs, and every signed-in user can create their own jobs.

For Expo, configure the app scheme as `formcast` and use Better Auth's React client with `expoClient` and SecureStore. For custom API requests, forward `authClient.getCookie()` in the `Cookie` header with `credentials: 'omit'`; browser clients use `credentials: 'include'`. See the [Expo integration](https://better-auth.com/docs/integrations/expo). On a physical device, set the client's URL and `BETTER_AUTH_URL` to the backend machine's LAN address, and add the exact development origin to `TRUSTED_ORIGINS` as needed. The server binds to all interfaces.

## Architecture

CRUD flow: HTTP → Better Auth session guard → owned job query → Prisma → PostgreSQL (Neon).

Voice flow: Expo PCM → WebSocket → VoiceModule → Deepgram Nova-3 → transcript revisions → GPT-5 mini → validated patch list → live preview. Finish drains the speech pipeline and calls JobsModule to commit. AiModule isolates provider adapters, VoiceModule owns transient sessions and orchestration, and JobsModule owns validation and database writes.

The database stores committed scalar fields on `Job` and repeating rows in `Material`. Nullable scalar fields distinguish an unset value from `false` or `0`. Tags are a JSON array; the fixed schema declares allowed tags. `version` enforces optimistic concurrency on Finish. Material IDs are stable so proposals can update/delete existing rows.

Proposal state stays in a NestJS in-memory Map. GPT returns a complete replacement patch list, so corrections retract/revise earlier proposals instead of appending duplicate operations. Inference uses one request in flight and coalesces newer transcript revisions; partial model JSON never updates the form. Finish validates and applies all remaining proposals in one transaction, checking the job version; Cancel discards them without changing committed data. Repeat Finish requests share the same result while the session remains in memory.

Manual create/update accepts title (1–160 characters), generalRemarks (up to 5000 characters), priority (low, medium, high, or null), and jobComplete (boolean or null). Voice also handles arrivalTime, distanceKm, tags and material rows. Unknown fields are rejected. Manual updates increment version and preserve other committed fields and materials.

Known limits: voice targets native iPhone/Android, English speech, one backend instance, and sessions up to ten minutes. A restart loses pending proposals. Interrupted/disconnected sessions must restart; unresolved final details require Cancel and a new session. Commit-result caching lasts five minutes and is not durable across restarts. Email verification, password reset and social login are not implemented. Authentication uses email/password and a single-process rate limiter. Native HTTP requests forward the session cookie; WebSockets use a short-lived single-use ticket.

## Verification

```sh
npm test
```

Tests use `TEST_DATABASE_URL` when provided, otherwise `DATABASE_URL`. They create a randomly named PostgreSQL schema, apply the real migration there, and exercise health, session protection, repeatable seeding, login, signup, ownership isolation, invalid credentials, origin rejection, and logout over HTTP. Only the temporary test schema is dropped afterward; existing application tables remain untouched. The test database role needs permission to create and drop schemas.

Voice tests cover retraction versus clear, material identity, interim transcript replacement, scheduling, cancellation, final-audio draining, duplicate Finish and version conflicts. HTTP/WebSocket integration tests use real PostgreSQL and mocked providers. `npm run test:voice` runs standalone voice tests; `npm run test:voice:live` opts into real GPT requests using API credit without database writes. To additionally test Nova-3, run `node scripts/voice-smoke.mjs path/to/challenge.wav` after a build, using a mono 16-bit PCM WAV of the challenge script.

Dependency audit at implementation time: npm reports four high-severity entries in the Prisma CLI dependency tree (`prisma`, `@prisma/config`, `deepmerge-ts`, and `mysql2`). Its suggested automatic fix downgrades Prisma to v6, so it has not been applied. Recheck upstream fixes before deployment.

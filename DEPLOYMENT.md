# Vercel deployment guide

This project keeps a single repository with:

- a Vite React + TypeScript app at the repository root for the front end
- a Vercel serverless API under `/api` for Express-compatible routes

Use a single project in Vercel with the repository root as the Root Directory. Vite builds the front end into `dist`, while `/api/index.mjs` serves the API as an explicit ES module.

## 1. Recommended project structure

```text
.
├── api/
│   └── index.mjs
├── src/
├── server/
├── dist/
├── package.json
├── vercel.json
├── vite.config.ts
├── .env.example
└── README.md
```

## 2. Vercel project settings

In the Vercel dashboard or via the CLI:

- Framework preset: Vite
- Root Directory: `.`
- Build Command: `npm run vercel-build`
- Output Directory: `dist`
- Install Command: `npm install`
- Node.js Version: `24.x`

## 3. Environment variables

Copy `.env.example` to a local `.env` file for development. In Vercel, add the same values for each environment:

- Production
- Preview
- Development (optional)

Required variables include:

| Variable | Scope | Notes |
|---|---|---|
| `DATABASE_URL` | Dev / Preview / Prod | Hosted Postgres (Neon, Supabase, Railway, etc.) |
| `DIRECT_URL` | Dev / Preview / Prod | Direct, non-pooled Postgres URL used by Prisma migrations |
| `JWT_ACCESS_SECRET` | Dev / Preview / Prod | 32+ chars, production-only secret |
| `TOKEN_HASH_SECRET` | Dev / Preview / Prod | 32+ chars, separate from access secret |
| `JWT_REFRESH_SECRET` | Dev / Preview / Prod | Keep distinct from access secret |
| `APP_URL` | Preview / Prod | Public URL of the deployed app |
| `FRONTEND_ORIGIN` | Dev / Preview / Prod | Front-end origin for CORS and CSRF checks |
| `SERPAPI_KEY` | Dev / Preview / Prod | Server-side only, never exposed to browser |
| `LLM_API_KEY` | Dev / Preview / Prod | Optional evaluator API key |
| `SMTP_HOST` | Dev / Preview / Prod | SMTP transporter for email verification |
| `GOOGLE_CLIENT_ID` | Dev / Preview / Prod | Optional OAuth provider |
| `GOOGLE_CLIENT_SECRET` | Dev / Preview / Prod | Optional OAuth provider |
| `BLOB_READ_WRITE_TOKEN` | Preview / Prod | Vercel Blob or object-storage token |
| `REDIS_URL` | Preview / Prod | Upstash Redis or similar for cache and rate limit storage |
| `VITE_API_BASE_URL` | Browser only | Usually `/api` |

Only variables starting with `VITE_` are safe to expose to the browser. Never add a secret key to a `VITE_*` variable.

For Production, set `DATABASE_URL`, `JWT_ACCESS_SECRET`, and `TOKEN_HASH_SECRET` for database-backed authentication. `DIRECT_URL` is needed when applying Prisma migrations. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `MAIL_FROM` for email verification and password-reset flows; missing SMTP settings should affect those email flows, not prevent the serverless function from initializing.

## 4. CLI commands

```bash
npm install
cp .env.example .env
# fill values
vercel login
vercel
vercel env pull
```

For a specific environment:

```bash
vercel env add DATABASE_URL production
vercel env add DATABASE_URL preview
vercel env add DIRECT_URL production
vercel env add DIRECT_URL preview
vercel env add JWT_ACCESS_SECRET production
```

Before running a production migration from your workstation, pull that environment's variables locally:

```bash
vercel env pull .env
npm run db:migrate
```

Repeat with the Preview environment selected when migrating its separate database. `.env` is ignored by git.

## 5. Vercel-specific production changes

This project has been updated to be serverless-friendly:

- `server/index.mjs` now exports the app and starts `app.listen()` only for local development.
- `/api/index.mjs` exports the app as an ES module for Vercel serverless functions.
- Vercel uses Prisma with PostgreSQL; local development without `DATABASE_URL` continues to use SQLite.
- `vercel.json` rewrites API paths and falls back to `index.html` for React Router routes.
- The app requires production environment variables to be present and fails with a clear message if required values are missing.
- Browser-facing code uses relative `/api` URLs, not hard-coded localhost values.

## 6. Database and storage migration

Vercel functions do not have a durable filesystem. Production must use hosted services:

- Database: Postgres (Neon, Supabase, Railway, or similar)
- Redis: Upstash Redis for cache, throttling, and shared state
- File uploads: Vercel Blob or S3 presigned URLs; keep only storage keys in the database

The local SQLite file-based implementation is for development only. In production, set `DATABASE_URL` to your provider's pooled PostgreSQL URL and `DIRECT_URL` to its direct URL. Prisma's client is cached globally between warm function invocations. Existing local SQLite data is not automatically copied; export and import data separately before switching production traffic.

## 7. Deploy steps

1. Push the repo to GitHub.
2. Import the repo in Vercel.
3. Choose the Vite preset and set the Root Directory to `.`.
4. Set the build command and output directory as above.
5. Add Production and Preview environment variables.
6. Configure a PostgreSQL database and set both `DATABASE_URL` and `DIRECT_URL`. Use separate Preview and Production databases.
7. Run `npm run db:migrate` against the target database, then deploy.
8. Deploy.
9. Check the health endpoint: `/api/health`.
10. Confirm HTTPS and custom domain configuration.

## 8. Verification checklist

After deployment, confirm:

- `/api/health` returns success.
- Front-end routes refresh without 404s.
- Login, signup, and protected routes work.
- Camera and microphone are only enabled on HTTPS.
- No environment variable value appears in the client bundle or network tab.
- Preview deployment uses a separate database and does not mutate production data.
- The app does not expose `SERPAPI_KEY`, SMTP credentials, or OAuth secrets in browser code.

## 9. Troubleshooting

### 404 on refresh

Make sure `vercel.json` is present and the rewrite rule falls back to `index.html` for non-API routes.

### Function timeout

The default function limit is 30 seconds. Long-running tasks such as report generation or LLM evaluation should be split into a start-job + poll pattern or queued job.

### Missing env var

Check `process.env` values in the dashboard. The app intentionally fails fast with a clear error if production-required values are missing.

### Prisma cannot connect or tables are missing

Confirm `DATABASE_URL` points to the pooled PostgreSQL connection and `DIRECT_URL` points to the direct connection. Run `npm run db:migrate` with the correct environment before deploying. `DATABASE_URL` alone does not create tables.

### CORS or cookie errors

Use the same origin for the front end and API, keep cookies `Secure`, `SameSite=Lax`, and ensure `FRONTEND_ORIGIN` matches the deployment URL.

### Upload too large

Direct file uploads are not suitable for Vercel functions because request bodies are limited. Use signed uploads to Blob/S3 instead.

## 10. Cost and quota notes

- Vercel functions are billed by execution time and memory.
- Serverless runtime cold starts can increase latency for the first request.
- SerpApi usage, LLM calls, Blob/S3 storage, and Redis all incur external usage costs.
- Preview and production should be separated to avoid accidental quota exhaustion or cross-environment data mixing.

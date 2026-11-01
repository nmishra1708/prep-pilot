# Say it. See it.

A responsive React + TypeScript app with live dictation, mock interview analysis, job search, study tracking, and secure user accounts.

## Run locally

```sh
npm install
cp .env.example .env
npm run server
npm run dev
```

Open the localhost URL printed by Vite. The Vite dev server proxies `/api` requests to `http://localhost:8787`. Use HTTPS or localhost and allow camera and microphone access. Production frontend builds use `npm run build`; tests use `npm test`.

## Vercel deployment

This project is prepared for a single-repository Vercel deployment with:

- a Vite frontend built to `dist`
- a serverless API exported from `/api/index.mjs`
- `vercel.json` with SPA rewrites and security headers
- a CI workflow for tests and build checks

Follow the instructions in [DEPLOYMENT.md](./DEPLOYMENT.md).

Production uses Prisma with PostgreSQL. Local development without `DATABASE_URL` continues to use the SQLite database. For Vercel, configure both `DATABASE_URL` (pooled) and `DIRECT_URL` (direct), then run `npm run db:migrate` against each environment before using the API. Existing SQLite records are not automatically transferred.

## Job Search & Application Tracker

The **Job tracker** button opens a skills-based Google Jobs search and a locally stored applications list. Add skills and profile suggestions, choose years or a career level, location, remote and optional filters, then search. The backend normalizes SerpApi Google Jobs results, ranks experience requirements, caches identical pages for 45 minutes, and allows 20 requests per minute per client. Cached repeats do not make a new SerpApi request. Search counts are displayed when the upstream response includes them.

To configure SerpApi:

1. Create an account and copy an API key from [SerpApi API key management](https://serpapi.com/manage-api-key).
2. Copy `.env.example` to `.env` in the project root and set `SERPAPI_KEY=...`.
3. Restart `npm run server`.

The key is read only by the Node backend. It is not placed in browser code or returned to the frontend. `.env` is ignored by git. Never add a real key to source control or a Vite `VITE_*` variable.

Without a key, local non-production server runs use bundled sample results from `src/jobs/mock-serpapi.json`; `JOBS_MOCK=true` forces the sample fixture. Production does not silently use mock results. This fixture supports offline UI development, not real listings.

Saved searches/profile skill suggestions and application statuses, notes, and applied dates persist in this browser using localStorage and IndexedDB. They are not uploaded to the backend. Apply links open in a separate tab with `noopener noreferrer`; application status is only updated when you mark it in the tracker. Google Jobs results accessed via SerpApi may be incomplete or expired; verify the role and apply details at the source. Follow SerpApi terms and your account’s current quota and usage limits.

The Applications page filters by status and text, sorts by application date, and exports the current view as CSV. Result cards include a skill-match percentage and show a remembered applied badge when a saved job reappears in later searches.

## Optional model evaluation

Rubric-based local heuristics work without a model key. To enable the optional backend evaluator, set credentials in the backend process environment (never in browser code), then restart the backend:

```powershell
$env:LLM_API_KEY = "<your-server-side-key>"
$env:LLM_API_URL = "https://api.openai.com/v1/chat/completions"
$env:LLM_MODEL = "gpt-4o-mini"
npm run server
```

The server validates request and response data with zod, applies an 8-second provider timeout, and returns a rubric-based fallback when no key is configured or a call fails. The optional evaluator sends answer transcripts and question rubrics from the browser to this backend; if configured, the backend sends them to the model provider. Never put a provider key in frontend code or Vite environment variables.

## Interview mode

1. Select Senior Full-Stack, Node.js Lead, or AI/LLM Engineer; choose technical, behavioural, or mixed questions; select 3–10 questions and an optional answer limit.
2. Read and accept the recording/privacy notice, check your camera and microphone, and start the interview.
3. Each answer is captioned and recorded separately. Retry discards the current attempt; Next saves it and advances; End makes a report from completed answers.
4. Review category scores, timestamped markers, a pace-over-time estimate, answer transcripts and rubrics. Print or save the report as PDF, download a `.txt` transcript, or review past sessions.
5. Use **Delete all my data** to clear locally saved recordings and reports from this browser.

The built-in role question bank and answer rubrics are in `src/interview/question-bank.json`. Scoring helpers in `src/interview/scoring.ts` are pure functions and have sample-transcript tests.

Questions are selected from this built-in bank; dynamic LLM follow-up generation is not currently wired into the interview flow.

## Storage, consent, and privacy

Interview videos, transcripts, and reports are saved locally in IndexedDB on this device. The page does not upload recordings. The browser's speech recognition service processes microphone audio for captions; Chrome may send audio to a cloud service. Optional model evaluation sends only answer transcripts and rubrics to the configured backend and, if enabled there, the model provider. No API key is sent to the browser. Review the consent notice before recording and avoid sensitive personal information.

Camera/microphone preview requests permission before recording. Recordings use `getUserMedia` and `MediaRecorder`; clips are held in memory during the session and persisted with the completed report. If a browser does not support video recording, the transcript and report can still be useful, but a clip may be unavailable.

## Browser support and interpretation limits

Current Chrome or Edge are recommended. The Web Speech API is not consistently supported across browsers. Camera and microphone access needs a secure context (HTTPS or localhost). Speech recognition accuracy and latency vary by accent, microphone, and background noise; recognized text may be incomplete.

All six scores are practice heuristics, not objective measurements:

- **Answer accuracy** uses simple rubric keyword matching unless optional server evaluation is configured. Even model evaluation can be wrong. The report shows the rubric so you can disagree; server evaluation includes missing points, factual concerns, and a sample answer.
- **Communication** flags a small set of filler/hedge/repetition patterns and estimates sentence clarity from the transcript.
- **Time management** uses answer duration and approximate first recognized word time.
- **Voice delivery** estimates pace from transcript changes and uses Web Audio level, zero-crossing pitch variation, and low-energy pauses. These are coarse estimates, not a clinical or phonetic assessment.
- **Answer structure** looks for STAR cues for behavioural answers and Context → Approach → Trade-off → Result cues for technical answers.
- **Nervousness signals** are only a rough audio heuristic using pace, filler, and pause signals. They are not a diagnosis or a reliable conclusion about a person.

Face-based cues are not implemented or collected. Face-related behaviour can be less accurate for some people and should only be used with explicit opt-in and careful validation.

## Acceptance checks

- [ ] With camera/microphone permission and a supported browser, complete a five-question session; each answer has its own transcript, duration, and recording when `MediaRecorder` is available.
- [ ] Verify interim captions update to confirmed words, Retry discards one attempt, Next advances, and the per-answer timer stops at its limit.
- [ ] Verify all six categories include a score, timestamped evidence, and a concrete fix; review the visible rubric before relying on answer accuracy.
- [ ] Complete a later session in the same role and confirm the report compares it with the previous session.
- [ ] Print/save a report as PDF; export the transcript; delete all data and confirm the history is empty.
- [ ] Run `npm test` and `npm run build`.

The report uses fast local scoring, so a report is shown immediately after the final answer. Optional model evaluation is bounded by an 8-second backend timeout.

Job tracker acceptance checks:

- [ ] Search for Node.js and React, 5 years, Indore; verify normalized cards, experience and skill badges, and an external apply link with `noopener noreferrer`.
- [ ] Repeat identical searches and verify the backend response has `X-Search-Cache: HIT`; no second SerpApi request should be made within 45 minutes.
- [ ] Mark a role as applied, edit its date, reload, and confirm the date/status remain in My Applications.
- [ ] Save the same job from repeated searches and confirm one row per job id; change each status, filter and sort, then export CSV.
- [ ] Confirm missing key uses offline fixtures only in development, invalid filters return 400, and the built frontend contains no `SERPAPI_KEY`.

## Company Interview Tracker and Study Library

Open **Interview & study** from the app header. The feature adds a company interview tracker with editable interview details, round timeline, contacts, questions, reminders, `.ics` downloads, and quick company/topic statistics. Interview questions can be copied into the Study Library with a link back to the source interview. Interviews can also be associated with an application record by its tracker ID.

The Study Library supports topic grouping and search, filters for difficulty/confidence/bookmarks, Markdown answers with sanitized previews and highlighted code blocks, Mermaid diagrams, and validated PNG/JPG/SVG uploads (2 MB maximum). Study mode has flashcards, a practice timer, confidence updates, and next-review dates. Export the feature's records as JSON or export filtered study items as Markdown; JSON and Markdown files can be imported from the Study Library.

### Persistence, privacy, and API

Local development without `DATABASE_URL` creates a SQLite database at `server/data/app.sqlite` and seeds it with three example interviews and ten study items. When `DATABASE_URL` is configured, the backend uses Prisma with PostgreSQL; Vercel always requires this hosted database. Run `npm run db:migrate` to create the PostgreSQL schema. The SQLite database and uploaded diagrams are excluded from source control. Sample HR contacts are fictional. Interview contact information is stored by the backend and is not included in logs.

The REST API validates request bodies and query filters with Zod:

- `GET /api/interviews?q=&status=&company=&from=&to=&page=&limit=`
- `GET`, `POST`, `PUT`, `PATCH`, and `DELETE /api/interviews/:id`
- `GET /api/study-items?q=&topic=&difficulty=&confidence=&bookmarked=&page=&limit=`
- `GET`, `POST`, `PUT`, `PATCH`, and `DELETE /api/study-items/:id`
- `POST /api/study-items/diagrams` accepts one validated image in the `diagram` multipart field.
- `GET /api/data/export` exports interviews and study items; `DELETE /api/data` removes these server-side records and uploaded diagrams.

Markdown is sanitized in the browser with DOMPurify before preview rendering. Mermaid uses strict security mode. Uploaded SVG files are sanitized on the backend, file names are generated by the server, image type signatures are checked, and uploads are size-limited. Never treat user-authored Markdown, Mermaid, or uploaded images as trusted content.

### Acceptance checks

- [ ] Create, edit, filter, and delete an interview with multiple rounds and questions; reload the page and verify the data persists.
- [ ] Add a question to study material, then verify the source interview/company link is present.
- [ ] Create and edit a Markdown answer containing code, render a Mermaid diagram, and confirm an unsafe HTML/script payload is absent from the preview.
- [ ] Reject invalid HR email/phone values, malformed diagrams, non-image uploads, and images larger than 2 MB.
- [ ] Use flashcards and practice timing, update confidence, and verify the next review date changes.
- [ ] Export/import JSON and Markdown, export all feature data, and delete all feature data.
- [ ] Run `npm test` and `npm run build`.

## Accounts, authentication, and private data

The app now requires an account for all workspace routes. Create an account at `/signup`, verify the address from the emailed link, and sign in at `/login`. Job search and third-party answer evaluation remain blocked until the email is verified. From **Profile**, users can update their name, change a password, review/revoke sessions, log out of every device, export their data, delete only their saved records, or permanently delete the account.

### Backend setup

Copy `.env.example` to `.env`. The sample values are placeholders; set two different randomly generated secrets for production:

- `JWT_ACCESS_SECRET`: at least 32 characters. Access tokens last 15 minutes.
- `TOKEN_HASH_SECRET`: at least 32 characters. Refresh and email action tokens are stored as keyed hashes.
- `FRONTEND_ORIGIN`: the exact frontend origin, including scheme and port. The backend rejects other browser origins.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `MAIL_FROM`: configure a transactional SMTP service for verification and reset emails.

Run the app and API in separate terminals:

```powershell
Copy-Item .env.example .env
npm.cmd run server
npm.cmd run dev
```

In local development without SMTP, the backend queues verification and reset mail in memory. Open `http://127.0.0.1:8787/api/dev-mailbox/<url-encoded-email>` from the same machine to retrieve the latest link for that address. The mailbox is development-only, loopback-restricted, and is not available in production. Do not share its URLs.

Production deployment must use HTTPS and a matching HTTPS `FRONTEND_ORIGIN`. Secure cookies are enabled automatically in production. Put the backend behind a trusted TLS-terminating proxy, set the correct proxy configuration, and do not expose the development mailbox. Google OAuth is optional and is not configured in this project.

### Ownership and migration

Interview/study records and uploaded diagrams are scoped to the authenticated user in the API/repository layer. Browser-held mock recordings, job applications, drafts, and preferences use per-account IndexedDB/localStorage namespaces. The first account created automatically claims existing unowned SQLite records and legacy browser databases.

To explicitly assign any still-unowned legacy database records to an existing account, run:

```powershell
$env:LEGACY_DATA_OWNER_EMAIL = "account@example.com"
npm.cmd run migrate:legacy
```

Or pass the account email as the script argument: `node server/auth/claim-legacy-data.mjs account@example.com`. The migration only claims unowned records; it never reassigns data that already belongs to an account. Back up `APP_DATABASE` before running migration commands.

### Security checklist

- Passwords use bcrypt with cost 12. Passwords must be at least 10 characters; a common-password blocklist is enforced. Login errors do not disclose whether an email exists, and ten consecutive invalid attempts lock an account temporarily.
- Access and rotating refresh credentials are in `HttpOnly`, `SameSite=Lax` cookies (Secure in production), never localStorage. State-changing requests use a separate CSRF token and origin check.
- Signup, login, reset, and account endpoints validate request data with Zod; the auth endpoints have IP and email rate limits. Password reset and verification links are single-use; reset links expire after 30 minutes.
- Auth audit entries record event, time, user, and IP only—not passwords, action tokens, or reset URLs. Mail delivery logs do not include verification/reset links.
- Authenticated API requests are filtered by user ID; missing cross-user resources return 404. Uploaded diagrams are stored in per-user folders and require authentication to retrieve.
- The browser stores video clips and job applications locally in per-user IndexedDB databases. Account export includes local recordings as base64 in JSON; protect downloaded exports accordingly. Account deletion removes server records/files and browser data on the current device. It cannot reach other devices that are offline; those devices' local copies should be deleted there too.
- Sign out clears the current in-memory workspace; account data is not cleared on ordinary logout. Use **Delete all my data** or **Delete account** when removal is intended.

### Authentication acceptance checks

- [ ] Create an account, retrieve the local verification email or use SMTP, verify it, and confirm the profile banner disappears.
- [ ] Sign in with Remember me both off and on; refresh/reload and verify the session restores without token storage in localStorage.
- [ ] Request a password reset for both known and unknown emails; verify the response is identical, the link expires after 30 minutes, and reuse is rejected.
- [ ] Submit ten invalid passwords; confirm the account is temporarily locked and the response remains generic.
- [ ] Create separate accounts and confirm each cannot read the other's interviews, study material, applications, or interview history.
- [ ] Change the password, revoke a session, log out of all devices, and permanently delete the account; verify server files and local browser data are removed.
- [ ] Run `npm.cmd test` and `npm.cmd run build`.

# SmartOPD (PS-031)

Virtual OPD queue plus a live bed board for one fictional hospital, **City General Hospital**. Every patient and bed is demo data.

- **Virtual OPD**: check in on a phone, get a token such as `GM-012`, see people ahead and a live wait. When the doctor calls, the page flips to "It's your turn. Go to Room 2." No refresh.
- **Live bed board**: ward staff keep General / ICU / Oxygen bed status current; the public wall board changes in the same second.

Not built on purpose: billing, insurance, IoT or biometric bed sensors, an enterprise HIS.

## Setup

Needs Node 20+ and PostgreSQL (local, or a Supabase connection string used unchanged).

```bash
npm install                       # also generates the Prisma client
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local     # JWT_SECRET must match the server's
# no Postgres installed? start a throwaway one on :54329 (matches .env.example):
npm run db:local                  # leave running in its own terminal
npm run db:migrate && npm run db:seed
npm run dev                       # server :4000, web :3000
```

`npm run db:reset` drops everything, re-migrates and re-seeds.

## Demo accounts (password `demo1234`)

| Email | Who | Role |
|---|---|---|
| admin@citygeneral.demo | Priya Shah | ADMIN |
| rao@citygeneral.demo | Dr. Anita Rao, GM, Room 2 | DOCTOR |
| menon@citygeneral.demo | Dr. Suresh Menon, GM, Room 3 | DOCTOR |
| kulkarni@citygeneral.demo | Dr. Kavita Kulkarni, PD, Room 7 | DOCTOR |
| qureshi@citygeneral.demo | Dr. Farhan Qureshi, OR, Room 11 | DOCTOR |

## 60-second demo script

1. Put `/beds` (wall board) on the shared screen.
2. On a phone open `/checkin`, fill the form, send the code (the demo SMS panel shows it), verify. You land on `/token/…` with "Ahead of you".
3. Laptop: sign in as Rao at `/doctor`. Re-triage the new token to **Emergency**, press **Call next** (or `N`).
4. The phone flips to `→ ROOM 2` with a blink and chime.
5. Second laptop: sign in as admin at `/admin`, tap a vacant ICU bed. The wall's ICU count drops immediately.
6. In the admin header turn on **Demo simulator**: check-ins, calls and bed churn start (labelled "simulated for hackathon demonstration").

## Alerts by email

- **Patients (optional):** at check-in a patient can enter an email. Only if they do, they get an email when their live position reaches **2nd** ("You're 2nd in line. Please be ready, your turn is approaching.") and again at **1st** ("You're next! Please proceed toward the consultation area."), each sent once. The token page shows the same two alerts in-app. No email means no emails; there is no SMS.
- **Priority 1 and 2:** if the patient gave an email and their token is Emergency or Urgent (at check-in, or after a doctor re-triages it), they also get a priority email. Nothing is sent to a fixed staff address.
- Mail is sent from `ALERT_EMAIL_FROM` through `SMTP_URL`, on a pool of `MAIL_WORKERS` (default 3) worker threads so SMTP never blocks the realtime server and alerts go out in parallel; staff Emergency/Urgent alerts are sent ahead of queued patient emails. With `SMTP_URL` empty (default) emails are only logged and listed in the admin Activity log. Set `PUBLIC_WEB_URL` to your live site so the email links to the token page.

## Hosting

See [HOSTING.md](HOSTING.md) for a step-by-step guide (Supabase + Render + Vercel).

## Architecture

```
 phone / wall / doctor / admin  (Next.js 15, React 19, Tailwind v4)
        |  REST /api/*  (same-origin rewrite -> first-party cookie)
        |  Socket.io (acked commands, room joins, seq-stamped pushes)
        v
 Express + Socket.io  --  command bus  --  domain services (in a transaction)
                                              |         \
                                  Prisma 7 + pg  <-- after commit: hub.applyEffects -> rooms
                                  PostgreSQL            (+ priority alert email)
```

- **One command bus, two transports.** Every socket command and `POST /api/commands/:name` call `execute()`: zod parse, idempotency check, one transaction (domain write + `ProcessedCommand`), effects only after commit.
- **Server-authoritative, seq-stamped projections.** Each push is a full projection stamped from `event_seq`; clients ignore anything older, and a join ack is the authoritative snapshot. A 60 s heartbeat republishes so countdowns stay honest.
- **Room scoping.** `dept:` (labels only, never names), `token:` (unguessable id is the access), `staff:dept:`, `public:beds`, `admin:dashboard`.
- **Locks and idempotency.** `FOR UPDATE` on department (numbering) and doctor; `FOR UPDATE SKIP LOCKED` for call-next; guarded `updateMany` on version for tokens and beds; `requestId` replays return the stored result.
- **ETA model.** A small discrete-event model over on-duty doctors using a rolling average of the last 5 real consults (`packages/shared/src/eta.ts`).
- **Audit trail.** Every state change writes an `AuditLog` row; the admin Activity tab renders it as sentences.
- **Auth.** Local HS256 JWT in an httpOnly cookie, plus a 120 s socket ticket. Roles: ADMIN, DOCTOR, RECEPTIONIST.
- **Resilience.** Socket command with REST fallback (same requestId), 5 s polling while the socket is down, "Backup connection" badge.

## Tests

```bash
npm test                 # shared unit tests (13) + server integration tests (12, real DB, re-seeded)
npm run typecheck
cd apps/web && npx next build && npx next start -p 3000    # production build
cd apps/web && npx playwright install chromium             # once, if no Chrome/Edge is installed
npm run e2e -w @smartopd/web   # four browser contexts; screenshots in apps/web/review/
```

Restart the server and use a fresh production build before trusting E2E results; stale `tsx` / `next dev` processes cause false failures.

## Deviations and notes

- Auth is a local JWT shaped so Supabase Auth can replace it later.
- Migrations are hand-written SQL applied by `scripts/migrate.ts` (not `prisma migrate`); `scripts/generate.mjs` falls back to a stub schema-engine if binaries can't be downloaded.
- No shadcn; all components are hand-built.
- Patients cannot self-select Emergency; the public queue never carries names.
- `bed:updated` goes to the admin room only. The public room gets `bed:aggregate`, because bed events carry patient names.
- `GET /auth/socket-ticket` returns `ticket: null` (HTTP 200) for anonymous visitors so public pages don't log a failed request.
- The OTP is a mock: the code is shown on screen and no SMS is sent.

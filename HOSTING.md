# Hosting SmartOPD

SmartOPD is three pieces. Host each where it fits:

| Piece | What it is | Where to host | Why |
|---|---|---|---|
| Database | PostgreSQL | **Supabase** (free) | Works unchanged with the connection string |
| Realtime server | `apps/server` (Express + Socket.io) | **Render**, Railway or Fly.io | Needs a long-running process for websockets. Vercel/Netlify serverless **cannot** host it |
| Web app | `apps/web` (Next.js) | **Vercel** | Native Next.js host |

Do the steps in order: database, server, web, then wire the web URL back into the server.

> Run exactly **one** server instance. Socket rooms, the simulator flag and "connected doctors" live in that process's memory. To scale out you would need the Socket.io Redis adapter, which this prototype doesn't include.

---

## 0. Put the code on GitHub

```bash
cd smartopd
git init
git add .
git commit -m "SmartOPD"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/smartopd.git
git branch -M main
git push -u origin main
```

`.gitignore` already excludes `node_modules`, `.env`, `.env.local`, `.pgdata` and the generated Prisma client.

## 1. Database: Supabase

1. Create a free project at supabase.com. Pick the region nearest your users (Mumbai for India). Save the database password.
2. Open **Project Settings → Database → Connection string**. Use the **Session pooler** string (port 5432) or the **Direct** one:
   ```
   postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```
   Do **not** use the Transaction pooler (port 6543). The app relies on row locks (`FOR UPDATE`) inside transactions.
   If your password has special characters, URL-encode them (`@` becomes `%40`).
3. Create the tables and demo data from your own machine, once:

   ```bash
   # PowerShell
   $env:DATABASE_URL="postgresql://postgres...:5432/postgres"
   npm run db:migrate
   npm run db:seed
   ```
   ```bash
   # macOS / Linux / Git Bash
   DATABASE_URL="postgresql://postgres...:5432/postgres" npm run db:migrate
   DATABASE_URL="postgresql://postgres...:5432/postgres" npm run db:seed
   ```

   `db:seed` **wipes all data** and loads the demo hospital. Run it again right before a demo so today's tokens and "confirmed N min ago" look fresh. Never run it against a database holding data you care about.

## 2. Realtime server: Render

1. On render.com: **New → Web Service**, connect your GitHub repo.
2. Settings:
   - **Root Directory**: leave empty (repo root, because of npm workspaces)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm run start:prod -w @smartopd/server` (applies any new migration, then starts)
   - **Health Check Path**: `/api/health`
   - **Instance type**: Starter or higher. The **free tier sleeps** after about 15 minutes, which drops sockets and makes the first visit slow. For a hackathon demo, upgrade for the day or open the site just before presenting.
3. Environment variables:

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | the Supabase string from step 1 |
   | `JWT_SECRET` | a long random string (32+ chars), for example from `openssl rand -hex 32` |
   | `WEB_ORIGIN` | your Vercel URL, e.g. `https://smartopd.vercel.app` (no trailing slash; comma-separate several) |
   | `HOSPITAL_NAME` | `City General Hospital` |
   | `SIMULATOR` | `0` (use the admin toggle in the demo) or `1` |
   | `SMTP_URL` | optional. Leave empty to log alerts only |

   You can set `WEB_ORIGIN` after step 3 and redeploy.
4. Deploy, then check `https://<your-server>.onrender.com/api/health`. You should see `{"ok":true,...}`.

Railway and Fly.io work the same way: build `npm install`, start `npm run start:prod -w @smartopd/server`, same variables, and expose the `PORT` they provide (the app reads `PORT`).

## 3. Web app: Vercel

1. On vercel.com: **Add New → Project**, import the same repo.
2. Settings:
   - **Framework**: Next.js (auto-detected)
   - **Root Directory**: `apps/web`
   - Turn on **Include source files outside of the Root Directory** (the app imports `packages/shared`)
   - Leave install and build commands at the defaults. Vercel runs the workspace install from the repo root.
3. Environment variables:

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_REALTIME_URL` | `https://<your-server>.onrender.com` (browser connects here for sockets) |
   | `REALTIME_INTERNAL_URL` | the same URL (Vercel proxies `/api/*` here, which keeps the login cookie first-party) |
   | `JWT_SECRET` | **identical** to the server's (the middleware verifies the session cookie) |

4. Deploy. Copy the production URL, put it in the server's `WEB_ORIGIN` (step 2), and redeploy the server.

> `NEXT_PUBLIC_*` values are baked in at build time. If you change `NEXT_PUBLIC_REALTIME_URL`, **redeploy the web app**.

## Email alerts (Gmail app password)

The app password belongs on the **server** only (Render/Railway, or `apps/server/.env` locally). **Never** put it in Vercel, in the web app, or in GitHub.

1. In the Google account `godsont259@gmail.com`: turn on **2-Step Verification**, then open myaccount.google.com/apppasswords and create an **App Password** (16 characters; remove the spaces).
2. Set on the server:

   | Key | Value |
   |---|---|
   | `SMTP_URL` | `smtps://godsont259%40gmail.com:YOUR_APP_PASSWORD@smtp.gmail.com:465` |
   | `ALERT_EMAIL_FROM` | `SmartOPD <godsont259@gmail.com>` |
   | `PUBLIC_WEB_URL` | your Vercel URL, so patient emails link to the live token page |
   | `MAIL_WORKERS` | optional, default 3 |

3. Redeploy the server. Check in as Urgent and the email should arrive.

## 4. Smoke test (2 minutes)

1. Open `https://<web>/`. The board shows departments and beds, and the badge on `/beds` says **Live**.
2. Phone: `/checkin`, then the code shown on screen, then you get a token.
3. Laptop: `/login`, sign in as `rao@citygeneral.demo` / `demo1234`, go to `/doctor`, re-triage the token to Emergency, press **Call next**. The phone flips to Room 2.
4. `/admin` as `admin@citygeneral.demo`, tap a vacant ICU bed. The `/beds` count changes.

## 5. Before a real audience

- **Change the demo passwords.** Seeded accounts all use `demo1234` and are listed on the login page. For anything public, edit `apps/server/scripts/seed.ts` (and remove the demo-accounts panel in `apps/web/app/login/page.tsx`).
- **Use a fresh `JWT_SECRET`.** Never reuse the dev value.
- **Real alert emails:** set `SMTP_URL` (for example `smtps://user:password@smtp.gmail.com:465` with a Gmail app password, or a Resend/Brevo SMTP URL). Without it, alerts are only logged and shown in the admin Activity log.
- **Custom domain:** add it in Vercel, then update `WEB_ORIGIN` on the server to match.
- This is a prototype with fictional data. Don't put real patient information in it.

## Alternative: one VPS

For a single cheap server (DigitalOcean, AWS Lightsail, etc.):

```bash
# on the VPS: Node 20+, git, and a Postgres (or use Supabase)
git clone https://github.com/<you>/smartopd.git && cd smartopd
npm install
cat > apps/server/.env <<'EOF'
DATABASE_URL=...
JWT_SECRET=...
WEB_ORIGIN=https://yourdomain.com
NODE_ENV=production
EOF
printf "NEXT_PUBLIC_REALTIME_URL=https://api.yourdomain.com\nREALTIME_INTERNAL_URL=http://localhost:4000\nJWT_SECRET=...\n" > apps/web/.env.local
npm run db:migrate && npm run db:seed
cd apps/web && npx next build && cd ../..
npm i -g pm2
pm2 start "npm run start -w @smartopd/server" --name opd-server
pm2 start "npm run start -w @smartopd/web" --name opd-web
```

Put Caddy or Nginx in front with HTTPS: `yourdomain.com` goes to port 3000 and `api.yourdomain.com` goes to port 4000, with **websocket upgrade enabled** on the API host.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Badge stuck on "Connecting / Offline" | `NEXT_PUBLIC_REALTIME_URL` wrong, or you didn't redeploy the web app after changing it. Check the server URL in a browser. |
| Browser console shows a CORS error | `WEB_ORIGIN` on the server doesn't exactly match the web URL (scheme and host, no trailing slash). |
| Login works but `/doctor` bounces back to `/login` | `JWT_SECRET` differs between server and web. |
| `/api/...` returns 404 or 500 on the web app | `REALTIME_INTERNAL_URL` missing or wrong on Vercel. |
| Build fails with "Cannot find module @smartopd/shared" | Vercel's "include files outside root directory" is off, or Root Directory isn't `apps/web`. |
| Server crashes on start: invalid environment | `JWT_SECRET` shorter than 32 characters, or `DATABASE_URL` missing. |
| "prepared statement" or lock errors | You used Supabase's Transaction pooler (6543). Switch to the Session pooler (5432) or Direct. |
| First visit takes about 30 s | Free tier waking up. Use a paid instance, or open the site beforehand. |
| Board shows no tokens or old times | Run `npm run db:seed` against the hosted database just before the demo. |

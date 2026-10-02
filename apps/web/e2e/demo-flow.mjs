// End-to-end demo flow with four separate browser contexts: phone, doctor laptop, admin laptop, wall.
// Usage: node e2e/demo-flow.mjs http://localhost:3000
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = new URL("../review/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
mkdirSync(OUT, { recursive: true });

const problems = [];
const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); if (!ok) problems.push(name); };

async function launch() {
  let last;
  for (const opt of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try { return await chromium.launch(opt); } catch (e) { last = e; }
  }
  throw last;
}

const browser = await launch();
const newPage = async (ctx, tag) => {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { problems.push(`[${tag}] pageerror: ${e.message}`); console.log(`ERROR [${tag}] pageerror: ${e.message}`); });
  page.on("console", (m) => { if (m.type() === "error") { problems.push(`[${tag}] console.error: ${m.text()}`); console.log(`ERROR [${tag}] console.error: ${m.text()}`); } });
  return page;
};
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });

const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const doctorCtx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
const adminCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const wallCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const landingCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

async function signIn(page, who, next) {
  await page.goto(`${BASE}/login?next=${next}`);
  await page.getByRole("button", { name: new RegExp(who) }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**${next}`, { timeout: 15000 });
}

try {
  // ---- landing (desktop + mobile)
  const landing = await newPage(landingCtx, "landing");
  await landing.goto(BASE);
  await landing.getByText("Now serving · OPD").waitFor();
  await landing.locator("text=waiting").first().waitFor({ timeout: 8000 });
  await landing.waitForTimeout(600);
  await shot(landing, "01-landing-desktop");
  const lefts = await landing.evaluate(() => [...document.querySelectorAll('[class*="max-w-[1320px]"]')].map((e) => Math.round(e.getBoundingClientRect().left)));
  check("landing: header, sections and footer share one container edge", new Set(lefts).size === 1, `lefts=${[...new Set(lefts)]}`);

  const phone = await newPage(phoneCtx, "phone");
  await phone.goto(BASE);
  await phone.getByText("Now serving · OPD").waitFor();
  await phone.waitForTimeout(600);
  await shot(phone, "02-landing-mobile");
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("landing mobile: no horizontal scroll", overflow <= 0, `overflow=${overflow}`);

  // ---- 1. phone check-in
  await phone.goto(`${BASE}/checkin`);
  await phone.getByLabel("Full name").fill("Demo Patient");
  await phone.getByLabel("Mobile number").fill("9876543210");
  await phone.getByLabel("Age (optional)").fill("34");
  await phone.getByText("General Medicine", { exact: false }).first().click();
  await phone.getByText("waiting ·").first().waitFor();
  await shot(phone, "03-checkin");
  await phone.getByRole("button", { name: "Send code" }).click();
  await phone.getByLabel("Demo SMS").waitFor();
  const code = await phone.locator('[aria-label="Demo SMS"] [role="img"]').getAttribute("aria-label");
  check("OTP: demo code shown on screen", /^\d{4}$/.test(code ?? ""), `code=${code}`);
  await phone.waitForTimeout(500);
  await shot(phone, "04-otp");
  await phone.getByLabel("4-digit code").fill(code);
  await phone.getByRole("button", { name: "Verify and get token" }).click();
  await phone.waitForURL("**/token/**", { timeout: 15000 });
  await phone.getByText("Ahead of you").waitFor({ timeout: 10000 });
  await phone.waitForTimeout(600);
  await shot(phone, "05-token-waiting");
  const tokenLabel = (await phone.locator('[aria-label^="Token "]').first().getAttribute("aria-label")).replace("Token ", "");
  const aheadPhone = Number(await phone.locator('[data-testid="ahead"] [role="img"]').getAttribute("aria-label"));
  console.log(`      token ${tokenLabel}, ahead on phone: ${aheadPhone}`);

  const numberLine = await phone.evaluate((label) => {
    const el = [...document.querySelectorAll('[role="img"]')].find((e) => e.getAttribute("aria-label") === label.split("-")[1]);
    if (!el) return null;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    return { h: el.getBoundingClientRect().height, fs, overflowX: document.documentElement.scrollWidth - window.innerWidth };
  }, tokenLabel);
  check("token number is on one line", !!numberLine && numberLine.h <= numberLine.fs * 1.4, JSON.stringify(numberLine));
  check("token page: no horizontal scroll on phone", !!numberLine && numberLine.overflowX <= 0);

  // ---- 2. doctor
  const doc = await newPage(doctorCtx, "doctor");
  await signIn(doc, "Dr. Anita Rao", "/doctor");
  await doc.getByText("General Medicine · Room 2").waitFor({ timeout: 10000 });
  await doc.getByText("Call next").first().waitFor();
  // finish whoever is currently with Rao
  const startBtn = doc.getByRole("button", { name: /Patient is here/ });
  if (await startBtn.isVisible().catch(() => false)) { await startBtn.click(); await doc.getByRole("button", { name: "Complete" }).waitFor(); }
  const completeBtn = doc.getByRole("button", { name: "Complete" });
  if (await completeBtn.isVisible().catch(() => false)) { await completeBtn.click(); await doc.getByText(/completed/).first().waitFor(); }
  await doc.waitForTimeout(500);
  const row = doc.locator("li", { hasText: tokenLabel }).first();
  await row.waitFor({ timeout: 8000 });
  const position = Number((await row.locator("span").first().innerText()).trim());
  check('"Ahead of you" equals doctor-queue position minus 1', aheadPhone === position - 1, `phone ahead=${aheadPhone}, doctor position=${position}`);
  await shot(doc, "06-doctor");
  await row.getByLabel(`Urgency for ${tokenLabel}`).selectOption("EMERGENCY");
  await doc.getByText(/set to Emergency/).waitFor();
  await doc.waitForTimeout(400);
  const callBtn = doc.getByRole("button", { name: /Call next/ });
  await callBtn.waitFor();
  const t0 = Date.now();
  await callBtn.click();
  await phone.locator('[role="img"][aria-label="→ ROOM 2"]').waitFor({ timeout: 5000 });
  const callLatency = Date.now() - t0;
  console.log(`LATENCY doctor "Call next" -> phone shows "→ ROOM 2": ${callLatency} ms`);
  check("phone flips to → ROOM 2 within 5 s, no reload", callLatency < 5000, `${callLatency} ms`);
  await phone.getByText(/It's your turn/).waitFor();
  await phone.waitForTimeout(2200); // let the blink and wipe finish
  await shot(phone, "07-token-called");
  const title = await phone.title();
  check("tab title becomes 'Your turn · Room 2'", title === "Your turn · Room 2", title);
  await doc.waitForTimeout(500);
  await shot(doc, "08-doctor-after-call");

  // ---- 3. wall + admin
  const wall = await newPage(wallCtx, "wall");
  await wall.goto(`${BASE}/beds`);
  const icuCount = async () => Number(await wall.locator('section[aria-label="ICU beds"] [role="img"]').first().getAttribute("aria-label"));
  await wall.locator('section[aria-label="ICU beds"] [role="img"]').first().waitFor({ timeout: 10000 });
  await wall.waitForTimeout(800);
  const before = await icuCount();
  await shot(wall, "09-wall-before");
  const fit = await wall.evaluate(() => ({ sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth }));
  check("wall fits 1920x1080 with no scroll", fit.sh <= 1080 && fit.sw <= 1920, JSON.stringify(fit));
  const clockVisible = await wall.evaluate(() => { const c = document.querySelector("header .invisible"); return !c; });
  check("wall clock is visible once mounted (no placeholder ink)", clockVisible);
  const ssr = await (await fetch(`${BASE}/beds`)).text();
  check("wall clock is invisible in server HTML", /class="invisible"[^>]*>\s*<span[^>]*aria-label="00:00"/.test(ssr) || ssr.includes('class="invisible"'));

  const admin = await newPage(adminCtx, "admin");
  await signIn(admin, "Priya Shah", "/admin");
  await admin.getByText("Confirm counts").first().waitFor({ timeout: 10000 });
  await shot(admin, "10-admin");
  const vacantIcu = admin.getByRole("button", { name: /^Bed ICU-\d+: Vacant/ }).first();
  await vacantIcu.waitFor({ timeout: 8000 });
  const t1 = Date.now();
  await vacantIcu.click();
  await wall.waitForFunction((n) => Number(document.querySelector('section[aria-label="ICU beds"] [role="img"]')?.getAttribute("aria-label")) === n, before - 1, { timeout: 5000 });
  const bedLatency = Date.now() - t1;
  console.log(`LATENCY admin taps vacant ICU bed -> wall count ${before} -> ${before - 1}: ${bedLatency} ms`);
  check("wall ICU count drops by one within 5 s", bedLatency < 5000, `${bedLatency} ms`);
  await wall.waitForTimeout(900);
  await shot(wall, "11-wall-after");

  // ---- login screen, signed out
  const anon = await newPage(await browser.newContext({ viewport: { width: 1366, height: 820 } }), "login");
  await anon.goto(`${BASE}/login`);
  await anon.getByText("Demo accounts").waitFor();
  await shot(anon, "12-login");
  await anon.goto(`${BASE}/doctor`);
  check("signed-out /doctor redirects to /login?next=", /\/login\?next=%2Fdoctor/.test(anon.url()), anon.url());
} catch (e) {
  problems.push(`flow aborted: ${e.message}`);
  console.error(e);
} finally {
  await browser.close();
}

console.log(`\nScreenshots in ${OUT}`);
if (problems.length) { console.log(`\nFAILED (${problems.length}):\n- ${problems.join("\n- ")}`); process.exit(1); }
console.log(`\nAll ${checks.length} checks passed, zero page/console errors.`);

"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { SessionUser } from "@smartopd/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { resetSocket } from "@/lib/realtime";
import { CONTAINER } from "@/lib/layout";
import {PublicHeader} from "@/components/brand";
import { Button, Field, LedPanel, PanelLabel } from "@/components/ui";

const DEMO = [
  { email: "admin@citygeneral.demo", who: "Priya Shah", role: "Admin" },
  { email: "rao@citygeneral.demo", who: "Dr. Anita Rao", role: "General Medicine" },
  { email: "menon@citygeneral.demo", who: "Dr. Suresh Menon", role: "General Medicine" },
  { email: "kulkarni@citygeneral.demo", who: "Dr. Kavita Kulkarni", role: "Pediatrics" },
  { email: "qureshi@citygeneral.demo", who: "Dr. Farhan Qureshi", role: "Orthopedics" },
];

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const denied = params.get("denied") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null); setBusy(true);
    const r = await api<SessionUser>("/auth/login", { method: "POST", json: { email, password } });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    resetSocket();
    const role = r.data.role;
    const allowed = next && ((next.startsWith("/doctor") && (role === "DOCTOR" || role === "ADMIN")) || (next.startsWith("/admin") && (role === "ADMIN" || role === "RECEPTIONIST")));
    router.push(allowed ? next! : role === "DOCTOR" ? "/doctor" : "/admin");
  };

  return (
    <main className={cn(CONTAINER, "grid items-start gap-10 py-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:gap-14 lg:py-16")}>
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Staff sign in</h1>
        <p className="mt-2 text-base text-ink-2">For doctors and ward staff of City General Hospital.</p>
        {denied && <p role="alert" className="mt-4 rounded-lg bg-low-tint p-3 font-bold text-low-text">That page needs a different role. Sign in with another account.</p>}
        <form className="mt-6 space-y-5" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p role="alert" className="font-bold text-crit-text">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy || !email || !password}>{busy ? "Signing in…" : "Sign in"}</Button>
        </form>
      </div>
      <LedPanel className="p-5 sm:p-7">
        <PanelLabel>Demo accounts · password demo1234</PanelLabel>
        <ul className="mt-3">
          {DEMO.map((d) => (
            <li key={d.email} className="border-t border-bezel-hi first:border-t-0">
              <button type="button" onClick={() => { setEmail(d.email); setPassword("demo1234"); }} className="flex min-h-14 w-full items-center justify-between gap-4 py-2 text-left hover:bg-led-dim/60">
                <span><span className="block text-lg font-extrabold text-led-soft">{d.who}</span><span className="block text-sm text-led-ink">{d.email}</span></span>
                <span className="led-caps shrink-0">{d.role}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-led-ink">Tap an account to fill the form. Demo data only.</p>
      </LedPanel>
    </main>
  );
}

export default function Login() {
  return (
    <>
      <PublicHeader><span /></PublicHeader>
      <Suspense><LoginForm /></Suspense>
    </>
  );
}

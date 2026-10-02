"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut } from "lucide-react";
import type { SessionUser } from "@smartopd/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { resetSocket, useConnection } from "@/lib/realtime";
import { Button, Lamp, type LampTone } from "./ui";

import { CONTAINER, HOSPITAL } from "@/lib/layout";

export function Wordmark({ className, onPanel }: { className?: string; onPanel?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xl font-extrabold tracking-tight", onPanel ? "text-led-soft" : "text-ink", className)}>
      Smart
      <span className="inline-flex items-center rounded-[5px] border border-bezel-hi bg-panel px-1.5 py-1">
        <span className="led-text text-[0.95rem]" aria-hidden>OPD</span>
        <span className="sr-only">OPD</span>
      </span>
    </span>
  );
}

const BADGE: Record<string, { tone: LampTone; text: string }> = {
  live: { tone: "ok", text: "Live" },
  connecting: { tone: "low", text: "Connecting" },
  reconnecting: { tone: "low", text: "Reconnecting" },
  offline: { tone: "crit", text: "Offline · retrying" },
  degraded: { tone: "low", text: "Backup connection" },
};

export function ConnectionBadge({ degraded, dark, className }: { degraded?: boolean; dark?: boolean; className?: string }) {
  const state = useConnection();
  const b = BADGE[degraded && state !== "live" ? "degraded" : state]!;
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold",
        dark ? "on-panel border border-bezel-hi bg-panel text-led-soft" : "border border-rule bg-sheet text-ink",
        className,
      )}
    >
      <Lamp tone={b.tone} pulse={state === "live"} />
      {b.text}
    </span>
  );
}

export function PublicHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="border-b border-rule">
      <div className={cn(CONTAINER, "flex min-h-16 items-center justify-between gap-4")}>
        <Link href="/" className="flex flex-wrap items-center gap-x-3 gap-y-0 no-underline">
          <Wordmark />
          <span className="hidden text-sm font-bold text-ink-2 sm:inline">{HOSPITAL}</span>
        </Link>
        {children ?? (
          <Link href="/login" className="inline-flex min-h-12 items-center px-2 text-base font-bold text-act">Staff sign in</Link>
        )}
      </div>
    </header>
  );
}

export function StaffHeader({ title, subtitle, children, degraded }: { title: string; subtitle?: string; children?: ReactNode; degraded?: boolean }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  useEffect(() => {
    void api<SessionUser>("/auth/me").then((r) => r.ok && setUser(r.data));
  }, []);
  const signOut = async () => {
    await api("/auth/logout", { method: "POST" });
    resetSocket();
    router.push("/login");
  };
  return (
    <header className="border-b border-rule bg-sheet">
      <div className={cn(CONTAINER, "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3")}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <Link href="/" className="no-underline"><Wordmark /></Link>
          <div>
            <h1 className="text-lg font-extrabold leading-tight">{title}</h1>
            {subtitle && <p className="text-sm text-ink-2">{subtitle}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {children}
          <ConnectionBadge degraded={degraded} />
          {user && <span className="text-sm font-bold text-ink-2">{user.name}</span>}
          <Button variant="quiet" onClick={signOut}><LogOut className="size-4" aria-hidden />Sign out</Button>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-16 border-t border-rule">
      <div className={cn(CONTAINER, "py-8 text-sm leading-relaxed text-ink-2")}>
        <p>{HOSPITAL} is a fictional hospital. All patients, beds and queues shown are demo data and may be simulated for hackathon demonstration. SmartOPD does not handle billing, insurance or medical records.</p>
      </div>
    </footer>
  );
}

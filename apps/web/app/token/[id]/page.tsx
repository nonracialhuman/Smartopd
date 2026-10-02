"use client";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, BellOff, Check, Copy } from "lucide-react";
import type { TokenCalledEvent, TokenViewDTO } from "@smartopd/shared";
import { cn } from "@/lib/cn";
import { minutesUntil, minutesSince, PRIORITY_LABEL } from "@/lib/format";
import { useLive, useNow } from "@/lib/realtime";
import { CONTAINER } from "@/lib/layout";
import {ConnectionBadge, PublicHeader} from "@/components/brand";
import { TokenRoute } from "@/components/token-route";
import { Button, DotText, Lamp, LedPanel, PanelLabel } from "@/components/ui";
import { buttonClass } from "@/lib/button";

const CHIME_KEY = "sopd_chime";

function useChime() {
  const [on, setOn] = useState(false);
  const ctx = useRef<AudioContext | null>(null);
  useEffect(() => { try { setOn(localStorage.getItem(CHIME_KEY) === "1"); } catch { /* storage blocked */ } }, []);
  const unlock = () => {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx.current ??= new AC();
      void ctx.current.resume();
    } catch { /* no audio */ }
  };
  const toggle = () => {
    const next = !on;
    setOn(next);
    try { localStorage.setItem(CHIME_KEY, next ? "1" : "0"); } catch { /* storage blocked */ }
    if (next) { unlock(); play(); }
  };
  const play = () => {
    const c = ctx.current;
    if (!c) return;
    [[880, 0], [660, 0.22]].forEach(([f, t]) => {
      const o = c.createOscillator(); const g = c.createGain();
      o.type = "sine"; o.frequency.value = f!;
      g.gain.setValueAtTime(0.0001, c.currentTime + t!);
      g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + t! + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t! + 0.5);
      o.connect(g); g.connect(c.destination); o.start(c.currentTime + t!); o.stop(c.currentTime + t! + 0.55);
    });
  };
  return { on, toggle, play, unlock };
}

const HEAD: Record<string, (t: TokenViewDTO) => { title: string; body: string }> = {
  WAITING: () => ({ title: "You can wait anywhere nearby", body: "This screen updates by itself. Keep it open and we'll tell you the moment it's your turn." }),
  CALLED: (t) => ({ title: `It's your turn. Go to ${t.room ?? "your room"}.`, body: `${t.doctorName ?? "The doctor"} is ready for you. Show this screen at the door.` }),
  IN_CONSULT: (t) => ({ title: "You're with the doctor", body: `Consultation in progress in ${t.room ?? "the room"}. You can close this page.` }),
  COMPLETED: () => ({ title: "All done. Take care.", body: "Your consultation is complete. Collect any prescriptions from the desk." }),
  TRANSFERRED_TO_LAB: () => ({ title: "Please go to the lab", body: "The doctor has sent you for tests. Show this token at the lab counter." }),
  NO_SHOW: () => ({ title: "Your token was closed", body: "You weren't there for either call. Please see the front desk and they'll find you a new slot." }),
  CANCELLED: () => ({ title: "This token was cancelled", body: "If that's a surprise, ask at the front desk, or get a new token." }),
};

const ROUTE_INDEX: Record<string, number> = { WAITING: 0, CALLED: 1, IN_CONSULT: 2, COMPLETED: 3, TRANSFERRED_TO_LAB: 3, NO_SHOW: 1, CANCELLED: 0 };

function callout(t: TokenViewDTO): string | null {
  switch (t.status) {
    case "CALLED": return `→ ${(t.room ?? "").toUpperCase()}`;
    case "IN_CONSULT": return `IN ${(t.room ?? "").toUpperCase()}`;
    case "TRANSFERRED_TO_LAB": return "→ LAB";
    case "COMPLETED": return "DONE";
    case "NO_SHOW": return "MISSED";
    default: return null;
  }
}

export default function TokenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const now = useNow(1000);
  const chime = useChime();
  const [copied, setCopied] = useState(false);
  const { data: t, error, degraded } = useLive<TokenViewDTO>({
    join: { event: "join:token", payload: { tokenId: id } },
    events: [
      { name: "token:updated" },
      // the token:called event carries only the call details; fold it into the current view
      { name: "token:called", map: (e: TokenCalledEvent, cur) => (cur && e.tokenId === cur.id ? { ...cur, seq: e.seq, status: "CALLED", room: e.room, doctorName: e.doctorName, position: null, ahead: null } : null) },
    ],
    restPath: `/tokens/${id}`,
  });

  // called moment
  const prev = useRef<string | null>(null);
  const [calledAt, setCalledAt] = useState(0);
  const baseTitle = useRef("");
  useEffect(() => {
    if (!t) return;
    if (!baseTitle.current) baseTitle.current = document.title;
    if (prev.current && prev.current !== "CALLED" && t.status === "CALLED") {
      setCalledAt(Date.now());
      if (chime.on) chime.play();
      try { navigator.vibrate?.([300, 120, 300, 120, 500]); } catch { /* unsupported */ }
    }
    document.title = t.status === "CALLED" ? `Your turn · ${t.room ?? ""}` : baseTitle.current;
    prev.current = t.status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.status]);

  // position alerts: the banner follows the live position; vibrate/chime once when it moves to 2nd or 1st
  const pos = t?.status === "WAITING" ? t.position : null;
  const prevPos = useRef<number | null>(null);
  useEffect(() => {
    if ((pos === 2 || pos === 1) && prevPos.current !== null && prevPos.current > pos) {
      if (chime.on) chime.play();
      try { navigator.vibrate?.(pos === 1 ? [400, 150, 400, 150, 400] : [250, 120, 250]); } catch { /* unsupported */ }
    }
    if (pos !== null) prevPos.current = pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  if (error && !t) {
    return (
      <>
        <PublicHeader />
        <main className={cn(CONTAINER, "max-w-[640px] py-16 text-center")}>
          <h1 className="text-3xl font-extrabold">We couldn&apos;t find that token</h1>
          <p className="mt-3 text-lg text-ink-2">The link may be mistyped, or the token is from another day.</p>
          <Link href="/checkin" className={buttonClass("primary", "lg", "mt-8")}>Get a new token</Link>
        </main>
      </>
    );
  }
  if (!t) {
    return (<><PublicHeader /><main className={cn(CONTAINER, "max-w-[640px] py-10")}><div className="led-panel h-[22rem]" aria-busy="true" /></main></>);
  }

  const [prefix, num] = [t.label.split("-")[0] + "-", t.label.split("-")[1] ?? ""];
  const head = HEAD[t.status]!(t);
  const waiting = t.status === "WAITING";
  const called = t.status === "CALLED";
  const eta = minutesUntil(t.estimatedCallTime, now);
  const co = callout(t);
  const lampTone = called ? "led" : waiting ? "low" : "ok";
  const fresh = called && calledAt > 0;

  return (
    <>
      <PublicHeader><ConnectionBadge degraded={degraded} /></PublicHeader>
      <main className={cn(CONTAINER, "max-w-[640px] py-6 sm:py-10")}>
        <LedPanel className={cn("p-5 sm:p-7", called && "called-steady")} aria-label={`Token ${t.label}`}>
          <div className="flex items-center justify-between gap-3">
            <PanelLabel>Your token</PanelLabel>
            <span className="inline-flex items-center gap-2 text-sm font-bold text-led-soft"><Lamp tone={lampTone} pulse={waiting} />{t.department.name}</span>
          </div>
          <div className={cn("mt-4 flex items-baseline justify-center gap-1", fresh && "called-blink")} key={calledAt}>
            <DotText value={prefix} className="text-[clamp(2rem,9vw,3rem)]" />
            <DotText value={num} className="text-[clamp(6.5rem,33vw,11rem)]" />
          </div>
          {waiting && (
            <>
              <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-bezel-hi">
                <div className="bg-panel/90 p-4">
                  <PanelLabel>Ahead of you</PanelLabel>
                  <p className="mt-2" data-testid="ahead"><DotText value={String(t.ahead ?? 0)} className="text-5xl" /></p>
                </div>
                <div className="bg-panel/90 p-4">
                  <PanelLabel>Your wait</PanelLabel>
                  <p className="mt-2 min-h-[3rem]">
                    {t.etaMinutes === null && t.doctorsOnDuty === 0 ? (
                      <span className="text-2xl font-extrabold text-low">Paused</span>
                    ) : eta === null ? (
                      <DotText value={`~${t.etaMinutes ?? 0}`} className="text-5xl" />
                    ) : eta === 0 ? (
                      <span className="text-2xl font-extrabold text-led-soft">Any minute now</span>
                    ) : (
                      <><DotText value={`~${eta}`} className="text-5xl" /><span className="ml-1.5 text-base font-bold text-led-ink">min</span></>
                    )}
                  </p>
                </div>
              </div>
              {t.nowServing && <p className="mt-4 text-base font-bold text-led-soft">Now serving {t.nowServing}</p>}
            </>
          )}
          {co && (
            <div className={cn("mt-5 rounded-md border-2 border-led bg-led-dim/70 p-4 text-center", fresh && "callout-in")}>
              <DotText value={co} className="text-[clamp(2.25rem,11vw,3.5rem)]" />
            </div>
          )}
        </LedPanel>

        {waiting && t.position === 1 && (
          <div role="alert" className="mt-6 rounded-lg border-2 border-act bg-act p-4 text-white">
            <p className="text-xl font-extrabold">You&apos;re next!</p>
            <p className="mt-1 text-base">Please proceed toward the consultation area.</p>
          </div>
        )}
        {waiting && t.position === 2 && (
          <div role="status" className="mt-6 rounded-lg border-2 border-low-text/50 bg-low-tint p-4 text-low-text">
            <p className="text-lg font-extrabold">You&apos;re 2nd in line.</p>
            <p className="mt-1 text-base">Please be ready. Your turn is approaching.</p>
          </div>
        )}

        <section className="mt-8" aria-live="polite">
          <h1 className={cn("text-3xl font-extrabold leading-tight tracking-tight", called && "text-act")}>{head.title}</h1>
          <p className="mt-2 text-lg text-ink-2">{head.body}</p>
          {waiting && t.missedCount > 0 && <p className="mt-3 rounded-lg bg-low-tint p-3 font-bold text-low-text">You weren't there when called, so you've been moved to the end of the line. If you miss your next call, this token will be closed.</p>}
          {waiting && t.doctorsOnDuty === 0 && <p className="mt-3 rounded-lg bg-low-tint p-3 font-bold text-low-text">No doctor is on duty in this department right now. Your place is kept.</p>}
        </section>

        <TokenRoute className="mt-10" stops={["Waiting", "Called", "With the doctor", "Done or lab"]} current={ROUTE_INDEX[t.status] ?? 0} />

        <div className="mt-10 flex flex-wrap gap-3">
          <Button variant="secondary" aria-pressed={chime.on} onClick={chime.toggle}>
            {chime.on ? <Bell className="size-5" aria-hidden /> : <BellOff className="size-5" aria-hidden />}
            {chime.on ? "Chime is on" : "Turn on chime"}
          </Button>
          <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } }}>
            {copied ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
            {copied ? "Link copied" : "Copy my token link"}
          </Button>
        </div>

        <dl className="mt-10 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-rule pt-6 text-base">
          <dt className="text-ink-2">Name</dt><dd className="font-bold">{t.patientFirstName}</dd>
          <dt className="text-ink-2">Checked in</dt><dd className="font-bold">{now ? `${minutesSince(t.checkedInAt, now)} min ago` : "…"}</dd>
          <dt className="text-ink-2">Urgency</dt><dd className="font-bold">{PRIORITY_LABEL[t.priority]}</dd>
          <dt className="text-ink-2">{t.doctorName ? "Doctor" : "Department"}</dt><dd className="font-bold">{t.doctorName ?? t.department.name}</dd>
        </dl>
        <p className="mt-8 text-sm text-ink-3">Demo hospital. Everything shown is demo data and may be simulated.</p>
      </main>
    </>
  );
}

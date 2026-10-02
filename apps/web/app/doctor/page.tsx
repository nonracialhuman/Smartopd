"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, FlaskConical, PhoneCall, UserX, DoorOpen } from "lucide-react";
import type { AdminOverviewDTO, Priority, SessionUser, StaffQueueDTO, StaffTokenRow } from "@smartopd/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { minutesSince, PRIORITY_LABEL } from "@/lib/format";
import { command, useLive, useNow } from "@/lib/realtime";
import { CONTAINER } from "@/lib/layout";
import {StaffHeader} from "@/components/brand";
import { useToast } from "@/components/toast";
import { Button, DotText, Lamp, LedPanel, PanelLabel, Segmented, type LampTone } from "@/components/ui";

const STATE: Record<string, { text: string; tone: LampTone }> = {
  CALLED: { text: "Called · waiting at the door", tone: "led" },
  IN_CONSULT: { text: "In consultation", tone: "ok" },
  FREE: { text: "Room free", tone: "ok" },
  BREAK: { text: "On break", tone: "low" },
};

const STATUS_WORD: Record<string, string> = {
  COMPLETED: "Completed", TRANSFERRED_TO_LAB: "Sent to lab", NO_SHOW: "No-show", CANCELLED: "Cancelled", CALLED: "Called", IN_CONSULT: "In consultation",
};

function PriorityBadge({ p }: { p: Priority }) {
  return <span className={cn("rounded px-2 py-0.5 text-sm font-bold", p === "EMERGENCY" ? "bg-crit-tint text-crit-text" : p === "URGENT" ? "bg-low-tint text-low-text" : "bg-wall-deep text-ink-2")}>{PRIORITY_LABEL[p]}</span>;
}

export default function DoctorPage() {
  const toast = useToast();
  const now = useNow(1000);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [overview, setOverview] = useState<AdminOverviewDTO | null>(null);
  const [actingAs, setActingAs] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<SessionUser>("/auth/me").then(async (r) => {
      if (!r.ok) return;
      setUser(r.data);
      if (r.data.role === "ADMIN") {
        const o = await api<AdminOverviewDTO>("/admin/overview");
        if (o.ok) { setOverview(o.data); setActingAs((cur) => cur || o.data.doctors[0]?.id || ""); }
      } else if (r.data.doctorId) setActingAs(r.data.doctorId);
    });
  }, []);

  const adminDoctor = overview?.doctors.find((d) => d.id === actingAs);
  const deptId = user?.role === "ADMIN" ? adminDoctor?.departmentId ?? null : user?.departmentId ?? null;

  const { data: q, degraded } = useLive<StaffQueueDTO>({
    join: deptId ? { event: "join:staff-department", payload: { departmentId: deptId } } : null,
    events: [{ name: "staff:queue-updated" }],
    restPath: deptId ? `/staff/queue/${deptId}` : undefined,
  });

  const me = q?.doctors.find((d) => d.id === actingAs) ?? null;
  const mine = q?.active.find((t) => t.doctorId === actingAs) ?? null;
  const next = q?.waiting[0] ?? null;
  const onBreak = me?.status === "ON_BREAK" || me?.status === "OFFLINE";

  const run = useCallback(async (name: string, payload: Record<string, unknown>, okMsg: string | ((data: any) => string)) => {
    setBusy(true);
    const r = await command(name, payload);
    setBusy(false);
    toast(r.ok ? (typeof okMsg === "function" ? okMsg(r.data) : okMsg) : r.error.message, r.ok ? "ok" : "error");
  }, [toast]);

  const callNext = useCallback(() => {
    if (!actingAs || !me || busy || mine || onBreak || !next) return;
    void run("queue:call-next", { doctorId: actingAs }, `${next.label} called to ${me.room}`);
  }, [actingAs, me, busy, mine, onBreak, next, run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) callNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [callNext]);

  const callReason = useMemo(() => {
    if (!me) return "Loading…";
    if (onBreak) return "You're on break";
    if (mine) return `Finish ${mine.label} first`;
    if (!next) return "No one is waiting";
    return `Next: ${next.label} · ${next.patientName}`;
  }, [me, onBreak, mine, next]);

  const stateKey = !me ? "FREE" : onBreak ? "BREAK" : mine ? mine.status : "FREE";
  const st = STATE[stateKey] ?? STATE.FREE!;
  const others = q ? [...q.active.filter((t) => t.doctorId !== actingAs), ...q.recent] : [];

  return (
    <>
      <StaffHeader title={q && me ? `${q.department.name} · ${me.room}` : "Doctor console"} subtitle={me?.name} degraded={degraded}>
        {user?.role === "ADMIN" && overview && (
          <label className="flex items-center gap-2 text-sm font-bold">
            Acting as
            <select value={actingAs} onChange={(e) => setActingAs(e.target.value)} className="min-h-12 rounded-lg border-2 border-ink-3 bg-white px-3 text-base">
              {overview.doctors.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.room}</option>)}
            </select>
          </label>
        )}
        <Segmented
          name="avail" label="Availability" value={onBreak ? "ON_BREAK" : "AVAILABLE"}
          options={[{ value: "AVAILABLE", label: "Available" }, { value: "ON_BREAK", label: "On break", disabled: !!mine }]}
          onChange={(v) => void run("doctor:update-status", { doctorId: actingAs, status: v }, v === "ON_BREAK" ? "You're on break" : "You're available")}
        />
      </StaffHeader>

      <main className={cn(CONTAINER, "grid gap-8 py-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:gap-12 lg:py-10")}>
        <section aria-label="Current patient" className="space-y-4">
          <LedPanel className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-base font-bold text-led-soft"><Lamp tone={st.tone} />{st.text}</span>
              {me && <DotText value={me.room.replace("Room ", "R")} className="text-3xl" />}
            </div>
            {mine ? (
              <div className="mt-4">
                <DotText value={mine.label} className="text-[clamp(4.5rem,9vw,7.5rem)]" />
                <p className="mt-3 text-2xl font-extrabold text-led-soft">{mine.patientName}{mine.age != null && <span className="font-bold text-led-ink">, {mine.age}</span>}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-4 text-base text-led-ink">
                  <span>{PRIORITY_LABEL[mine.priority]}</span>
                  <span>{mine.status === "CALLED" ? "Called" : "In room"} {now ? minutesSince(mine.status === "CALLED" ? mine.calledAt : mine.startedAt, now) : 0} min ago</span>
                </p>
              </div>
            ) : (
              <p className="mt-6 min-h-[9rem] text-xl text-led-ink">{onBreak ? "Switch to Available when you're ready for the next patient." : next ? "Ready when you are." : "The queue is clear."}</p>
            )}
          </LedPanel>

          {mine?.status === "CALLED" && (
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <Button size="xl" disabled={busy} onClick={() => void run("queue:start-consult", { tokenId: mine.id }, `${mine.label} is in consultation`)}><DoorOpen className="size-6" aria-hidden />Patient is here · start</Button>
              <Button size="xl" variant="secondary" disabled={busy} onClick={() => void run("queue:no-show", { tokenId: mine.id }, (d) => d.requeued ? `${mine.label} didn't come. Moved to the end of the queue.` : `${mine.label} missed a second time and was removed from the queue.`)}><UserX className="size-6" aria-hidden />Didn&apos;t come</Button>
            </div>
          )}
          {mine?.status === "IN_CONSULT" && (
            <div className="grid grid-cols-2 gap-3">
              <Button size="xl" disabled={busy} onClick={() => void run("queue:mark-completed", { tokenId: mine.id }, `${mine.label} completed`)}><Check className="size-6" aria-hidden />Complete</Button>
              <Button size="xl" variant="secondary" disabled={busy} onClick={() => void run("queue:transfer-lab", { tokenId: mine.id }, `${mine.label} sent to lab`)}><FlaskConical className="size-6" aria-hidden />Send to lab</Button>
            </div>
          )}

          <Button size="xl" className="w-full flex-col gap-0 py-3" disabled={busy || !me || !!mine || onBreak || !next} onClick={callNext}>
            <span className="flex items-center gap-2"><PhoneCall className="size-6" aria-hidden />Call next<ArrowRight className="size-5" aria-hidden /></span>
            <span className="text-base font-medium opacity-90">{callReason}</span>
          </Button>
          {mine?.status === "CALLED" && <p className="text-sm text-ink-2">"Didn't come" moves the patient to the end of the queue once. A second miss removes them.</p>}
          <p className="text-sm text-ink-2">Press <kbd className="rounded border border-ink-3 bg-sheet px-1.5 font-bold">N</kbd> to call next. A double tap never skips a patient.</p>
        </section>

        <section aria-label="Queue">
          <div className="border-b-2 border-ink pb-2">
            <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_4.5rem_8.5rem] items-end gap-3 text-xs font-extrabold uppercase tracking-[0.12em] text-ink-2 sm:grid-cols-[2.5rem_minmax(0,1fr)_5rem_10rem]">
              <span>#</span><span>Token · patient</span><span>Call in</span><span>Urgency</span>
            </div>
          </div>
          {q && q.waiting.length === 0 && <p className="border-b border-rule py-6 text-lg text-ink-2">No one is waiting.</p>}
          <ul>
            {q?.waiting.map((t) => (
              <li key={t.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)_4.5rem_8.5rem] items-center gap-3 border-b border-rule py-2.5 sm:grid-cols-[2.5rem_minmax(0,1fr)_5rem_10rem]">
                <span className="text-lg font-bold text-ink-2">{t.position}</span>
                <span className="min-w-0">
                  <span className="block whitespace-nowrap text-2xl font-extrabold leading-tight">{t.label}</span>
                  <span className="block truncate text-sm text-ink-2">{t.patientName}{t.age != null ? `, ${t.age}` : ""} · {now ? minutesSince(t.checkedInAt, now) : 0} min waiting</span>
                </span>
                <span className="text-base font-bold text-ink-2">{t.etaMinutes === null ? "paused" : t.etaMinutes <= 0 ? "next" : `~${t.etaMinutes}m`}</span>
                <select
                  aria-label={`Urgency for ${t.label}`} value={t.priority} disabled={busy}
                  onChange={(e) => void run("queue:retriage", { tokenId: t.id, priority: e.target.value }, `${t.label} set to ${PRIORITY_LABEL[e.target.value as Priority]}`)}
                  className={cn("h-12 w-full rounded-lg border-2 bg-white px-2 text-base font-bold", t.priority === "EMERGENCY" ? "border-crit-text text-crit-text" : t.priority === "URGENT" ? "border-low-text text-low-text" : "border-ink-3")}
                >
                  <option value="NORMAL">Routine</option>
                  <option value="URGENT">Urgent</option>
                  <option value="EMERGENCY">Emergency</option>
                </select>
              </li>
            ))}
          </ul>

          <h2 className="mt-10 border-b-2 border-ink pb-2 text-xs font-extrabold uppercase tracking-[0.12em] text-ink-2">Other rooms and recently seen</h2>
          <ul>
            {others.length === 0 && <li className="border-b border-rule py-4 text-ink-2">Nothing yet today.</li>}
            {others.map((t: StaffTokenRow) => (
              <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-rule py-2.5">
                <span className="min-w-0"><span className="mr-3 whitespace-nowrap text-lg font-extrabold">{t.label}</span><span className="text-sm text-ink-2">{t.patientName}</span></span>
                <span className="flex items-center gap-2 text-sm font-bold text-ink-2">{t.room && `${t.room} · `}{STATUS_WORD[t.status] ?? t.status}<PriorityBadge p={t.priority} /></span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

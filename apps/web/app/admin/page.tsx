"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bookmark, Check, SprayCan, User } from "lucide-react";
import { BED_CYCLE, type AdminOverviewDTO, type BedDTO, type BedStatus, type BedUpdatedEvent, type DoctorStatus, type WardDTO } from "@smartopd/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/format";
import { command, useConnection, useLive, useNow, useSocket } from "@/lib/realtime";
import { CONTAINER } from "@/lib/layout";
import {StaffHeader} from "@/components/brand";
import { BAND_TONE, BAND_WORD, TYPE_NAME } from "@/components/live-board";
import { useToast } from "@/components/toast";
import { Button, DotText, Lamp, LedPanel, PanelLabel, Segmented } from "@/components/ui";
import { vacancyBand } from "@smartopd/shared";

interface AdminBeds { wards: WardDTO[]; beds: BedDTO[] }
interface AuditRow { id: string; at: string; actor: string; action: string; after: Record<string, string> | null; before: Record<string, string> | null }

const TABS = ["Beds", "Department queues", "Doctors", "Activity log"] as const;
type Tab = (typeof TABS)[number];

const BED_STYLE: Record<BedStatus, { cls: string; icon: typeof Check; word: string }> = {
  VACANT: { cls: "border-ok-text/50 bg-ok-tint text-ok-text", icon: Check, word: "Vacant" },
  OCCUPIED: { cls: "border-ink bg-ink text-sheet", icon: User, word: "Occupied" },
  CLEANING: { cls: "border-low-text/50 bg-low-tint text-low-text", icon: SprayCan, word: "Cleaning" },
  RESERVED: { cls: "border-2 border-dashed border-ink-2 bg-transparent text-ink", icon: Bookmark, word: "Reserved" },
};

function sentence(r: AuditRow): string {
  const a = r.after ?? {}; const b = r.before ?? {};
  switch (r.action) {
    case "token.created": return `${a.label} checked in`;
    case "token.called": return `${r.actor} called ${a.label} · waiting → called`;
    case "token.in_consult": return `${r.actor} started ${a.label} · ${b.status?.toLowerCase()} → in consult`;
    case "token.completed": return `${r.actor} completed ${a.label}`;
    case "token.transferred_to_lab": return `${r.actor} sent ${a.label} to the lab`;
    case "token.no_show": return `${a.label} didn't come · ${r.actor}`;
    case "token.requeued": return `${a.label} didn't come · moved to the end of the queue by ${r.actor}`;
    case "token.waiting": return `${r.actor} returned ${a.label} to the queue`;
    case "token.retriaged": return `${r.actor} changed ${a.label} to ${String(a.priority).toLowerCase()} · was ${String(b.priority).toLowerCase()}`;
    case "bed.status": return `${r.actor} set bed ${a.bed} (${a.ward}) to ${String(a.status).toLowerCase()}`;
    case "ward.verified": return `${r.actor} confirmed counts in ${a.ward}`;
    case "doctor.status": return `${r.actor} set ${a.doctor} to ${String(a.status).toLowerCase().replace("_", " ")}`;
    case "alert.patient_email": return `Queue alert (${String(a.level) === "NEXT" ? "you're next" : "2nd in line"}) for ${a.label} · email ${a.status === "sent" ? "sent" : a.status === "failed" ? "failed" : "logged only"} to ${a.to}`;
    case "alert.email": return `Priority alert email ${a.status === "sent" ? "sent" : "logged"} · ${a.subject}`;
    default: return `${r.actor} · ${r.action}`;
  }
}

function BedsTab({ now }: { now: number }) {
  const toast = useToast();
  const socket = useSocket();
  const [data, setData] = useState<AdminBeds | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const dataRef = useRef<AdminBeds | null>(null);

  const load = useCallback(async () => {
    const r = await api<AdminBeds>("/admin/beds");
    if (r.ok) { dataRef.current = r.data; setData(r.data); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // apply pushes only when their version is >= ours; resync on reconnect
  useEffect(() => {
    if (!socket) return;
    const onBed = (e: BedUpdatedEvent) => {
      setData((cur) => {
        if (!cur) return cur;
        const beds = cur.beds.map((b) => (b.id === e.bed.id && e.bed.version >= b.version ? e.bed : b));
        const next = { ...cur, beds };
        dataRef.current = next;
        return next;
      });
    };
    const onAgg = () => void load(); // ward counts and confirmation stamps
    socket.on("bed:updated", onBed);
    socket.on("bed:aggregate", onAgg);
    socket.on("connect", load);
    return () => { socket.off("bed:updated", onBed); socket.off("bed:aggregate", onAgg); socket.off("connect", load); };
  }, [socket, load]);

  const tap = async (bed: BedDTO) => {
    const next = BED_CYCLE[bed.status];
    setPending((p) => new Set(p).add(bed.id));
    const r = await command("bed:update-status", { bedId: bed.id, status: next, expectedVersion: bed.version });
    setPending((p) => { const n = new Set(p); n.delete(bed.id); return n; });
    if (!r.ok) { toast(r.error.message, "error"); if (r.error.code === "CONFLICT") await load(); }
    else await load();
  };

  const verify = async (w: WardDTO) => {
    const r = await command("ward:verify", { wardId: w.id });
    toast(r.ok ? `${w.name} counts confirmed` : r.error.message, r.ok ? "ok" : "error");
    if (r.ok) await load();
  };

  if (!data) return <p className="py-8 text-ink-2">Loading beds…</p>;
  return (
    <div className="space-y-10">
      {data.wards.map((w) => {
        const beds = data.beds.filter((b) => b.wardId === w.id);
        const band = vacancyBand(w.vacant, w.totalBeds);
        const confirmedAt = [w.verifiedAt, w.lastChangeAt].filter(Boolean).sort().pop() ?? null;
        return (
          <section key={w.id} aria-label={w.name}>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-2 border-ink pb-2">
              <div>
                <h3 className="text-2xl font-extrabold">{w.name}</h3>
                <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-ink-2">
                  <span className="inline-flex items-center gap-2 font-bold text-ink"><Lamp tone={BAND_TONE[band]} />{w.vacant} vacant · {BAND_WORD[band]}</span>
                  <span>{w.occupied} occupied · {w.cleaning} cleaning · {w.reserved} reserved</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-ink-2">Confirmed {ago(confirmedAt, now)}{w.verifiedBy ? ` by ${w.verifiedBy}` : ""}</span>
                <Button variant="secondary" onClick={() => void verify(w)}>Confirm counts</Button>
              </div>
            </div>
            <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
              {beds.map((b) => {
                const s = BED_STYLE[b.status]; const Icon = s.icon;
                return (
                  <li key={b.id}>
                    <button
                      type="button" onClick={() => void tap(b)} disabled={pending.has(b.id)}
                      aria-label={`Bed ${b.bedNumber}: ${s.word}. Tap to change to ${BED_STYLE[BED_CYCLE[b.status]].word.toLowerCase()}.`}
                      className={cn("flex min-h-[5.5rem] w-full flex-col items-start justify-between rounded-lg border-2 p-3 text-left transition-colors hover:brightness-95 disabled:opacity-70", s.cls)}
                    >
                      <span className="flex w-full items-center justify-between gap-2"><span className="text-lg font-extrabold">{b.bedNumber}</span><Icon className="size-5" aria-hidden /></span>
                      <span className="text-sm font-bold">{pending.has(b.id) ? "Saving…" : s.word}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <p className="text-sm text-ink-2">Tap a bed to move it Vacant → Occupied → Cleaning → Reserved → Vacant. Demo data.</p>
    </div>
  );
}

function ActivityTab() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  useEffect(() => {
    let dead = false;
    const pull = async () => { const r = await api<AuditRow[]>("/admin/audit"); if (!dead && r.ok) setRows(r.data); };
    void pull();
    const id = setInterval(pull, 5000);
    return () => { dead = true; clearInterval(id); };
  }, []);
  return (
    <ul className="border-t-2 border-ink">
      {rows.length === 0 && <li className="py-6 text-ink-2">No activity yet.</li>}
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap justify-between gap-x-6 border-b border-rule py-2.5 text-base">
          <span>{sentence(r)}</span>
          <time className="text-sm text-ink-2" dateTime={r.at}>{new Date(r.at).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" })}</time>
        </li>
      ))}
    </ul>
  );
}

export default function AdminPage() {
  const toast = useToast();
  const now = useNow(1000);
  const conn = useConnection();
  const [tab, setTab] = useState<Tab>("Beds");
  const { data: ov, degraded, setData: setOv } = useLive<AdminOverviewDTO>({
    join: { event: "join:admin" },
    events: [{ name: "admin:overview" }],
    restPath: "/admin/overview",
  });
  const socket = useSocket();
  const { data: board } = useLive<{ seq: number; aggregates: { type: "GENERAL" | "ICU" | "OXYGEN"; vacant: number; total: number }[] }>({
    join: { event: "join:public-beds" }, events: [{ name: "bed:aggregate" }], restPath: "/beds/summary",
  });

  useEffect(() => {
    if (!socket) return;
    const f = (s: { enabled: boolean }) => setOv(ov ? { ...ov, simulator: s } : ov);
    socket.on("sim:state", f);
    return () => { socket.off("sim:state", f); };
  }, [socket, ov, setOv]);

  const sim = ov?.simulator.enabled ?? false;
  const toggleSim = async () => {
    const r = await command("sim:set", { enabled: !sim });
    if (!r.ok) toast(r.error.message, "error");
  };

  const onKeyTabs = (e: React.KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const n = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault();
    setTab(TABS[n]!);
    document.getElementById(`tab-${n}`)?.focus();
  };

  return (
    <>
      <StaffHeader title="Ward and queue console" subtitle="City General Hospital" degraded={degraded}>
        <button
          type="button" role="switch" aria-checked={sim} onClick={() => void toggleSim()}
          className="inline-flex min-h-12 items-center gap-2.5 rounded-lg border-2 border-ink/80 bg-sheet px-4 text-base font-bold"
        >
          <Lamp tone={sim ? "ok" : "neutral"} pulse={sim && conn === "live"} />
          Demo simulator {sim ? "on" : "off"}
        </button>
      </StaffHeader>

      <main className={cn(CONTAINER, "py-6 sm:py-8")}>
        <LedPanel className="grid grid-cols-3 gap-px overflow-hidden p-0" aria-label="Vacant beds">
          {(board?.aggregates ?? []).map((a) => (
            <div key={a.type} className="p-4 sm:p-5">
              <PanelLabel>{TYPE_NAME[a.type]} vacant</PanelLabel>
              <p className="mt-2 flex items-baseline gap-2"><DotText value={String(a.vacant)} className="text-5xl sm:text-6xl" /><span className="text-sm text-led-ink">of {a.total}</span></p>
            </div>
          ))}
        </LedPanel>

        <div role="tablist" aria-label="Console sections" onKeyDown={onKeyTabs} className="mt-8 flex flex-wrap gap-1 border-b-2 border-ink">
          {TABS.map((t, i) => (
            <button
              key={t} id={`tab-${i}`} role="tab" type="button" aria-selected={tab === t} aria-controls={`panel-${i}`} tabIndex={tab === t ? 0 : -1}
              onClick={() => setTab(t)}
              className={cn("min-h-12 rounded-t-lg px-5 text-base font-bold", tab === t ? "bg-ink text-sheet" : "text-ink-2 hover:bg-wall-deep")}
            >{t}</button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${TABS.indexOf(tab)}`} aria-labelledby={`tab-${TABS.indexOf(tab)}`} className="py-6">
          {tab === "Beds" && <BedsTab now={now} />}
          {tab === "Department queues" && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-base">
                <thead><tr className="border-b-2 border-ink text-xs font-extrabold uppercase tracking-[0.12em] text-ink-2">
                  <th className="py-2 pr-4">Department</th><th className="px-2">Waiting</th><th className="px-2">With doctor</th><th className="px-2">Longest wait</th><th className="px-2">Avg consult</th><th className="px-2">Doctors on duty</th><th />
                </tr></thead>
                <tbody>{ov?.departments.map((d) => (
                  <tr key={d.department.id} className="border-b border-rule">
                    <th scope="row" className="py-3 pr-4 font-extrabold">{d.department.name}</th>
                    <td className="px-2 text-xl font-extrabold">{d.waiting}</td>
                    <td className="px-2">{d.active}</td>
                    <td className={cn("px-2 font-bold", d.longestWaitMinutes > 60 && "text-crit-text")}>{d.longestWaitMinutes} min{d.longestWaitMinutes > 60 && " · long"}</td>
                    <td className="px-2">{d.avgConsultMinutes} min</td>
                    <td className="px-2">{d.doctorsOnDuty}</td>
                    <td className="px-2 text-right"><Link href="/doctor" className="font-bold text-act">Open triage console</Link></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {tab === "Doctors" && (
            <ul className="border-t-2 border-ink">
              {ov?.doctors.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-rule py-3">
                  <span><span className="block text-lg font-extrabold">{d.name}</span><span className="text-sm text-ink-2">{d.departmentName} · {d.room}</span></span>
                  <Segmented
                    name={`doc-${d.id}`} label={`Status for ${d.name}`} value={d.status === "WITH_PATIENT" ? "AVAILABLE" : (d.status as DoctorStatus)}
                    onChange={async (v) => { const r = await command("doctor:update-status", { doctorId: d.id, status: v }); toast(r.ok ? `${d.name} is ${v.toLowerCase().replace("_", " ")}` : r.error.message, r.ok ? "ok" : "error"); }}
                    options={[{ value: "AVAILABLE", label: d.status === "WITH_PATIENT" ? "With patient" : "Available" }, { value: "ON_BREAK", label: "On break" }, { value: "OFFLINE", label: "Offline" }]}
                  />
                </li>
              ))}
            </ul>
          )}
          {tab === "Activity log" && <ActivityTab />}
        </div>
      </main>
    </>
  );
}


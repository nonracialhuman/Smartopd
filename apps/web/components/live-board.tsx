"use client";
import { useEffect, useState } from "react";
import type { BedBoardDTO, DepartmentDTO, PublicQueueDTO, VacancyBand } from "@smartopd/shared";
import { getDepartments } from "@/lib/api";
import { clock } from "@/lib/format";
import { useLive, useNow } from "@/lib/realtime";
import { DotText, Lamp, LedPanel, PanelLabel, type LampTone } from "./ui";

export const BAND_TONE: Record<VacancyBand, LampTone> = { ok: "ok", low: "low", critical: "crit" };
export const BAND_WORD: Record<VacancyBand, string> = { ok: "Available", low: "Few left", critical: "Full or nearly" };
export const TYPE_NAME = { GENERAL: "General", ICU: "ICU", OXYGEN: "Oxygen" } as const;

function waitLine(q: PublicQueueDTO): string {
  if (q.activeDoctors === 0) return `${q.waitingCount} waiting · doctors on break`;
  if (q.waitingCount === 0) return "No one waiting";
  const eta = q.nextEtaMinutes;
  if (eta === null) return `${q.waitingCount} waiting`;
  return `${q.waitingCount} waiting · ${eta <= 1 ? "next goes in shortly" : `next in ~${eta} min`}`;
}

function DeptRow({ dept }: { dept: DepartmentDTO }) {
  const { data: q } = useLive<PublicQueueDTO>({
    join: { event: "join:department", payload: { departmentId: dept.id } },
    events: [{ name: "queue:updated" }],
    restPath: `/queue/${dept.id}`,
  });
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 border-t border-bezel-hi py-4 first:border-t-0 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <span aria-hidden className="flex size-11 items-center justify-center rounded-full border-2 border-led-ink text-sm font-extrabold tracking-wider text-led-soft">{dept.code}</span>
      <div className="min-w-0">
        <p className="text-lg font-extrabold leading-tight text-led-soft">{dept.name}</p>
        <p className="text-sm text-led-ink">{q ? waitLine(q) : "Loading…"}</p>
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-x-5 gap-y-1 sm:col-span-1 sm:justify-end">
        {q && q.nowServing.length === 0 && <span className="text-sm text-led-ink">Nobody called yet</span>}
        {q?.nowServing.map((n) => (
          <span key={n.label} className="inline-flex items-baseline gap-2">
            <DotText value={n.label} className="text-[1.75rem]" />
            <span className="led-caps">{n.room}</span>
          </span>
        ))}
      </div>
    </li>
  );
}

export function LiveBoard() {
  const [depts, setDepts] = useState<DepartmentDTO[]>([]);
  const now = useNow(1000);
  useEffect(() => { void getDepartments().then((r) => r.ok && setDepts(r.data)); }, []);
  const { data: beds } = useLive<BedBoardDTO>({
    join: { event: "join:public-beds" },
    events: [{ name: "bed:aggregate" }],
    restPath: "/beds/summary",
  });

  return (
    <LedPanel className="p-5 sm:p-7" aria-label="Live OPD board">
      <div className="flex items-start justify-between gap-4">
        <PanelLabel>Now serving · OPD</PanelLabel>
        <span className={now ? "" : "invisible"}><DotText value={clock(now) || "00:00"} className="text-2xl" /></span>
      </div>
      <ul className="mt-3">{depts.map((d) => <DeptRow key={d.id} dept={d} />)}</ul>
      <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-bezel-hi bg-bezel-hi">
        {(beds?.aggregates ?? []).map((a) => (
          <div key={a.type} className="bg-panel/90 p-3 sm:p-4">
            <PanelLabel>{TYPE_NAME[a.type]} beds</PanelLabel>
            <p className="mt-2 flex items-baseline gap-2">
              <DotText value={String(a.vacant)} className="text-4xl sm:text-5xl" />
              <span className="text-sm text-led-ink">of {a.total}</span>
            </p>
            <p className="mt-2 flex items-center gap-2 text-sm font-bold text-led-soft"><Lamp tone={BAND_TONE[a.band]} />{BAND_WORD[a.band]}</p>
          </div>
        ))}
      </div>
    </LedPanel>
  );
}

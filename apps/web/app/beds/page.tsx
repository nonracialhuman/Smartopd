"use client";
import Link from "next/link";
import type { BedAggregateItem, BedBoardDTO } from "@smartopd/shared";
import { cn } from "@/lib/cn";
import { clock, minutesSince } from "@/lib/format";
import { useLive, useNow } from "@/lib/realtime";
import { BAND_TONE, BAND_WORD, TYPE_NAME } from "@/components/live-board";
import { ConnectionBadge, Wordmark } from "@/components/brand";
import { DotText, Lamp, LedPanel } from "@/components/ui";

function Cell({ a, now }: { a: BedAggregateItem; now: number }) {
  const mins = a.freshAt ? minutesSince(a.freshAt, now) : null;
  return (
    <section className="grid min-h-0 grid-rows-[auto_1fr_auto] gap-2 border-bezel-hi px-4 py-4 sm:px-8 lg:border-l lg:first:border-l-0" aria-label={`${TYPE_NAME[a.type]} beds`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="text-2xl font-extrabold text-led-soft sm:text-3xl">{TYPE_NAME[a.type]}</h2>
        <span className="inline-flex items-center gap-2 text-lg font-bold text-led-soft sm:text-xl"><Lamp tone={BAND_TONE[a.band]} className="size-4" />{BAND_WORD[a.band]}</span>
      </div>
      <div className="flex min-h-0 flex-col items-center justify-center">
        <DotText value={String(a.vacant)} className="text-[clamp(8rem,min(24vw,50vh),36rem)]" />
        <p className="mt-1 text-xl text-led-ink sm:text-2xl"><strong className="font-extrabold text-led-soft">vacant</strong> / of {a.total} beds</p>
      </div>
      <p className={cn("text-lg font-bold", a.stale ? "text-low" : "text-led-ink")}>
        {!now ? " " : a.freshAt === null ? "Not confirmed yet" : a.stale ? `Not confirmed for ${mins} min` : mins! < 1 ? "Confirmed just now" : `Confirmed ${mins} min ago`}
      </p>
    </section>
  );
}

export default function BedWall() {
  const now = useNow(1000);
  const { data, degraded } = useLive<BedBoardDTO>({
    join: { event: "join:public-beds" },
    events: [{ name: "bed:aggregate" }],
    restPath: "/beds/summary",
  });

  return (
    <LedPanel flush className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-bezel-hi px-4 py-4 sm:px-8">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <Link href="/" className="no-underline"><Wordmark onPanel /></Link>
          <p className="led-caps text-base">
            <span>City General Hospital</span> <span>· Live bed availability</span>
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ConnectionBadge dark degraded={degraded} />
          <span className={now ? "" : "invisible"}><DotText value={clock(now) || "00:00"} className="text-4xl" /></span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-3">
        {data ? data.aggregates.map((a) => <Cell key={a.type} a={a} now={now} />) : <p className="p-8 text-xl text-led-ink">Connecting to the ward board…</p>}
      </div>

      <div className="border-t border-bezel-hi px-4 pb-4 pt-3 sm:px-8">
        <table className="w-full text-left text-lg">
          <caption className="sr-only">Beds by ward</caption>
          <thead>
            <tr className="led-caps text-sm">
              <th scope="col" className="py-1.5 pr-4">Ward</th>
              <th scope="col" className="px-2 py-1.5">Vacant</th>
              <th scope="col" className="px-2 py-1.5">Occupied</th>
              <th scope="col" className="px-2 py-1.5">Cleaning</th>
              <th scope="col" className="px-2 py-1.5">Reserved</th>
              <th scope="col" className="hidden py-1.5 pl-2 sm:table-cell">Last confirmed</th>
            </tr>
          </thead>
          <tbody>
            {data?.wards.map((w) => (
              <tr key={w.id} className="border-t border-bezel-hi text-led-soft">
                <th scope="row" className="py-1.5 pr-4 font-bold">{w.name}</th>
                <td className="px-2 py-1.5 text-2xl font-extrabold text-led">{w.vacant}</td>
                <td className="px-2 py-1.5">{w.occupied}</td>
                <td className="px-2 py-1.5">{w.cleaning}</td>
                <td className="px-2 py-1.5">{w.reserved}</td>
                <td className="hidden py-1.5 pl-2 text-led-ink sm:table-cell">{!now ? "" : w.verifiedAt || w.lastChangeAt ? `${minutesSince(w.verifiedAt && w.lastChangeAt ? (w.verifiedAt > w.lastChangeAt ? w.verifiedAt : w.lastChangeAt) : (w.verifiedAt ?? w.lastChangeAt), now)} min ago` : "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-sm text-led-ink">Counts are kept by ward staff and confirmed by hand. No sensors are involved. DEMO DATA · MAY BE SIMULATED</p>
      </div>
    </LedPanel>
  );
}

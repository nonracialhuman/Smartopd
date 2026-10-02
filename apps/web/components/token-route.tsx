import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/** A 4-stop route. `current` is the lit stop (0-based); earlier stops are done; -1 means none reached. */
export function TokenRoute({ stops, current, className }: { stops: string[]; current: number; className?: string }) {
  return (
    <ol className={cn("grid gap-0", className)} style={{ gridTemplateColumns: `repeat(${stops.length}, minmax(0, 1fr))` }} aria-label="Progress">
      {stops.map((label, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={label} className="relative flex flex-col items-center px-1 text-center" aria-current={now ? "step" : undefined}>
            {i > 0 && <span aria-hidden className={cn("absolute right-1/2 top-[13px] h-[3px] w-full", i <= current ? "bg-ink" : "bg-rule")} />}
            <span
              aria-hidden
              className={cn(
                "relative z-10 flex size-7 items-center justify-center rounded-full border-[3px]",
                done && "border-ink bg-ink text-sheet",
                now && "border-act bg-act text-white ring-4 ring-act/25",
                !done && !now && "border-rule bg-wall",
              )}
            >
              {done && <Check className="size-4" strokeWidth={3} />}
            </span>
            <span className={cn("mt-2 text-sm leading-tight sm:text-base", now ? "font-extrabold text-ink" : done ? "font-bold text-ink-2" : "font-medium text-ink-3")}>
              {label}
              {now && <span className="sr-only"> (current step)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

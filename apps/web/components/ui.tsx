"use client";
import { useId, useState, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { buttonClass, type ButtonSize as Size, type ButtonVariant as Variant } from "@/lib/button";

export function LedPanel({ className, flush, ...rest }: HTMLAttributes<HTMLDivElement> & { flush?: boolean }) {
  return <div className={cn("led-panel on-panel", flush && "led-panel--flush", className)} {...rest} />;
}

export function PanelLabel({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("led-caps", className)} {...rest} />;
}

export type LampTone = "ok" | "low" | "crit" | "led" | "off" | "neutral";
export function Lamp({ tone = "neutral", pulse, className }: { tone?: LampTone; pulse?: boolean; className?: string }) {
  return <span aria-hidden className={cn("lamp", tone !== "neutral" && `lamp--${tone}`, pulse && "lamp--pulse", className)} />;
}

/** Doto text that re-strikes (one dot row at a time) only where a character changed. First render is static. */
export function DotText({ value, className }: { value: string; className?: string }) {
  const [st, setSt] = useState(() => ({ value, vers: Array.from(value, () => 0) }));
  let cur = st;
  if (st.value !== value) {
    const chars = Array.from(value);
    cur = { value, vers: chars.map((c, i) => (st.value[i] === c ? (st.vers[i] ?? 0) : (st.vers[i] ?? 0) + 1)) };
    setSt(cur);
  }
  return (
    <span className={cn("led-text whitespace-nowrap", className)} aria-label={value} role="img">
      {Array.from(value).map((c, i) => (
        <span
          key={`${i}-${cur.vers[i]}`}
          aria-hidden
          className={cur.vers[i] ? "restrike" : "inline-block"}
          style={cur.vers[i] ? { animationDelay: `${i * 70}ms` } : undefined}
        >
          {c === " " ? " " : c}
        </span>
      ))}
    </span>
  );
}

export function Button({
  variant = "primary", size = "md", className, type = "button", ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

export function Field({
  label, error, hint, prefix, className, inputClassName, ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: string; prefix?: string; inputClassName?: string }) {
  const id = useId();
  const descId = `${id}-d`;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-base font-bold text-ink">{label}</label>
      <div className={cn("flex min-h-14 items-stretch overflow-hidden rounded-lg border-2 bg-white", error ? "border-crit-text" : "border-ink-3 focus-within:border-act")}>
        {prefix && <span className="flex items-center border-r-2 border-rule bg-wall-deep px-3 text-lg font-bold text-ink-2">{prefix}</span>}
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? descId : undefined}
          className={cn("min-w-0 flex-1 bg-transparent px-4 text-lg text-ink outline-none placeholder:text-ink-3", inputClassName)}
          {...rest}
        />
      </div>
      {(error || hint) && (
        <p id={descId} className={cn("mt-1.5 text-sm", error ? "font-bold text-crit-text" : "text-ink-2")}>{error ?? hint}</p>
      )}
    </div>
  );
}

export function Segmented<T extends string>({
  value, onChange, options, name, label, className, size = "md",
}: {
  value: T; onChange: (v: T) => void; name: string; label: string; className?: string; size?: "md" | "lg";
  options: { value: T; label: ReactNode; disabled?: boolean }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-lg border-2 border-ink/80 bg-sheet p-0.5", className)}>
      {options.map((o) => (
        <label key={o.value} className={cn("relative", o.disabled && "opacity-50")}>
          <input
            type="radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled}
            onChange={() => onChange(o.value)} className="peer sr-only"
          />
          <span className={cn(
            "flex cursor-pointer items-center justify-center rounded-md px-4 font-bold text-ink-2 transition-colors peer-checked:bg-ink peer-checked:text-sheet peer-focus-visible:outline-3 peer-focus-visible:outline-act peer-disabled:cursor-not-allowed",
            size === "lg" ? "min-h-14 text-lg" : "min-h-11 text-base",
          )}>
            {o.label}
          </span>
        </label>
      ))}
    </div>
  );
}

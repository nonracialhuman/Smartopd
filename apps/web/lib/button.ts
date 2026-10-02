import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "onPanel";
export type ButtonSize = "md" | "lg" | "xl";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-act text-white hover:bg-act-hover active:bg-act-press",
  secondary: "bg-sheet text-ink border-2 border-ink/80 hover:bg-white active:bg-wall-deep",
  quiet: "bg-transparent text-act hover:bg-wall-deep active:bg-rule/60 underline-offset-4 hover:underline",
  danger: "bg-crit-tint text-crit-text border-2 border-crit-text/60 hover:bg-[#f0c4c0]",
  onPanel: "bg-led text-panel hover:bg-led-soft active:bg-led-ink",
};
const SIZE: Record<ButtonSize, string> = {
  md: "min-h-12 px-5 text-base",
  lg: "min-h-14 px-6 text-lg",
  xl: "min-h-20 px-7 text-xl",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-bold no-underline transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-inherit",
    VARIANT[variant], SIZE[size], className,
  );
}


import { cn } from "@/lib/utils";

/** 4px accent stripe, full width of the element it marks. */
export function CmStripe({ className }: { className?: string }) {
  return <div aria-hidden className={cn("h-1 w-full bg-cm-accent", className)} />;
}

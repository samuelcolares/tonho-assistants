import { cn } from "@/lib/utils";

export type ToastVariant = "default" | "success" | "warning" | "danger";

export interface ToastProps {
  variant?: ToastVariant;
  title?: string;
  description?: string;
}

const variantClasses: Record<ToastVariant, string> = {
  default: "border-border",
  success: "border-success/40",
  warning: "border-warning/40",
  danger: "border-danger/40",
};

export function Toast({ variant = "default", title, description }: ToastProps) {
  return (
    <div
      className={cn(
        "w-full max-w-sm rounded-lg border bg-bg-200 p-3.5 shadow-lg",
        variantClasses[variant]
      )}
    >
      {title && <p className="text-sm font-semibold text-ink">{title}</p>}
      {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
    </div>
  );
}

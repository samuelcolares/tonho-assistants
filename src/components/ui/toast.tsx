import { cn } from "@/lib/utils";

export type ToastVariant = "default" | "success" | "warning" | "danger";

export interface ToastProps {
  variant?: ToastVariant;
  title?: string;
  description?: string;
}

const variantClasses: Record<ToastVariant, string> = {
  default: "border-l-ink",
  success: "border-l-success",
  warning: "border-l-warning",
  danger: "border-l-danger",
};

export function Toast({ variant = "default", title, description }: ToastProps) {
  return (
    <div
      className={cn(
        "w-full max-w-sm rounded-none border border-border border-l-4 bg-bg-000 p-4",
        variantClasses[variant]
      )}
    >
      {title && <p className="text-[12px] font-bold uppercase tracking-[1.5px] text-ink">{title}</p>}
      {description && <p className="mt-0.5 text-[13px] font-light text-ink-muted">{description}</p>}
    </div>
  );
}

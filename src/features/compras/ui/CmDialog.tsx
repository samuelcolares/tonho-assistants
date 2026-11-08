import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CmStripe } from "./CmStripe";

/** Dialog shell in the Compras look: black, hairline, radius 0, accent stripe on top. */
export const CmDialog = DialogPrimitive.Root;

export const CmDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { stripe?: boolean }
>(({ className, children, stripe = true, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-none border border-cm-hairline bg-cm-canvas font-cm font-light text-cm-body-strong",
        className
      )}
      {...props}
    >
      {stripe && <CmStripe />}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">{children}</div>
      <DialogPrimitive.Close
        aria-label="Fechar"
        className="absolute right-4 top-5 flex h-8 w-8 items-center justify-center rounded-full text-cm-muted hover:text-cm-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-cm-ink"
      >
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
CmDialogContent.displayName = "CmDialogContent";

export const CmDialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-[20px] font-bold uppercase leading-tight text-cm-ink", className)}
    {...props}
  />
));
CmDialogTitle.displayName = "CmDialogTitle";

export const CmDialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-[14px] font-light text-cm-body", className)} {...props} />
));
CmDialogDescription.displayName = "CmDialogDescription";

export function CmDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-wrap items-center justify-end gap-3 border-t border-cm-hairline pt-5", className)}
      {...props}
    />
  );
}

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

/** Dropdown menu in the Compras look: sharp, hairline border, uppercase-free body text. */
export const CmMenu = DropdownMenu.Root;
export const CmMenuTrigger = DropdownMenu.Trigger;
export const CmMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenu.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenu.Separator ref={ref} className={cn("my-1 h-px bg-cm-hairline", className)} {...props} />
));
CmMenuSeparator.displayName = "CmMenuSeparator";

export const CmMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenu.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.Content>
>(({ className, sideOffset = 6, align = "end", ...props }, ref) => (
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      className={cn(
        "z-50 min-w-[200px] rounded-none border border-cm-hairline bg-cm-card p-1 font-cm text-cm-body-strong",
        className
      )}
      {...props}
    />
  </DropdownMenu.Portal>
));
CmMenuContent.displayName = "CmMenuContent";

interface CmMenuItemProps extends React.ComponentPropsWithoutRef<typeof DropdownMenu.Item> {
  danger?: boolean;
  /** Marks the current choice in a single-choice list. */
  selected?: boolean;
}

export const CmMenuItem = React.forwardRef<React.ElementRef<typeof DropdownMenu.Item>, CmMenuItemProps>(
  ({ className, danger = false, selected = false, ...props }, ref) => (
    <DropdownMenu.Item
      ref={ref}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-none px-3 py-2.5 text-[13px] font-light outline-none",
        "data-[highlighted]:bg-cm-elevated data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        danger ? "text-cm-danger" : selected ? "font-bold text-cm-accent" : "text-cm-body-strong",
        className
      )}
      {...props}
    />
  )
);
CmMenuItem.displayName = "CmMenuItem";

export const CmMenuLabel = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-3 py-2 text-[11px] font-bold uppercase tracking-[1.5px] text-cm-muted", className)} {...props} />
);

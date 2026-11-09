import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-none border px-2 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-[1.5px]",
  {
    variants: {
      variant: {
        default: "border-border text-ink-muted",
        success: "border-success text-success",
        warning: "border-warning text-warning",
        danger: "border-danger text-danger",
        antonio: "border-antonio text-antonio",
        dante: "border-dante text-dante",
        bonnie: "border-bonnie text-bonnie",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

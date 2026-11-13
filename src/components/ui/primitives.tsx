import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// ---- Card -------------------------------------------------------------------
export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-xl border bg-card text-card-foreground shadow-sm", className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 p-5 pb-3", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("font-semibold leading-tight", className)} {...props} />;
}
export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}
export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center p-5 pt-0", className)} {...props} />;
}

// ---- Inputs -----------------------------------------------------------------
const field =
  "w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(field, "h-9", className)} {...props} />;
}
export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(field, "min-h-20", className)} {...props} />;
}
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(field, "h-9 py-1 pr-8", className)} {...props} />;
}
export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium leading-none", className)} {...props} />;
}

// ---- Badge ------------------------------------------------------------------
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        success: "border-transparent bg-emerald-50 text-emerald-700",
        warning: "border-transparent bg-amber-50 text-amber-700",
        destructive: "border-transparent bg-red-50 text-red-700",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
export function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

// ---- Table ------------------------------------------------------------------
export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}
export function THead(props: React.ComponentProps<"thead">) {
  return <thead className="[&_tr]:border-b" {...props} />;
}
export function TBody(props: React.ComponentProps<"tbody">) {
  return <tbody className="[&_tr:last-child]:border-0" {...props} />;
}
export function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b transition-colors hover:bg-muted/40", className)} {...props} />;
}
export function TH({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("h-10 px-3 text-left align-middle text-xs font-medium text-muted-foreground whitespace-nowrap", className)} {...props} />;
}
export function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-3 align-middle", className)} {...props} />;
}

// ---- Alert / empty state ----------------------------------------------------
export function Alert({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "destructive" | "warning" | "success" }) {
  const styles = {
    default: "border-border bg-card",
    destructive: "border-red-200 bg-red-50 text-red-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  }[variant];
  return <div role="alert" className={cn("rounded-lg border px-4 py-3 text-sm", styles, className)} {...props} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted-foreground [&_svg]:size-8">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)}
    />
  );
}

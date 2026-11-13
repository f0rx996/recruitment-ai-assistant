"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, BriefcaseBusiness, LayoutDashboard, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/hr/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/hr/jobs", label: "Job Openings", icon: BriefcaseBusiness },
  { href: "/hr/assistant", label: "AI Assistant", icon: Bot },
];

export function HrNav({ email, role }: { email: string; role: string }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/hr/assistant"
      ? pathname.startsWith("/hr/assistant") || /\/hr\/jobs\/[^/]+\/chat/.test(pathname)
      : href === "/hr/jobs"
        ? pathname.startsWith("/hr/jobs") && !/\/chat/.test(pathname)
        : pathname.startsWith(href);

  return (
    <aside className="sticky top-0 z-20 border-b bg-card md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
      <div className="flex h-14 items-center gap-2 px-4 font-semibold md:h-16">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <BriefcaseBusiness className="size-4" />
        </span>
        <span className="truncate">Recruitment AI</span>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:px-3 md:pb-0">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive(href) ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
        <form action="/api/auth/logout" method="post" className="md:hidden">
          <button className="flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted">
            <LogOut className="size-4" /> Logout
          </button>
        </form>
      </nav>
      <div className="absolute bottom-0 hidden w-full border-t p-3 md:block">
        <p className="truncate px-1 text-xs font-medium">{email}</p>
        <p className="px-1 text-xs capitalize text-muted-foreground">{role}</p>
        <form action="/api/auth/logout" method="post" className="mt-2">
          <button className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            <LogOut className="size-4" /> Logout
          </button>
        </form>
      </div>
    </aside>
  );
}

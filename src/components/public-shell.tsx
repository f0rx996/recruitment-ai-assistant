import Link from "next/link";
import { BriefcaseBusiness } from "lucide-react";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <BriefcaseBusiness className="size-4" />
            </span>
            Careers
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground">Open positions</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-10">{children}</main>
      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <span>Applications are reviewed by our HR team. AI tools assist, humans decide.</span>
          <Link href="/privacy" className="hover:text-foreground">Privacy & AI processing notice</Link>
        </div>
      </footer>
    </div>
  );
}

export function SkillChips({ items, max = 6 }: { items: string[]; max?: number }) {
  const shown = items.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((s) => (
        <span key={s} className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
          {s}
        </span>
      ))}
      {items.length > shown.length && (
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">+{items.length - shown.length} more</span>
      )}
    </div>
  );
}

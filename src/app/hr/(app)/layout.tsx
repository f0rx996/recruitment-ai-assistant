import { requireHrPage } from "@/lib/auth";
import { HrNav } from "@/components/hr/hr-nav";

export const dynamic = "force-dynamic";

export default async function HrLayout({ children }: { children: React.ReactNode }) {
  // Server-side gate for every HR page: valid session AND active hr_users row.
  const { hr } = await requireHrPage();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <HrNav email={hr.email} role={hr.role} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

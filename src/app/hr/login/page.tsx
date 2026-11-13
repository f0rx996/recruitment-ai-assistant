import { BriefcaseBusiness } from "lucide-react";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata = { title: "HR sign in" };

const ERRORS: Record<string, string> = {
  not_authorized: "This account does not have active HR access. Contact your administrator.",
  not_configured: "Supabase is not configured. Set the environment variables described in the README.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const configured = isSupabaseConfigured();
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BriefcaseBusiness className="size-4" />
          </span>
          Recruitment AI Assistant
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">HR sign in</CardTitle>
            <CardDescription>Access is limited to HR staff accounts created by an administrator.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && ERRORS[error] && !(error === "not_configured" && !configured) && (
              <Alert variant="destructive">{ERRORS[error]}</Alert>
            )}
            {!configured ? <Alert variant="warning">{ERRORS.not_configured}</Alert> : <LoginForm />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, Input, Label, Spinner } from "@/components/ui/primitives";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createBrowserSupabase();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError(authError.status === 429 ? "Too many attempts. Please wait and try again." : "Invalid email or password.");
        setLoading(false);
        return;
      }
      router.replace("/hr/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach the authentication service.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="space-y-1.5">
        <Label htmlFor="email">Work email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Spinner /> : null} Sign in
      </Button>
    </form>
  );
}

/**
 * Centralised environment access. Server-only secrets are read lazily so a
 * missing value produces a clear, actionable error instead of a crash at import.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export function publicSupabaseConfig() {
  const url = read("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = read("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new ConfigError(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see README → Configure Supabase).",
    );
  }
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(read("NEXT_PUBLIC_SUPABASE_URL") && read("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
}

export function serviceRoleKey(): string {
  const key = read("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    throw new ConfigError(
      "SUPABASE_SERVICE_ROLE_KEY is not set. It is required on the server for uploads, CV processing and signed CV links.",
    );
  }
  return key;
}

export function openAiConfig() {
  return {
    apiKey: read("OPENAI_API_KEY"),
    chatModel: read("OPENAI_CHAT_MODEL") ?? "gpt-5.4-mini",
    embeddingModel: read("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small",
  };
}

export function isOpenAiConfigured(): boolean {
  return Boolean(read("OPENAI_API_KEY"));
}

export function maxCvBytes(): number {
  const mb = Number(read("MAX_CV_SIZE_MB") ?? "4");
  const safe = Number.isFinite(mb) && mb > 0 && mb <= 10 ? mb : 4;
  return Math.floor(safe * 1024 * 1024);
}

export function retentionDays(): number {
  const d = Number(read("DATA_RETENTION_DAYS") ?? "180");
  return Number.isFinite(d) && d >= 1 ? Math.floor(d) : 180;
}

export function consentVersion(): string {
  return read("CONSENT_VERSION") ?? "2026-11-v1";
}

export function siteUrl(): string {
  return (read("NEXT_PUBLIC_SITE_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
}

import { PublicShell } from "@/components/public-shell";
import { retentionDays } from "@/lib/env";

export const metadata = { title: "Privacy & AI processing notice" };
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  const days = retentionDays();
  return (
    <PublicShell>
      <article className="mx-auto max-w-2xl space-y-5 text-sm leading-relaxed">
        <h1 className="text-2xl font-semibold tracking-tight">Privacy & AI processing notice</h1>
        <section className="space-y-2">
          <h2 className="font-semibold">What we collect</h2>
          <p>Your full name, email address, phone number, the CV file you upload, and the date of your application.</p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold">How we use it</h2>
          <p>
            Your application is used only to assess your suitability for the position you applied for. Your CV is stored in
            private storage that only authorised HR staff can access, through short-lived secure links.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold">AI-assisted analysis</h2>
          <p>
            We extract the text of your CV and use an AI service (OpenAI) to help HR staff search, summarise and compare
            applications against the job requirements. The AI does not make decisions: every shortlisting, rejection or hiring
            decision is made by a person. The assistant is instructed to ignore personal characteristics such as age, gender,
            nationality or religion.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold">Retention</h2>
          <p>
            Applications, CV files and all derived data (extracted text and AI search index) are deleted automatically after{" "}
            <strong>{days} days</strong>, or earlier on request.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold">Your rights</h2>
          <p>
            You may request access to, correction of, or deletion of your application at any time by contacting the HR team
            that published the job opening.
          </p>
        </section>
      </article>
    </PublicShell>
  );
}

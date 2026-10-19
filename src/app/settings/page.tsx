import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense, type ReactNode } from "react";
import { AccountButton, AppHeader } from "@/components/layout";
import { Button, Card, Mono, StatusBadge } from "@/components/ui";
import { requireUser } from "@/server/auth/session";
import { getAISettingsView, type InstanceAIView } from "@/server/settings/ai";
import { formatDate } from "@/server/settings/format";
import { getPrivacySettings, CLEANING_MODE_LABELS, RETENTION_LABELS, RETENTION_HOURS, CLEANING_MODES } from "@/server/settings/privacy";
import { SettingsError } from "@/server/settings/errors";
import {
  getPasswordInfo,
  listSessionViews,
  passwordChangedLabel,
  type SessionView,
} from "@/server/settings/security";
import { signOutOthersAction } from "./actions";
import { AIProviderForm } from "./_ui/AIProviderForm";
import { DeleteAccount } from "./_ui/DeleteAccount";
import { PasswordSection } from "./_ui/PasswordSection";
import { PrivacySelect } from "./_ui/PrivacySelect";
import { ProfileForm } from "./_ui/ProfileForm";
import { RevokeSessionButton } from "./_ui/RevokeSessionButton";
import { Row } from "./_ui/Row";
import { SettingsNav } from "./_ui/SettingsNav";

export const metadata: Metadata = {
  title: "Settings · DataCleanse",
};

const sectionClass = "flex flex-col gap-4";

/** Placeholder rows in the same card style while a section loads. */
function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <Card aria-hidden="true" className="animate-pulse">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex flex-wrap items-center justify-between gap-4 border-b border-divider px-4 py-4 last:border-b-0 sm:px-6 sm:py-5"
        >
          <div className="flex flex-col gap-2">
            <div className="h-4 w-28 rounded bg-divider" />
            <div className="h-3.5 w-56 rounded bg-divider" />
          </div>
          <div className="h-9 w-32 rounded-full bg-divider" />
        </div>
      ))}
    </Card>
  );
}

/** "A", "A and B", "A, B and C". */
function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const providerLabel = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI-compatible API",
  local: "Local OpenAI-compatible server (Ollama, LM Studio, llama.cpp)",
  off: "None",
} as const;

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

async function ProfileSection() {
  const { user } = await requireUser();
  return (
    <ProfileForm name={user.name} email={user.email} memberSince={formatDate(user.createdAt)} />
  );
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

function sessionDescription(sessions: SessionView[]): string {
  const others = sessions.filter((s) => !s.current);
  if (others.length === 0) return "This browser only";
  const parts = sessions.map((s) => (s.current ? "this browser" : s.label));
  return `${sessions.length} devices · ${joinList(parts)}`;
}

async function SecuritySection() {
  const { user, session } = await requireUser();
  const passwordInfo = getPasswordInfo(user.id);

  let sessions: SessionView[] = [];
  let sessionError: string | null = null;
  try {
    sessions = await listSessionViews(user.id, await headers(), session.id);
  } catch (err) {
    if (!(err instanceof SettingsError)) throw err;
    sessionError = err.message;
  }
  const otherCount = sessions.filter((s) => !s.current).length;

  return (
    <Card>
      <PasswordSection changedLabel={passwordChangedLabel(passwordInfo?.changedAt ?? null)} />
      <Row
        title="Active sessions"
        description={sessionError ?? sessionDescription(sessions)}
      >
        <form action={signOutOthersAction}>
          <Button type="submit" variant="secondary" size="md" disabled={sessionError === null && otherCount === 0}>
            Sign out others
          </Button>
        </form>
      </Row>
      {sessions.length > 0 && (
        <ul aria-label="Signed-in devices" className="divide-y divide-divider">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span className="break-words">{s.label}</span>
                  {s.current && <StatusBadge status="ready">This browser</StatusBadge>}
                </div>
                <div className="text-[13px] text-slate">
                  {s.current ? "Active now" : `Last active ${s.lastActive}`}
                </div>
              </div>
              {!s.current && <RevokeSessionButton sessionId={s.id} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Privacy & data
// ---------------------------------------------------------------------------

async function PrivacySection() {
  const { user } = await requireUser();
  const settings = getPrivacySettings(user.id);

  return (
    <>
      <Card>
        <PrivacySelect
          name="retentionHours"
          title="Keep files for"
          description="Uploads and cleaned files are deleted after this. Applies to files uploaded from now on."
          defaultValue={String(settings.retentionHours)}
          options={RETENTION_HOURS.map((h) => ({ value: String(h), label: RETENTION_LABELS[h] }))}
        />
        <PrivacySelect
          name="defaultMode"
          title="Default cleaning mode"
          description={
            <>
              Cleaning suggestions see column names, statistics and a 20-row sample.
              <details className="mt-2">
                <summary className="cursor-pointer text-ink underline">What the AI sees</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>
                    Cleaning suggestions: column names, statistics and a 20-row sample.
                  </li>
                  <li>
                    Ask: column names, types, summary statistics and up to 10 common values per column to write the
                    query, plus up to 50 result rows to phrase the answer.
                  </li>
                  <li>Rule drafting: your sentence, the headers and common values from your newest file.</li>
                </ul>
              </details>
            </>
          }
          defaultValue={settings.defaultMode}
          options={CLEANING_MODES.map((m) => ({ value: m, label: CLEANING_MODE_LABELS[m] }))}
          ariaLabel="Default cleaning mode"
        />
        <Row
          title="Export my data"
          description="Account info, rules, file and change history, and audit entries. Passwords and API keys are left out."
        >
          <a
            href="/api/account/export"
            download
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-hairline bg-transparent px-5 py-2.5 text-sm font-medium text-ink no-underline transition-colors"
          >
            Download JSON
          </a>
        </Row>
      </Card>

      <DeleteAccount email={user.email} />
    </>
  );
}

// ---------------------------------------------------------------------------
// AI provider
// ---------------------------------------------------------------------------

function InstanceRows({ instance }: { instance: InstanceAIView | null }) {
  if (!instance) {
    return (
      <Card>
        <Row
          title="Mode"
          description="The instance AI settings could not be read. The administrator should check AI_PROVIDER, AI_MODEL and AI_BASE_URL."
        >
          <StatusBadge status="failed">Misconfigured</StatusBadge>
        </Row>
      </Card>
    );
  }

  const { description: d } = instance;
  const off = d.provider === "off";
  const badge = off
    ? { status: "deleted" as const, text: "Rules only" }
    : d.local
      ? { status: "ready" as const, text: "Runs on this machine" }
      : { status: "processing" as const, text: "Cloud API" };

  return (
    <Card>
      <Row
        title="Mode"
        description={
          off
            ? "AI is disabled for this instance. Cleaning uses rules only."
            : d.local
              ? "Requests stay on this machine."
              : "Requests go to a hosted provider."
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">{off ? "Off" : "Instance model"}</span>
          <StatusBadge status={badge.status}>{badge.text}</StatusBadge>
        </div>
      </Row>
      <Row title="Provider" description="The API that serves model requests.">
        <span className="text-sm font-normal text-ink">{providerLabel[d.provider]}</span>
      </Row>
      {!off && (
        <Row title="Model" description="Model id sent with each request.">
          <Mono chip>{d.model}</Mono>
        </Row>
      )}
      {instance.endpoint && (
        <Row title="Endpoint" description="Base URL that requests are sent to.">
          <Mono chip className="break-all">
            {instance.endpoint}
          </Mono>
        </Row>
      )}
    </Card>
  );
}

async function AIProviderSection() {
  const { user } = await requireUser();
  const view = getAISettingsView(user.id);

  return (
    <>
      <InstanceRows instance={view.instance} />
      <AIProviderForm instanceLabel={view.instance?.label ?? "unavailable"} user={view.user} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function Section({
  id,
  title,
  level = "h2",
  children,
}: {
  id: string;
  title: string;
  level?: "h1" | "h2";
  children: ReactNode;
}) {
  const Heading = level;
  return (
    <section id={id} className={sectionClass}>
      <Heading className="text-[28px] font-semibold leading-[1.25]">{title}</Heading>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  return (
    <>
      <AppHeader actions={<AccountButton active />} />

      <div className="mx-auto flex max-w-[1344px] flex-wrap">
        {/* Design sidebar is 240px content + 32px padding = 272px; SideNav is border-box at 240px. */}
        <div className="w-full sm:w-[272px] sm:shrink-0">
          <SettingsNav />
        </div>

        {/* Design main is 760px content + 2 x 32px padding; preflight is border-box, so max is 824px. */}
        <main className="flex min-w-0 max-w-[824px] flex-[1_1_320px] flex-col gap-12 p-4 sm:p-8">
          <Section id="profile" title="Profile" level="h1">
            <Suspense fallback={<SectionSkeleton rows={3} />}>
              <ProfileSection />
            </Suspense>
          </Section>

          <Section id="security" title="Security">
            <Suspense fallback={<SectionSkeleton rows={3} />}>
              <SecuritySection />
            </Suspense>
          </Section>

          <Section id="privacy" title="Privacy & data">
            <Suspense fallback={<SectionSkeleton rows={3} />}>
              <PrivacySection />
            </Suspense>
          </Section>

          <Section id="ai-provider" title="AI provider">
            <Suspense fallback={<SectionSkeleton rows={4} />}>
              <AIProviderSection />
            </Suspense>
            <p className="text-sm text-slate">
              The instance model is set by the administrator through <Mono>AI_PROVIDER</Mono> and related
              variables, or in the admin console. Your own key is used only for your files.
            </p>
          </Section>
        </main>
      </div>
    </>
  );
}

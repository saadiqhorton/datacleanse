import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { AccountButton, AppHeader, SideNav } from "@/components/layout";
import { isLocal, readAIConfig, type AIConfig } from "@/lib/ai/config";
import { Button, Card, Mono, StatusBadge, cn } from "@/components/ui";

export const metadata: Metadata = {
  title: "Settings · DataCleanse",
};

function Row({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5",
        className,
      )}
    >
      <div>
        <div className="text-base font-medium">{title}</div>
        <div className="text-sm text-slate">{description}</div>
      </div>
      {children}
    </div>
  );
}

const selectClass =
  "h-10 rounded-lg border border-hairline bg-white px-3 text-sm font-normal text-ink";

const providerLabel: Record<AIConfig["provider"], string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI-compatible API",
  local: "Local OpenAI-compatible server (Ollama, LM Studio, llama.cpp)",
  off: "None",
};

/** Origin and path only, so credentials or query strings never reach the page. */
function displayEndpoint(baseURL: string) {
  const url = new URL(baseURL);
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function AIProviderSkeleton() {
  return (
    <Card aria-hidden="true" className="animate-pulse">
      {Array.from({ length: 5 }, (_, i) => (
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

async function AIProviderDetails() {
  await connection();

  let config: AIConfig;
  let local: boolean;
  try {
    config = readAIConfig();
    local = isLocal(config);
  } catch {
    return (
      <Card>
        <Row
          className="border-b border-divider last:border-b-0"
          title="Mode"
          description="AI settings could not be read. Check AI_PROVIDER, AI_MODEL and AI_BASE_URL in .env.local."
        >
          <StatusBadge status="failed">Misconfigured</StatusBadge>
        </Row>
      </Card>
    );
  }

  const off = config.provider === "off";
  const modeLabel = off ? "Off" : config.provider === "local" ? "Local model" : "Your API key";
  const modeBadge = off
    ? { status: "deleted" as const, text: "Rules only" }
    : local
      ? { status: "ready" as const, text: "Runs on this machine" }
      : { status: "processing" as const, text: "Cloud API" };
  const modeDescription = off
    ? "AI is disabled. Cleaning uses rules only."
    : local
      ? "Requests stay on this machine."
      : "Requests go to a hosted provider using your API key.";
  const endpoint =
    !off && config.provider !== "anthropic" && config.baseURL
      ? displayEndpoint(config.baseURL)
      : null;

  return (
    <Card>
      <Row
        className="border-b border-divider last:border-b-0"
        title="Mode"
        description={modeDescription}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">{modeLabel}</span>
          <StatusBadge status={modeBadge.status}>{modeBadge.text}</StatusBadge>
        </div>
      </Row>
      <Row
        className="border-b border-divider last:border-b-0"
        title="Provider"
        description="The API that serves model requests."
      >
        <span className="text-sm font-normal text-ink">{providerLabel[config.provider]}</span>
      </Row>
      {!off && (
        <Row
          className="border-b border-divider last:border-b-0"
          title="Model"
          description="Model id sent with each request."
        >
          <Mono chip>{config.model}</Mono>
        </Row>
      )}
      {endpoint && (
        <Row
          className="border-b border-divider last:border-b-0"
          title="Endpoint"
          description="Base URL that requests are sent to."
        >
          <Mono chip className="break-all">{endpoint}</Mono>
        </Row>
      )}
      <Row
        className="border-b border-divider last:border-b-0"
        title="Connection"
        description="Check that the configured model responds."
      >
        <a
          href="/api/ai/status"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-hairline bg-transparent px-5 py-2.5 text-sm font-medium text-ink transition-colors"
        >
          Test connection
        </a>
      </Row>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <>
      <AppHeader actions={<AccountButton active />} />

      <div className="mx-auto flex max-w-[1344px] flex-wrap">
        {/* Design sidebar is 240px content + 32px padding = 272px; SideNav is border-box at 240px. */}
        <div className="w-full sm:w-[272px] sm:shrink-0">
          <SideNav
            label="Settings"
            active={["Security", "Privacy & data"]}
            items={[
              { label: "Profile", href: "/settings#profile" },
              { label: "Security", href: "/settings#security" },
              { label: "Privacy & data", href: "/settings#privacy" },
              { label: "AI provider", href: "/settings#ai-provider" },
            ]}
          />
        </div>

        {/* Design main is 760px content + 2 x 32px padding; preflight is border-box, so max is 824px. */}
        <main className="flex min-w-0 max-w-[824px] flex-[1_1_320px] flex-col gap-12 p-4 sm:p-8">
          <section id="security" className="flex flex-col gap-4">
            <h1 className="text-[28px] font-semibold leading-[1.25]">Security</h1>
            <Card>
              <Row
                className="border-b border-divider last:border-b-0"
                title="Two-factor authentication"
                description="Use an authenticator app when you sign in."
              >
                <StatusBadge status="ready">On</StatusBadge>
              </Row>
              <Row
                className="border-b border-divider last:border-b-0"
                title="Password"
                description="Last changed 3 months ago"
              >
                <Button variant="secondary" size="md">
                  Change
                </Button>
              </Row>
              <Row
                className="border-b border-divider last:border-b-0"
                title="Active sessions"
                description="2 devices · this browser and an iPhone"
              >
                <Button variant="secondary" size="md">
                  Sign out others
                </Button>
              </Row>
            </Card>
          </section>

          <section id="privacy" className="flex flex-col gap-4">
            <h2 className="text-[28px] font-semibold leading-[1.25]">Privacy &amp; data</h2>
            <Card>
              <Row
                className="border-b border-divider last:border-b-0"
                title={
                  <label htmlFor="retention" className="cursor-pointer">
                    Keep files for
                  </label>
                }
                description="Uploads and cleaned files are deleted after this."
              >
                <select id="retention" defaultValue="24 hours" className={selectClass}>
                  <option>1 hour</option>
                  <option>24 hours</option>
                  <option>7 days</option>
                </select>
              </Row>
              <Row
                className="border-b border-divider last:border-b-0"
                title="Default cleaning mode"
                description="AI only sees column names, statistics and a 20-row sample."
              >
                <select
                  aria-label="Default cleaning mode"
                  defaultValue="Rules + AI"
                  className={selectClass}
                >
                  <option>Rules + AI</option>
                  <option>Rules only</option>
                </select>
              </Row>
              <Row
                className="border-b border-divider last:border-b-0"
                title="AI model"
                description="Run a local model so nothing leaves your machine, or bring your own API key."
              >
                <select aria-label="AI model" defaultValue="Local model" className={selectClass}>
                  <option>Local model</option>
                  <option>Your API key</option>
                  <option>Off</option>
                </select>
              </Row>
              <Row
                className="border-b border-divider last:border-b-0"
                title="Export my data"
                description="Account info, rules and report history."
              >
                <Button variant="secondary" size="md">
                  Request export
                </Button>
              </Row>
            </Card>

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-error-border bg-error-bg px-4 py-4 sm:px-6 sm:py-5">
              <div>
                <div className="text-base font-medium text-error-ink">
                  Delete account and all data
                </div>
                <div className="text-sm text-slate">
                  Permanently removes files, reports, rules and your account.
                </div>
              </div>
              <Button variant="destructive" size="md">
                Delete everything
              </Button>
            </div>
          </section>

          <section id="ai-provider" className="flex flex-col gap-4">
            <h2 className="text-[28px] font-semibold leading-[1.25]">AI provider</h2>
            <Suspense fallback={<AIProviderSkeleton />}>
              <AIProviderDetails />
            </Suspense>
            <p className="text-sm text-slate">
              Set <Mono>AI_PROVIDER</Mono>, <Mono>AI_MODEL</Mono>, <Mono>AI_BASE_URL</Mono> and{" "}
              <Mono>AI_API_KEY</Mono> in <Mono>.env.local</Mono>. See <Mono>.env.example</Mono>.
            </p>
          </section>
        </main>
      </div>
    </>
  );
}

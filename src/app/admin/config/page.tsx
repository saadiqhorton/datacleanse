import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { Card, Mono, StatusBadge } from "@/components/ui";
import { getAIAdminView, type AIAdminView } from "@/server/admin/config";
import { requireAdmin } from "@/server/auth/session";
import { AdminFrame, AdminLoading, TableLoading } from "../_ui/AdminFrame";
import { AIConfigForm, type AIConfigInitial } from "../_ui/AIConfigForm";

export const metadata: Metadata = {
  title: "Configuration · Admin · DataCleanse",
};

const PROVIDER_LABEL: Record<AIConfigInitial["provider"], string> = {
  local: "Local model (OpenAI-compatible server)",
  anthropic: "Anthropic",
  openai: "OpenAI-compatible API",
  off: "Off (rules only)",
};

/** Origin and path only, so credentials or query strings never reach the page. */
function displayEndpoint(baseURL: string): string {
  const url = new URL(baseURL);
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

export default function AdminConfigPage() {
  return (
    <Suspense fallback={<AdminLoading />}>
      <AdminFrame active="Configuration">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl leading-[1.2] font-semibold tracking-[-0.5px]">Configuration</h1>
          <p className="text-sm text-slate">Instance-wide settings. Users who choose instance AI use this provider.</p>
        </div>

        <Suspense fallback={<TableLoading label="Loading configuration" />}>
          <AIConfiguration />
        </Suspense>
      </AdminFrame>
    </Suspense>
  );
}

async function AIConfiguration() {
  await requireAdmin();
  const view = getAIAdminView();

  const initial: AIConfigInitial | null = view.effective
    ? {
        provider: view.effective.provider,
        model: view.effective.model,
        baseURL: view.effective.baseURL ?? "",
        hasKey: view.effective.hasKey,
      }
    : null;

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <section aria-labelledby="effective-heading" className="flex flex-col gap-4">
        <h2 id="effective-heading" className="text-lg leading-[normal] font-semibold">
          Effective configuration
        </h2>
        <EffectiveConfig view={view} />
        <p className="text-sm text-slate">
          Environment variables are the defaults: <Mono>AI_PROVIDER</Mono>, <Mono>AI_MODEL</Mono>,{" "}
          <Mono>AI_BASE_URL</Mono> and <Mono>AI_API_KEY</Mono> in <Mono>.env.local</Mono> (see{" "}
          <Mono>.env.example</Mono>). Settings saved on this page override them, and removing them here falls back to
          the environment.
        </p>
      </section>

      <section aria-labelledby="provider-heading" className="flex flex-col gap-4">
        <h2 id="provider-heading" className="text-lg leading-[normal] font-semibold">
          AI provider
        </h2>
        <Card className="p-6">
          {initial ? (
            <AIConfigForm initial={initial} />
          ) : (
            <p role="alert" className="text-sm text-error">
              The AI settings could not be read, so they cannot be edited here. Check AI_PROVIDER in .env.local.
            </p>
          )}
        </Card>
      </section>
    </div>
  );
}

function EffectiveConfig({ view }: { view: AIAdminView }) {
  if (!view.effective) {
    return (
      <Card>
        <Row title="Status" description={view.effectiveError ?? "Unknown error."}>
          <StatusBadge status="failed">Misconfigured</StatusBadge>
        </Row>
      </Card>
    );
  }

  const { effective, saved } = view;
  const off = effective.provider === "off";
  const keySource = !effective.hasKey ? "Not set" : saved.apiKey ? "Saved here" : "From environment";
  const sourceOf = (overridden: boolean) => (overridden ? "Saved here" : "Environment default");

  return (
    <Card>
      <Row title="Provider" description={sourceOf(saved.provider)}>
        <span className="text-sm font-medium">{PROVIDER_LABEL[effective.provider]}</span>
      </Row>
      {!off && (
        <Row title="Model" description={sourceOf(saved.model)}>
          <Mono chip>{effective.model}</Mono>
        </Row>
      )}
      {!off && effective.baseURL && (
        <Row title="Endpoint" description={sourceOf(saved.baseURL)}>
          <Mono chip className="break-all">
            {displayEndpoint(effective.baseURL)}
          </Mono>
        </Row>
      )}
      {!off && (
        <Row title="API key" description="The key itself is never shown.">
          <span className="text-sm font-medium">{keySource}</span>
        </Row>
      )}
      <Row title="Where data goes" description={off ? "Nowhere. AI is disabled." : effective.local ? "Stays on this machine." : "Sent to a hosted provider."}>
        <StatusBadge status={off ? "deleted" : effective.local ? "ready" : "processing"}>
          {off ? "Rules only" : effective.local ? "On this machine" : "Hosted API"}
        </StatusBadge>
      </Row>
      {view.envDefaults && (
        <Row title="Environment default" description="What the environment alone would use.">
          <span className="text-sm text-slate">
            {PROVIDER_LABEL[view.envDefaults.provider]}
            {view.envDefaults.provider !== "off" ? ` · ${view.envDefaults.model}` : ""}
          </span>
        </Row>
      )}
      {view.envError && (
        <Row title="Environment" description={view.envError}>
          <StatusBadge status="failed">Invalid</StatusBadge>
        </Row>
      )}
    </Card>
  );
}

function Row({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-divider px-4 py-4 last:border-b-0 sm:px-6 sm:py-5">
      <div>
        <div className="text-base font-medium">{title}</div>
        <div className="text-sm text-slate">{description}</div>
      </div>
      {children}
    </div>
  );
}

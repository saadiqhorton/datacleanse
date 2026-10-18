import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AccountButton, AppHeader, SideNav } from "@/components/layout";
import { Button, Card, StatusBadge, cn } from "@/components/ui";

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
        "flex flex-wrap items-center justify-between gap-4 px-6 py-5",
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

export default function SettingsPage() {
  return (
    <>
      <AppHeader actions={<AccountButton active />} />

      <div className="mx-auto flex max-w-[1280px] flex-wrap">
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

        <main className="flex min-w-0 max-w-[760px] flex-[1_1_320px] flex-col gap-12 p-4 sm:p-8">
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

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-error-border bg-error-bg px-6 py-5">
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
        </main>
      </div>
    </>
  );
}

"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Mono, StatusBadge, TextField } from "@/components/ui";
import {
  confirmTwoFactorAction,
  disableTwoFactorAction,
  startTwoFactorAction,
  type SettingsState,
  type TwoFactorEnrollment,
} from "../actions";
import { FormMessage, Row } from "./Row";

type Enrollment = Extract<TwoFactorEnrollment, { ok: true }>;
type Mode = "idle" | "enrolling" | "disabling";

/**
 * Two-factor sign-in. Off: "Turn on" shows a QR code and setup key, then asks for a code to confirm.
 * On: a badge, and "Turn off" asks for a code first.
 */
export function TwoFactorSetup({ enabled }: { enabled: boolean }) {
  const [mode, setMode] = useState<Mode>("idle");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();

  const [confirmState, confirmAction, confirming] = useActionState<SettingsState, FormData>(
    confirmTwoFactorAction,
    null,
  );
  const [disableState, disableAction, disabling] = useActionState<SettingsState, FormData>(
    disableTwoFactorAction,
    null,
  );

  // Each panel is opened by an explicit click, so a stale mode from an earlier step is never shown.
  const showEnroll = !enabled && mode === "enrolling" && enrollment !== null;
  const showDisable = enabled && mode === "disabling";

  function turnOn() {
    setStartError(null);
    startTransition(async () => {
      const result = await startTwoFactorAction();
      if (result.ok) {
        setEnrollment(result);
        setMode("enrolling");
      } else {
        setStartError(result.error);
      }
    });
  }

  function cancel() {
    setMode("idle");
    setEnrollment(null);
  }

  return (
    <>
      <Row
        title="Two-factor authentication"
        description="Use an authenticator app when you sign in."
      >
        <div className="flex flex-wrap items-center gap-3">
          {enabled ? (
            <>
              <StatusBadge status="ready">On</StatusBadge>
              <Button
                variant="secondary"
                size="md"
                onClick={() => setMode(mode === "disabling" ? "idle" : "disabling")}
                aria-expanded={showDisable}
              >
                Turn off
              </Button>
            </>
          ) : (
            <>
              <StatusBadge status="deleted">Off</StatusBadge>
              <Button variant="secondary" size="md" onClick={turnOn} disabled={starting}>
                {starting ? "Starting…" : "Turn on"}
              </Button>
            </>
          )}
        </div>
      </Row>

      {startError && (
        <div className="border-b border-divider px-4 py-4 sm:px-6">
          <FormMessage error={startError} />
        </div>
      )}

      {showEnroll && enrollment && (
        <div className="flex flex-col gap-5 border-b border-divider px-4 py-5 sm:px-6">
          <div className="flex flex-col gap-1">
            <div className="text-base font-medium">Add DataCleanse to your authenticator app</div>
            <div className="text-sm text-slate">
              Scan the code with an app such as 1Password, Google Authenticator or Aegis. Or enter the setup
              key by hand.
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-6">
            {/* A data URL generated on the server; next/image does not apply. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enrollment.qrDataUrl}
              alt="QR code for your authenticator app"
              width={208}
              height={208}
              className="size-52 rounded-lg border border-hairline bg-white p-2"
            />
            <div className="flex min-w-0 flex-col gap-2 text-sm">
              <span className="font-medium">Setup key</span>
              <Mono chip className="break-all">
                {enrollment.secret}
              </Mono>
            </div>
          </div>
          <form action={confirmAction} className="flex flex-col gap-4">
            <TextField
              label="Code from your app"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,8}"
              maxLength={8}
              required
              hint="Enter the 6-digit code to turn two-factor sign-in on."
              className="max-w-xs"
            />
            <FormMessage error={confirmState?.error} />
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="primary" size="md" disabled={confirming}>
                Confirm and turn on
              </Button>
              <Button variant="secondary" size="md" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {showDisable && (
        <form action={disableAction} className="flex flex-col gap-4 border-b border-divider px-4 py-5 sm:px-6">
          <div className="text-sm text-slate">
            Enter a code from your authenticator app to turn two-factor sign-in off.
          </div>
          <TextField
            label="Code from your app"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,8}"
            maxLength={8}
            required
            className="max-w-xs"
          />
          <FormMessage error={disableState?.error} ok={disableState?.ok} />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="destructive" size="md" disabled={disabling}>
              Turn off
            </Button>
            <Button variant="secondary" size="md" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </>
  );
}

"use client";

import { useActionState, useId, useState } from "react";
import { DEFAULT_MODELS } from "@/lib/ai/config";
import { Button, Card, Mono } from "@/components/ui";
import { saveAIProviderAction, testAIConnectionAction, type SettingsState } from "../actions";
import type { AIConnectionResult } from "@/server/settings/ai";
import { FormMessage, Row, inputClass, selectClass } from "./Row";

type OwnProvider = "anthropic" | "openai";
type Mode = "instance" | "own_key" | "off";

const PROVIDER_LABELS: Record<OwnProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI-compatible API",
};

export interface UserAIProps {
  aiMode: Mode;
  ownKey: { provider: OwnProvider; model: string; baseURL?: string; hasKey: boolean } | null;
}

/**
 * Chooses which model answers AI requests for this account. Keys are write-only: the form shows
 * "Key saved" and a blank field keeps the saved key. Nothing returned here contains key material.
 */
export function AIProviderForm({ instanceLabel, user }: { instanceLabel: string; user: UserAIProps }) {
  const ids = {
    mode: useId(),
    provider: useId(),
    model: useId(),
    baseURL: useId(),
    key: useId(),
  };
  const [mode, setMode] = useState<Mode>(user.aiMode);
  const [provider, setProvider] = useState<OwnProvider>(user.ownKey?.provider ?? "anthropic");
  const [model, setModel] = useState<string>(user.ownKey?.model ?? "");
  const [baseURL, setBaseURL] = useState<string>(user.ownKey?.baseURL ?? "");

  const [saveState, saveAction, saving] = useActionState<SettingsState, FormData>(saveAIProviderAction, null);
  const [testResult, testAction, testing] = useActionState<AIConnectionResult | null, FormData>(
    testAIConnectionAction,
    null,
  );

  /** Switching provider moves the model to that provider's default, unless the user typed their own. */
  function changeProvider(next: OwnProvider) {
    if (!model || model === DEFAULT_MODELS[provider]) setModel(DEFAULT_MODELS[next]);
    setProvider(next);
  }

  const hasKey = user.ownKey?.hasKey ?? false;

  return (
    <>
      <Card>
        <form action={saveAction}>
          <Row
            title={
              <label htmlFor={ids.mode} className="cursor-pointer">
                AI mode
              </label>
            }
            description="Instance model uses the model above. Your API key sends requests with a key you provide. Off uses rules only."
          >
            <select
              id={ids.mode}
              name="aiMode"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className={selectClass}
            >
              <option value="instance">Instance model ({instanceLabel})</option>
              <option value="own_key">Your API key</option>
              <option value="off">Off</option>
            </select>
          </Row>

          {mode === "own_key" && (
            <>
              <Row
                title={
                  <label htmlFor={ids.provider} className="cursor-pointer">
                    Provider
                  </label>
                }
                description="Anthropic or any OpenAI-compatible API."
              >
                <select
                  id={ids.provider}
                  name="ownProvider"
                  value={provider}
                  onChange={(e) => changeProvider(e.target.value as OwnProvider)}
                  className={selectClass}
                >
                  <option value="anthropic">{PROVIDER_LABELS.anthropic}</option>
                  <option value="openai">{PROVIDER_LABELS.openai}</option>
                </select>
              </Row>

              <Row
                title={
                  <label htmlFor={ids.model} className="cursor-pointer">
                    Model
                  </label>
                }
                description="The model id sent with each request."
              >
                <input
                  id={ids.model}
                  name="ownModel"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={DEFAULT_MODELS[provider]}
                  maxLength={200}
                  autoComplete="off"
                  spellCheck={false}
                  className={`${inputClass} font-mono text-[13px]`}
                />
              </Row>

              {provider === "openai" && (
                <Row
                  title={
                    <label htmlFor={ids.baseURL} className="cursor-pointer">
                      Base URL
                    </label>
                  }
                  description="Optional. Leave blank for OpenAI. Include the /v1 path."
                >
                  <input
                    id={ids.baseURL}
                    name="ownBaseURL"
                    type="url"
                    value={baseURL}
                    onChange={(e) => setBaseURL(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    maxLength={2048}
                    autoComplete="off"
                    spellCheck={false}
                    className={`${inputClass} font-mono text-[13px]`}
                  />
                </Row>
              )}

              <Row
                title={
                  <label htmlFor={ids.key} className="cursor-pointer">
                    API key
                  </label>
                }
                description={
                  hasKey
                    ? "Stored encrypted. It is never shown again. Type a new key to replace it."
                    : "Stored encrypted. It is never shown again."
                }
              >
                <div className="flex flex-wrap items-center gap-3">
                  {hasKey && <Mono chip>Key saved</Mono>}
                  <input
                    id={ids.key}
                    name="ownApiKey"
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    maxLength={500}
                    placeholder={hasKey ? "Leave blank to keep it" : "Paste your key"}
                    className={`${inputClass} font-mono text-[13px]`}
                  />
                </div>
              </Row>
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-divider px-4 py-4 sm:px-6">
            <FormMessage error={saveState?.error} ok={saveState?.ok} />
            <Button type="submit" variant="primary" size="md" disabled={saving} className="ml-auto">
              Save AI settings
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <form
          action={testAction}
          className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5"
        >
          <div>
            <div className="text-base font-medium">Connection</div>
            <div
              className={testResult && !testResult.ok ? "text-sm text-error" : "text-sm text-slate"}
              aria-live="polite"
            >
              {testResult
                ? testResult.ok
                  ? `Connected. ${testResult.label} responded.`
                  : `${testResult.label}: ${testResult.error ?? "The check failed."}`
                : "Check that the saved settings for your account respond. Unsaved changes are not tested."}
            </div>
          </div>
          <Button type="submit" variant="secondary" size="md" disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </Button>
        </form>
      </Card>
    </>
  );
}

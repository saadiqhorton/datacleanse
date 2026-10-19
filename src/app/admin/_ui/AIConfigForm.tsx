"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button, CheckboxField, SelectField, StatusBadge, TextField } from "@/components/ui";
import { DEFAULT_BASE_URLS, DEFAULT_MODELS } from "@/lib/ai/config";
import {
  saveAIConfigAction,
  testAIConnectionAction,
  type ActionState,
  type ConnectionTestState,
} from "../actions";

type Provider = "local" | "anthropic" | "openai" | "off";

export interface AIConfigInitial {
  provider: Provider;
  model: string;
  baseURL: string;
  hasKey: boolean;
}

const OPTIONS: { value: Provider; label: string }[] = [
  { value: "local", label: "Local model (OpenAI-compatible server, e.g. Ollama, LM Studio)" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI-compatible API" },
  { value: "off", label: "Off (rules only)" },
];

const KNOWN_MODELS: string[] = Object.values(DEFAULT_MODELS);
const KNOWN_BASE_URLS: string[] = Object.values(DEFAULT_BASE_URLS);

function usesEndpoint(provider: Provider): provider is "local" | "openai" {
  return provider === "local" || provider === "openai";
}

export function AIConfigForm({ initial }: { initial: AIConfigInitial }) {
  const [provider, setProvider] = useState<Provider>(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [baseURL, setBaseURL] = useState(initial.baseURL);
  const [synced, setSynced] = useState(initial);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveAIConfigAction, null);
  const [test, testAction, testing] = useActionState<ConnectionTestState, FormData>(testAIConnectionAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  // A save refreshes the page with the stored values. Adopt them here rather than remounting the form,
  // which would discard the "Saved." message that the save action returned.
  if (initial !== synced) {
    setSynced(initial);
    setProvider(initial.provider);
    setModel(initial.model);
    setBaseURL(initial.baseURL);
  }

  // The typed key is stored encrypted and never shown again, so clear the field once it is saved.
  useEffect(() => {
    if (!state?.message) return;
    const keyField = formRef.current?.elements.namedItem("apiKey");
    if (keyField instanceof HTMLInputElement) keyField.value = "";
  }, [state]);

  // Switching provider swaps in that provider's default model and endpoint, unless the admin typed their own.
  function chooseProvider(next: Provider) {
    if (next === provider) return;
    if (next !== "off" && (model.trim() === "" || KNOWN_MODELS.includes(model.trim()))) {
      setModel(DEFAULT_MODELS[next]);
    }
    if (usesEndpoint(next) && (baseURL.trim() === "" || KNOWN_BASE_URLS.includes(baseURL.trim()))) {
      setBaseURL(DEFAULT_BASE_URLS[next]);
    }
    setProvider(next);
  }

  const defaultModel = provider === "off" ? "" : DEFAULT_MODELS[provider];

  return (
    <div className="flex flex-col gap-6">
      <form ref={formRef} action={action} className="flex flex-col gap-5">
        <SelectField
          label="Provider"
          name="provider"
          value={provider}
          onChange={(e) => chooseProvider(e.target.value as Provider)}
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>

        {provider !== "off" && (
          <TextField
            label="Model"
            name="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={defaultModel}
            hint={`Blank uses ${defaultModel}.`}
            autoComplete="off"
            spellCheck={false}
          />
        )}

        {usesEndpoint(provider) && (
          <TextField
            label="Base URL"
            name="baseURL"
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder={DEFAULT_BASE_URLS[provider]}
            hint={
              provider === "local"
                ? "Address of your local server, including /v1. Ollama listens on port 11434, LM Studio on 1234."
                : "Any OpenAI-compatible endpoint, such as OpenAI, OpenRouter or Groq."
            }
            autoComplete="off"
            spellCheck={false}
          />
        )}

        {provider !== "off" && (
          <TextField
            label={
              <span className="flex flex-wrap items-center gap-2">
                API key
                {initial.hasKey && <StatusBadge status="ready">Key saved</StatusBadge>}
              </span>
            }
            name="apiKey"
            type="password"
            autoComplete="new-password"
            placeholder={initial.hasKey ? "Leave blank to keep the saved key" : "Paste a key, if the provider needs one"}
            hint="Stored encrypted. Local servers usually need no key. The key is never shown again."
          />
        )}

        {initial.hasKey && provider !== "off" && (
          <CheckboxField name="clearKey">Clear the key saved here (keys from environment variables are kept)</CheckboxField>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            Save AI settings
          </Button>
          {(state?.error || state?.message) && (
            <span role={state?.error ? "alert" : "status"} className={state?.error ? "text-sm text-error" : "text-sm text-mint-ink"}>
              {state?.error ?? state?.message}
            </span>
          )}
        </div>
      </form>

      <form action={testAction} className="flex flex-wrap items-center gap-3 border-t border-divider pt-5">
        <Button type="submit" variant="secondary" disabled={testing}>
          Test connection
        </Button>
        <p className="text-sm text-slate">Checks the saved settings, not unsaved changes.</p>
        {test && (
          <p role={test.ok ? "status" : "alert"} className={test.ok ? "text-sm text-mint-ink" : "text-sm text-error"}>
            {test.message}
          </p>
        )}
      </form>
    </div>
  );
}

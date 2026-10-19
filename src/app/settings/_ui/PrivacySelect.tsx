"use client";

import { useActionState, useId, type ReactNode } from "react";
import { savePrivacySettingAction, type SettingsState } from "../actions";
import { FormMessage, Row, selectClass } from "./Row";

/**
 * A setting that saves as soon as it changes. Each select posts only its own field; the server
 * validates it and writes one audit entry when the value changes.
 */
export function PrivacySelect({
  name,
  title,
  description,
  defaultValue,
  options,
  ariaLabel,
}: {
  name: "retentionHours" | "defaultMode";
  title: ReactNode;
  description: ReactNode;
  defaultValue: string;
  options: { value: string; label: string }[];
  ariaLabel?: string;
}) {
  const id = useId();
  const [state, action, pending] = useActionState<SettingsState, FormData>(savePrivacySettingAction, null);

  return (
    <Row
      title={
        <label htmlFor={id} className="cursor-pointer">
          {title}
        </label>
      }
      description={description}
    >
      <form action={action} className="flex flex-col items-end gap-1">
        <select
          id={id}
          name={name}
          aria-label={ariaLabel}
          defaultValue={defaultValue}
          disabled={pending}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className={selectClass}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <FormMessage error={state?.error} ok={state?.ok} />
      </form>
    </Row>
  );
}

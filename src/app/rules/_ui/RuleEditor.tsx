"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Button, CheckboxField, Eyebrow, SelectField, TextField } from "@/components/ui";
import {
  ACTION_LABELS,
  DATE_ORDER_LABELS,
  KEEP_LABELS,
  LOW_CONFIDENCE_LABELS,
  MAX_DISTANCE,
  RULE_ACTIONS,
  type RuleView,
} from "@/server/rules/params";
import {
  emptyRuleFields,
  fieldsFromRule,
  paramsFromFields,
  type RuleFields,
} from "@/server/rules/input";
import { saveRuleAction } from "../actions";
import { Notice, type NoticeState } from "./Notice";

const selectOptions = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));

/**
 * Add a rule by hand, or edit one. The params fields follow the chosen action; the server validates the
 * result again before anything is saved.
 */
export function RuleEditor({
  setId,
  rule,
  onDone,
}: {
  setId: string;
  rule: RuleView | null;
  onDone: () => void;
}) {
  const [fields, setFields] = useState<RuleFields>(() => (rule ? fieldsFromRule(rule) : emptyRuleFields()));
  const [notice, setNotice] = useState<NoticeState>(null);
  const [pending, startTransition] = useTransition();
  const editing = rule !== null;

  function update<K extends keyof RuleFields>(key: K, value: RuleFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = paramsFromFields(fields);
    if (!built.ok) {
      setNotice({ tone: "error", text: built.error });
      return;
    }
    const formData = new FormData();
    formData.set("setId", setId);
    if (rule) formData.set("ruleId", rule.id);
    formData.set("columnPattern", fields.columnPattern);
    formData.set("action", fields.action);
    formData.set("onLowConfidence", fields.onLowConfidence);
    formData.set("description", fields.description);
    formData.set("params", JSON.stringify(built.value));

    startTransition(async () => {
      const result = await saveRuleAction(formData);
      if (!result.ok) {
        setNotice({ tone: "error", text: result.error });
        return;
      }
      setNotice({ tone: "ok", text: result.message ?? "Saved." });
      if (!editing) setFields(emptyRuleFields());
      onDone();
    });
  }

  let paramFields: ReactNode = null;
  switch (fields.action) {
    case "normalize_date":
      paramFields = (
        <SelectField label="Day and month order" value={fields.order} onChange={(e) => update("order", e.target.value as RuleFields["order"])}>
          {selectOptions(DATE_ORDER_LABELS)}
        </SelectField>
      );
      break;
    case "phone_e164":
      paramFields = (
        <TextField
          label="Default country"
          hint="Two letters, such as US. Used for numbers with no country code."
          value={fields.defaultCountry}
          onChange={(e) => update("defaultCountry", e.target.value)}
          maxLength={2}
          required
        />
      );
      break;
    case "dedupe_key":
      paramFields = (
        <SelectField label="Which duplicate to keep" value={fields.keep} onChange={(e) => update("keep", e.target.value as RuleFields["keep"])}>
          {selectOptions(KEEP_LABELS)}
        </SelectField>
      );
      break;
    case "country_names":
    case "fix_typos":
      paramFields = (
        <TextField
          label="Typo tolerance"
          type="number"
          min={0}
          max={MAX_DISTANCE}
          step={1}
          hint="Edit distance, 0 to 3. How many letters can differ before a value counts as a typo."
          value={fields.maxDistance}
          onChange={(e) => update("maxDistance", e.target.value)}
          required
        />
      );
      break;
    case "map_values":
      paramFields = (
        <>
          <label className="flex flex-col gap-1.5 text-sm font-medium md:col-span-2">
            Values to replace
            <textarea
              value={fields.mapText}
              onChange={(e) => update("mapText", e.target.value)}
              rows={4}
              placeholder={"UK -> United Kingdom\nUSA -> United States"}
              className="rounded-lg border border-hairline px-3 py-2 font-mono text-[13px] font-normal text-ink outline-none focus:border-2 focus:border-mint"
            />
            <span className="text-[13px] font-normal text-slate">One per line: old value → new value.</span>
          </label>
          <CheckboxField
            checked={fields.caseInsensitive}
            onChange={(e) => update("caseInsensitive", e.target.checked)}
            className="md:col-span-2"
          >
            Ignore case when matching
          </CheckboxField>
        </>
      );
      break;
    default:
      paramFields = null;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-hairline bg-white p-5">
      <Eyebrow>{editing ? "Edit rule" : "Add a rule by hand"}</Eyebrow>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="Column"
          hint="A header name, or a pattern: *_date for every date column, * for every column."
          value={fields.columnPattern}
          onChange={(e) => update("columnPattern", e.target.value)}
          maxLength={100}
          required
          className="font-mono"
        />
        <SelectField label="Action" value={fields.action} onChange={(e) => update("action", e.target.value as RuleFields["action"])}>
          {RULE_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {ACTION_LABELS[action]}
            </option>
          ))}
        </SelectField>
        {paramFields}
        <SelectField
          label="On low confidence"
          value={fields.onLowConfidence}
          onChange={(e) => update("onLowConfidence", e.target.value as RuleFields["onLowConfidence"])}
        >
          {selectOptions(LOW_CONFIDENCE_LABELS)}
        </SelectField>
        <TextField
          label="Description"
          hint="Shown in the rule list. Leave blank to write one from the action."
          value={fields.description}
          onChange={(e) => update("description", e.target.value)}
          maxLength={200}
          className="md:col-span-2"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Notice state={notice} />
        <div className="ml-auto flex gap-2">
          {editing && (
            <Button variant="secondary" size="md" onClick={onDone}>
              Cancel
            </Button>
          )}
          <Button type="submit" variant="primary" size="md" disabled={pending}>
            {editing ? "Save rule" : "Add rule"}
          </Button>
        </div>
      </div>
    </form>
  );
}

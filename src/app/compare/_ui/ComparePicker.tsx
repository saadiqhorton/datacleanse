"use client";

import { useActionState, useEffect, useState } from "react";
import { Button, Card, CheckboxField, SelectField } from "@/components/ui";
import { runCompareAction, sharedColumnsAction, type CompareState, type SharedColumnsResult } from "../actions";

export interface PickerFile {
  id: string;
  /** "name · 4,812 rows · cleaned" */
  label: string;
}

/** Shared columns for one pair and one cleaning choice. Keyed so stale answers are ignored. */
interface SharedState {
  key: string;
  result: SharedColumnsResult;
}

export function ComparePicker({
  files,
  initialLeft,
  initialRight,
}: {
  files: PickerFile[];
  initialLeft: string;
  initialRight: string;
}) {
  const [left, setLeft] = useState(initialLeft);
  const [right, setRight] = useState(initialRight);
  const [useCleaned, setUseCleaned] = useState(true);
  const [keyColumn, setKeyColumn] = useState("");
  const [shared, setShared] = useState<SharedState | null>(null);
  const [state, formAction, pending] = useActionState<CompareState, FormData>(runCompareAction, null);

  const samePair = left !== "" && left === right;
  const pairReady = left !== "" && right !== "" && !samePair;
  const pairKey = `${left}|${right}|${useCleaned}`;

  useEffect(() => {
    if (!pairReady) return;
    let active = true;
    sharedColumnsAction(left, right, useCleaned).then((result) => {
      if (!active) return;
      setShared({ key: pairKey, result });
      if (result.ok) setKeyColumn((prev) => (result.columns.includes(prev) ? prev : ""));
    });
    return () => {
      active = false;
    };
    // pairKey already encodes left, right and useCleaned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey]);

  const current = shared?.key === pairKey ? shared.result : null;
  const columns = current?.ok ? current.columns : [];
  const loadingColumns = pairReady && current === null;
  const hint = !pairReady
    ? "Pick both files to see the columns they share."
    : loadingColumns
      ? "Reading the columns…"
      : current?.ok === false
        ? current.error
        : "Auto-detect picks the best column both files share.";

  return (
    <Card className="flex flex-col gap-6 p-6">
      <form action={formAction} className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="First file" name="left" value={left} onChange={(e) => setLeft(e.target.value)} required>
            <option value="" disabled>
              Choose a file
            </option>
            {files.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Second file" name="right" value={right} onChange={(e) => setRight(e.target.value)} required>
            <option value="" disabled>
              Choose a file
            </option>
            {files.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="grid items-start gap-4 sm:grid-cols-2">
          <SelectField
            label="Match rows on"
            name="keyColumn"
            value={columns.includes(keyColumn) ? keyColumn : ""}
            onChange={(e) => setKeyColumn(e.target.value)}
            disabled={!pairReady || columns.length === 0}
            aria-describedby="key-hint"
          >
            <option value="">Auto-detect</option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
          <div className="flex flex-col gap-3 pt-6">
            <CheckboxField name="useCleaned" checked={useCleaned} onChange={(e) => setUseCleaned(e.target.checked)}>
              Use cleaned version when available
            </CheckboxField>
          </div>
        </div>
        <p id="key-hint" className={current?.ok === false ? "text-[13px] text-error" : "text-[13px] text-slate"}>
          {hint}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div role="alert" className="text-[13px] text-error">
            {state?.error}
          </div>
          <Button type="submit" variant="primary" size="md" disabled={!pairReady || pending} className="ml-auto">
            {pending ? "Comparing…" : "Compare"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

import type { CleanOptions } from "@/server/types";

export type CleaningModeChoice = "rules_ai" | "rules_only";

/** Ambiguous-date choices as the select shows them, with the server's dateOrder value for each. */
export const DATE_CHOICES = [
  { value: "detect", label: "Detect from column (recommended)", dateOrder: "auto" },
  { value: "month-day", label: "Month / Day", dateOrder: "mdy" },
  { value: "day-month", label: "Day / Month", dateOrder: "dmy" },
] as const satisfies readonly { value: string; label: string; dateOrder: CleanOptions["dateOrder"] }[];

export type DateChoice = (typeof DATE_CHOICES)[number]["value"];

/** Everything the Upload form sends, as the user set it. */
export interface UploadValues {
  mode: CleaningModeChoice;
  normalizeDates: boolean;
  dedupe: boolean;
  trimAndCase: boolean;
  fillMissing: boolean;
  dateChoice: DateChoice;
  /** "" means auto-detect the rule set from the file's headers. */
  ruleSetId: string;
}

export function dateOrderFor(choice: DateChoice): CleanOptions["dateOrder"] {
  const found = DATE_CHOICES.find((c) => c.value === choice);
  return found ? found.dateOrder : "auto";
}

/** The CleanOptions the server expects in the `options` field. */
export function toCleanOptions(values: UploadValues): CleanOptions {
  return {
    normalizeDates: values.normalizeDates,
    dedupe: values.dedupe,
    trimAndCase: values.trimAndCase,
    fillMissing: values.fillMissing,
    dateOrder: dateOrderFor(values.dateChoice),
  };
}

export function serializeOptions(values: UploadValues): string {
  return JSON.stringify(toCleanOptions(values));
}

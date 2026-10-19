"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, CheckboxField, Mono, RadioCard, SelectField, cn } from "@/components/ui";
import { DATE_CHOICES, type DateChoice, type UploadValues } from "../_lib/options";
import { fileKey, MAX_FILES, checkBatch, splitSelection } from "../_lib/validate";
import { parseSample, SAMPLE_BYTES, type PreviewResult } from "../_lib/preview";
import { destinationFor, sendUpload } from "../_lib/request";
import { Dropzone } from "./Dropzone";
import { FilePreview, type PreviewState } from "./FilePreview";
import { UPLOAD_MAIN_CLASS } from "./UploadSkeleton";

export interface UploadFormProps {
  maxUploadBytes: number;
  defaultMode: UploadValues["mode"];
  ai: { off: boolean; label: string };
  ruleSets: { id: string; name: string }[];
}

/** Shared classes from the static design: selected radio cards get a 2px ink border. */
const radioClass = "has-[:checked]:border-2 has-[:checked]:border-ink [&>input]:ml-[5px] [&>input]:mr-[3px]";
const checkboxClass = "[&>input]:ml-1 [&>input]:mr-[3px]";

type Phase = "idle" | "uploading" | "redirecting";

export function UploadForm({ maxUploadBytes, defaultMode, ai, ruleSets }: UploadFormProps) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [values, setValues] = useState<UploadValues>({
    mode: defaultMode,
    normalizeDates: true,
    dedupe: true,
    trimAndCase: true,
    fillMissing: false,
    dateChoice: "detect",
    ruleSetId: "",
  });
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);

  const first = files[0];
  const [sampled, setSampled] = useState<{ file: File; result: PreviewResult } | null>(null);
  useEffect(() => {
    if (!first) return;
    let cancelled = false;
    readPreview(first).then((result) => {
      if (!cancelled) setSampled({ file: first, result });
    });
    return () => {
      cancelled = true;
    };
  }, [first]);

  const preview: PreviewState = !first
    ? { status: "idle" }
    : sampled && sampled.file === first
      ? { status: "ready", result: sampled.result }
      : { status: "loading" };

  const busy = phase !== "idle";
  const aiUnavailable = ai.off;

  function set<K extends keyof UploadValues>(key: K, value: UploadValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function addFiles(picked: File[]) {
    const { valid, rejected } = splitSelection(picked, maxUploadBytes);
    const seen = new Set(files.map(fileKey));
    const merged = [...files];
    for (const file of valid) {
      if (seen.has(fileKey(file))) continue;
      seen.add(fileKey(file));
      merged.push(file);
    }
    const batchError = checkBatch(merged, maxUploadBytes, MAX_FILES);
    if (batchError) {
      setFileErrors([batchError]);
      return;
    }
    setFiles(merged);
    setFileErrors(rejected.map((r) => r.message));
    setServerError(null);
  }

  function removeFile(index: number) {
    setFiles((list) => list.filter((_, i) => i !== index));
    setFileErrors([]);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0 || busy) return;
    setServerError(null);
    setProgress(0);
    setPhase("uploading");
    const outcome = await sendUpload(files, values, setProgress);
    if (!outcome.ok) {
      setPhase("idle");
      setServerError(outcome.message);
      return;
    }
    setPhase("redirecting");
    router.push(destinationFor(outcome.files));
  }

  const buttonLabel =
    phase === "redirecting"
      ? "Opening…"
      : phase === "uploading"
        ? progress >= 100
          ? "Saving…"
          : `Uploading ${progress}%`
        : "Start cleaning";

  // The form has display: contents, so its two sections stay direct grid items of <main>.
  return (
    <main className={UPLOAD_MAIN_CLASS}>
      <form className="contents" onSubmit={onSubmit} aria-label="Upload and clean options">
        <section className="flex min-w-0 flex-col gap-6">
          <h1 className="text-4xl font-semibold leading-[1.2] tracking-[-0.5px]">Upload a CSV</h1>

          <Dropzone onFiles={addFiles} disabled={busy} />
          {fileErrors.length > 0 && (
            <div role="alert" className="flex flex-col gap-1 text-[14px] text-error">
              {fileErrors.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          )}

          <FilePreview files={files} preview={preview} onRemove={removeFile} disabled={busy} />
        </section>

        <section className="flex min-w-0 flex-col gap-6">
          <Card className="flex flex-col gap-4 p-6">
            <h2 className="text-[18px] font-semibold">How should we clean it?</h2>
            <RadioCard
              name="mode"
              value="rules_ai"
              disabled={aiUnavailable || busy}
              checked={values.mode === "rules_ai"}
              onChange={() => set("mode", "rules_ai")}
              title="Rules + AI suggestions"
              description={
                <>
                  Rules fix the obvious issues. AI suggests fixes for ambiguous values, and you approve each one.
                  <span className="mt-2 block text-[13px]">
                    {aiUnavailable ? (
                      <Link href="/settings#ai-provider" className="font-medium text-ink underline">
                        AI is off in Settings
                      </Link>
                    ) : (
                      <>Uses: {ai.label}</>
                    )}
                  </span>
                </>
              }
              className={cn(radioClass, aiUnavailable && "cursor-not-allowed opacity-60")}
            />
            <RadioCard
              name="mode"
              value="rules_only"
              disabled={busy}
              checked={values.mode === "rules_only"}
              onChange={() => set("mode", "rules_only")}
              title="Rules only"
              description="Nothing leaves our servers. Best for sensitive data."
              className={radioClass}
            />
            <SelectField
              label="Rule set"
              className="mt-2"
              value={values.ruleSetId}
              disabled={busy}
              onChange={(e) => set("ruleSetId", e.currentTarget.value)}
            >
              <option value="">Auto-detect from headers (default)</option>
              {ruleSets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectField>
          </Card>

          <Card className="flex flex-col gap-3 p-6">
            <h2 className="text-[18px] font-semibold">What to fix</h2>
            <CheckboxField
              checked={values.normalizeDates}
              onChange={(e) => set("normalizeDates", e.currentTarget.checked)}
              disabled={busy}
              className={checkboxClass}
            >
              Normalize dates to <Mono chip>YYYY-MM-DD</Mono>
            </CheckboxField>
            <CheckboxField
              checked={values.dedupe}
              onChange={(e) => set("dedupe", e.currentTarget.checked)}
              disabled={busy}
              className={checkboxClass}
            >
              Find and merge duplicate records
            </CheckboxField>
            <CheckboxField
              checked={values.trimAndCase}
              onChange={(e) => set("trimAndCase", e.currentTarget.checked)}
              disabled={busy}
              className={checkboxClass}
            >
              Trim whitespace and fix casing
            </CheckboxField>
            <CheckboxField
              checked={values.fillMissing}
              onChange={(e) => set("fillMissing", e.currentTarget.checked)}
              disabled={busy}
              className={checkboxClass}
            >
              Fill missing values (flag only by default)
            </CheckboxField>
            <SelectField
              label="Ambiguous dates like 03/04/22 mean"
              className="mt-2 leading-[17px]"
              value={values.dateChoice}
              disabled={busy}
              onChange={(e) => set("dateChoice", e.currentTarget.value as DateChoice)}
            >
              {DATE_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </SelectField>
          </Card>

          {serverError && (
            <p role="alert" className="text-[14px] text-error">
              {serverError}
            </p>
          )}
          <Button
            type="submit"
            variant="accent"
            size="lg"
            disabled={files.length === 0 || busy}
            aria-busy={busy || undefined}
            className="w-full rounded-full"
          >
            {buttonLabel}
          </Button>
        </section>
      </form>
    </main>
  );
}

/** Reads the first bytes of a file and parses them for the preview. Never throws. */
async function readPreview(file: File): Promise<PreviewResult> {
  try {
    const sample = new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer());
    return parseSample(sample, file.size);
  } catch {
    return { ok: false, message: "The file could not be read." };
  }
}

"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button, CloseIcon, Eyebrow, Mono } from "@/components/ui";
import { addHeadersAction, removeHeaderAction } from "../actions";
import { Notice, type NoticeState } from "./Notice";

export interface HeaderFileOption {
  id: string;
  name: string;
  headers: string[];
}

function sameHeader(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The headers a set matches on. Each change saves straight away. */
export function HeaderMatchEditor({
  setId,
  headers,
  files,
}: {
  setId: string;
  headers: string[];
  files: HeaderFileOption[];
}) {
  const [typed, setTyped] = useState("");
  const [fileId, setFileId] = useState(files[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [pending, startTransition] = useTransition();

  const file = files.find((f) => f.id === fileId);
  const offered = (file?.headers ?? []).filter((h) => !headers.some((existing) => sameHeader(existing, h)));

  function run(action: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, onOk?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setNotice({ tone: "ok", text: result.message ?? "Saved." });
        onOk?.();
      } else {
        setNotice({ tone: "error", text: result.error });
      }
    });
  }

  function addTyped(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("setId", setId);
    formData.append("header", typed);
    run(() => addHeadersAction(formData), () => setTyped(""));
  }

  function addPicked() {
    const formData = new FormData();
    formData.set("setId", setId);
    for (const h of picked) formData.append("header", h);
    run(() => addHeadersAction(formData), () => setPicked([]));
  }

  function remove(header: string) {
    const formData = new FormData();
    formData.set("setId", setId);
    formData.set("header", header);
    run(() => removeHeaderAction(formData));
  }

  return (
    <section aria-label="Matching headers" className="flex flex-col gap-3">
      <Eyebrow>Matching headers</Eyebrow>

      {headers.length > 0 ? (
        <ul aria-label="Headers this set matches" className="flex flex-wrap gap-2">
          {headers.map((header) => (
            <li key={header} className="flex items-center gap-1">
              <Mono chip>{header}</Mono>
              <button
                type="button"
                aria-label={`Remove header ${header}`}
                disabled={pending}
                onClick={() => remove(header)}
                className="inline-flex size-7 items-center justify-center rounded-full text-slate hover:bg-surface hover:text-ink disabled:opacity-50"
              >
                <CloseIcon size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate">
          No headers yet. A set with no headers is never applied automatically.
        </p>
      )}

      <form onSubmit={addTyped} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          Add a header
          <input
            name="header"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={100}
            placeholder="e.g. email"
            className="h-10 min-w-0 w-60 rounded-lg border border-hairline px-3 text-sm font-normal outline-none focus:border-2 focus:border-mint"
          />
        </label>
        <Button type="submit" variant="secondary" size="md" disabled={pending || typed.trim() === ""}>
          Add header
        </Button>
      </form>

      {files.length > 0 && (
        <details className="rounded-xl border border-hairline p-4">
          <summary className="cursor-pointer text-sm font-medium">Use headers from a recent file</summary>
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              File
              <select
                value={fileId}
                onChange={(e) => {
                  setFileId(e.target.value);
                  setPicked([]);
                }}
                className="h-10 max-w-full rounded-lg border border-hairline bg-white px-3 text-sm font-normal"
              >
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            {offered.length > 0 ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-[13px] font-medium">Headers in this file</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {offered.map((h) => (
                    <label key={h} className="flex min-h-9 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={picked.includes(h)}
                        onChange={(e) =>
                          setPicked((prev) => (e.target.checked ? [...prev, h] : prev.filter((x) => x !== h)))
                        }
                      />
                      <Mono>{h}</Mono>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <p className="text-sm text-slate">Every header in this file is already in the set.</p>
            )}
            <div>
              <Button type="button" variant="secondary" size="md" disabled={pending || picked.length === 0} onClick={addPicked}>
                Add selected headers
              </Button>
            </div>
          </div>
        </details>
      )}

      <Notice state={notice} />
    </section>
  );
}

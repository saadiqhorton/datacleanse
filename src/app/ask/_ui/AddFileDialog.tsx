"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { Button, Mono } from "@/components/ui";
import type { AskableFile } from "@/server/ask/types";
import { addFileAction } from "../actions";
import { formatCount } from "./format";


/** "+ Add file": pick one of the user's files to add to this chat. */
export function AddFileDialog({ chatId, files }: { chatId: string; files: AskableFile[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(addFileAction, null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      dialogRef.current?.close();
    }
  }, [state]);

  const error = state && !state.ok ? state.error : null;

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="inline-flex min-h-9 items-center rounded-lg px-3 py-2 text-left text-sm font-medium text-ink hover:bg-surface"
      >
        + Add file
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="add-file-title"
        className="m-auto w-[min(520px,calc(100vw-32px))] rounded-xl border border-hairline bg-white p-0 text-ink backdrop:bg-ink/30"
      >
        <form ref={formRef} action={action} className="flex flex-col gap-4 p-6">
          <input type="hidden" name="chatId" value={chatId} />
          <h2 id="add-file-title" className="text-lg font-semibold">
            Add a file to this chat
          </h2>

          {files.length === 0 ? (
            <p className="text-sm leading-normal text-slate">
              There are no other files to add.{" "}
              <Link href="/upload" className="font-medium text-ink underline">
                Upload a file
              </Link>{" "}
              first.
            </p>
          ) : (
            <fieldset className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              <legend className="mb-2 text-sm text-slate">Choose one file</legend>
              {files.map((file, i) => (
                <label
                  key={file.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-hairline px-3 py-2 text-sm has-[:checked]:border-2 has-[:checked]:border-mint"
                >
                  <input type="radio" name="fileId" value={file.id} defaultChecked={i === 0} />
                  <span className="flex min-w-0 flex-col">
                    <Mono className="truncate font-medium">{file.name}</Mono>
                    <span className="text-xs text-slate">
                      {file.rows !== null ? `${formatCount(file.rows)} rows` : "Rows unknown"}
                      {file.columns !== null ? ` · ${file.columns} cols` : ""}
                      {file.cleaned ? " · cleaned" : ""}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {error && (
            <p role="alert" className="text-[13px] text-error">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || files.length === 0}>
              {pending ? "Adding…" : "Add file"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

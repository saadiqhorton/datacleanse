"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, CheckboxField, Mono } from "@/components/ui";
import type { AskableFile } from "@/server/ask/types";
import { createChatAction } from "../actions";
import { formatCount } from "./format";

/** "New chat": pick files, then the chat opens with them. Opens by itself when there are no chats yet. */
export function NewChatForm({ files, startOpen }: { files: AskableFile[]; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [state, action, pending] = useActionState(createChatAction, null);
  const error = state && !state.ok ? state.error : null;

  if (files.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-white p-5">
        <p className="text-sm leading-normal text-slate">
          Ask questions about your files in plain English. Upload a CSV to start a chat.
        </p>
        <div>
          <Link
            href="/upload"
            className="inline-flex min-h-9 items-center rounded-full bg-ink px-4 py-2 text-sm font-medium text-white no-underline"
          >
            Upload a file
          </Link>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          New chat
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4 rounded-xl border border-hairline bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">New chat</h2>
        {!startOpen && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-2 text-sm text-slate">Files to ask about</legend>
        {files.map((file) => (
          <CheckboxField key={file.id} name="fileId" value={file.id} className="min-h-11 items-start py-1">
            <span className="flex min-w-0 flex-col">
              <Mono className="truncate font-medium">{file.name}</Mono>
              <span className="text-xs text-slate">
                {file.rows !== null ? `${formatCount(file.rows)} rows` : "Rows unknown"}
                {file.columns !== null ? ` · ${file.columns} cols` : ""}
                {file.cleaned ? " · cleaned" : ""} · <span className="font-mono">{file.alias}</span>
              </span>
            </span>
          </CheckboxField>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="text-[13px] text-error">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Starting…" : "Start chat"}
        </Button>
      </div>
    </form>
  );
}

"use client";

import { useState, type DragEvent } from "react";
import { UploadIcon, cn } from "@/components/ui";

export const ACCEPT = ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain";

/** Drop area and "Choose file" button. Both hand the chosen files to onFiles. */
export function Dropzone({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled: boolean }) {
  const [dragging, setDragging] = useState(false);

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    setDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    // Ignore moves between the zone's own children.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    onFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-dragging={dragging || undefined}
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed bg-surface px-6 py-12 text-center",
        dragging ? "border-mint" : "[border-color:var(--color-dashed)]",
      )}
    >
      <UploadIcon />
      <div className="text-[18px] font-semibold">Drop your file here</div>
      <div className="text-[14px] text-slate">
        .csv or .tsv · or add several at once to compare or ask about
      </div>
      <label
        className={cn(
          "inline-flex min-h-10 items-center justify-center rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-mint",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        )}
      >
        Choose file
        <input
          type="file"
          name="file"
          accept={ACCEPT}
          multiple
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            const picked = Array.from(event.currentTarget.files ?? []);
            // Clear the input so choosing the same file again still fires onChange.
            event.currentTarget.value = "";
            if (picked.length > 0) onFiles(picked);
          }}
        />
      </label>
    </div>
  );
}

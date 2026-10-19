import { Card, CheckIcon, Mono } from "@/components/ui";
import { formatBytes } from "../_lib/format";
import { rowCountLabel, type PreviewResult } from "../_lib/preview";

export type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: PreviewResult };

export function FilePreview({
  files,
  preview,
  onRemove,
  disabled,
}: {
  files: File[];
  preview: PreviewState;
  onRemove: (index: number) => void;
  disabled: boolean;
}) {
  if (files.length === 0) {
    return (
      <Card className="px-5 py-6 text-sm text-slate">
        Choose a file to see its first rows here.
      </Card>
    );
  }

  const first = files[0];
  const result = preview.status === "ready" ? preview.result : null;
  const meta = result?.ok
    ? [
        formatBytes(first.size),
        rowCountLabel(result.preview.rowCount),
        result.preview.delimiterName,
        <span key="enc" className="whitespace-nowrap">{result.preview.encoding}</span>,
      ]
    : [formatBytes(first.size)];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-5 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <CheckIcon className="shrink-0 text-mint-deep" />
          <Mono className="min-w-0 break-all font-medium">{first.name}</Mono>
          {files.length > 1 && <span className="shrink-0 text-[13px] text-slate">+{files.length - 1} more</span>}
        </div>
        <span className="text-[13px] text-slate">
          {meta.map((part, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {part}
            </span>
          ))}
        </span>
      </div>

      {files.length > 1 && (
        <ul aria-label="Selected files" className="divide-y divide-divider border-b border-divider">
          {files.map((file, i) => (
            <li key={`${file.name}-${file.lastModified}-${file.size}-${i}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]">
              <span className="flex min-w-0 items-center gap-2">
                <Mono className="min-w-0 break-all">{file.name}</Mono>
                <span className="shrink-0 text-slate">{formatBytes(file.size)}</span>
                {i === 0 && <span className="shrink-0 text-muted">previewed</span>}
              </span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                disabled={disabled}
                aria-label={`Remove ${file.name}`}
                className="shrink-0 rounded text-sm font-medium text-ink underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-muted"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {preview.status === "loading" || preview.status === "idle" ? (
        <p className="px-5 py-4 text-[13px] text-slate">Reading preview…</p>
      ) : result && !result.ok ? (
        <p role="status" className="px-5 py-4 text-[13px] text-error">
          No preview: {result.message}
        </p>
      ) : result && result.ok ? (
        <PreviewTable headers={result.preview.headers} rows={result.preview.rows} hiddenColumns={result.preview.columnCount - result.preview.headers.length} />
      ) : null}
    </Card>
  );
}

function PreviewTable({ headers, rows, hiddenColumns }: { headers: string[]; rows: string[][]; hiddenColumns: number }) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-[13px] leading-[1.4]">
          <thead>
            <tr className="bg-surface text-left text-ink-2">
              {headers.map((h, i) => (
                <th key={i} scope="col" className="whitespace-nowrap px-4 py-2 font-medium">
                  {h || "(no name)"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-slate">
            {rows.map((row, r) => (
              <tr key={r} className="border-t border-divider">
                {row.map((cell, c) =>
                  cell === "" ? (
                    <td key={c} className="whitespace-nowrap px-4 py-2 text-error">
                      (empty)
                    </td>
                  ) : (
                    <td key={c} className="whitespace-nowrap px-4 py-2">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenColumns > 0 && (
        <p className="border-t border-divider px-5 py-2 text-[13px] text-slate">
          +{hiddenColumns} more {hiddenColumns === 1 ? "column" : "columns"} not shown
        </p>
      )}
    </>
  );
}

import type { ReactNode } from "react";
import Link from "next/link";
import { Card, StatusBadge, cn } from "@/components/ui";
import { AI_OFF_MESSAGE, NO_ROWS_NOTE, PREVIEW_ROWS } from "@/server/ask/copy";
import type { AskResult, ChatMessageView } from "@/server/ask/types";
import { JoinCard } from "./JoinCard";
import { SqlBlock } from "./SqlBlock";
import { formatCount, formatSeconds, linkButtonClass } from "./format";

/** The conversation, oldest first. */
export function Messages({ messages }: { messages: ChatMessageView[] }) {
  return (
    <>
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </>
  );
}

function MessageItem({ message }: { message: ChatMessageView }) {
  if (message.role === "user") {
    return (
      <div className="max-w-[592px] self-end rounded-xl bg-surface px-4 py-3 text-base leading-normal">
        {message.content}
      </div>
    );
  }

  if (message.status === "needs_confirmation" && message.joins) {
    return (
      <div className="max-w-[820px]">
        <JoinCard messageId={message.id} joins={message.joins.joins} candidates={message.joins.candidates} />
      </div>
    );
  }
  if (message.status === "running") {
    return <p className="text-sm text-slate">Running…</p>;
  }
  if (message.status === "done" && message.result) {
    return <AnswerView message={message} result={message.result} />;
  }
  if (message.content === AI_OFF_MESSAGE) {
    return (
      <p className="max-w-[820px] text-base leading-normal">
        AI is off. Turn it on in{" "}
        <Link href="/settings" className="font-medium text-ink underline">
          Settings
        </Link>{" "}
        to ask questions.
      </p>
    );
  }
  return (
    <p
      className={cn(
        "max-w-[820px] text-base leading-normal",
        message.status === "failed" ? "text-error" : message.status === "blocked" ? "text-review" : "text-ink",
      )}
    >
      {message.content}
    </p>
  );
}

function AnswerView({ message, result }: { message: ChatMessageView; result: AskResult }) {
  const shown = result.rows.slice(0, PREVIEW_ROWS);
  const numeric = result.columns.map((_, i) => {
    const values = result.rows.map((row) => row[i]).filter((v) => v !== null);
    return values.length > 0 && values.every((v) => typeof v === "number");
  });
  const more = result.rows.length > PREVIEW_ROWS;

  return (
    <div className="flex max-w-[820px] flex-col gap-4">
      <div className="text-base leading-normal">{message.content}</div>

      {result.rows.length === 0 ? (
        <p className="text-sm text-slate">{NO_ROWS_NOTE}</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm leading-normal">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.5px] text-slate">
                {result.columns.map((column, i) => (
                  <th
                    key={`${column}-${i}`}
                    scope="col"
                    className={cn("px-4 py-2.5 font-semibold", numeric[i] && "text-right")}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, r) => (
                <tr key={r} className="border-t border-divider">
                  {row.map((cell, i) => (
                    <td
                      key={i}
                      className={cn(
                        "px-4 py-2.5 text-sm",
                        numeric[i] ? "text-right font-mono text-[13px]" : "",
                        cell === null && "text-muted",
                      )}
                    >
                      {cellText(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {more && (
            <div className="border-t border-divider px-4 py-2 text-xs text-slate">
              {result.truncated
                ? `Showing ${PREVIEW_ROWS} of the first ${formatCount(result.rows.length)} rows`
                : `Showing ${PREVIEW_ROWS} of ${formatCount(result.rows.length)} rows`}
            </div>
          )}
        </Card>
      )}

      {message.sql && (
        <SqlBlock
          sql={message.sql}
          caption={
            <span className="flex flex-wrap justify-between gap-2">
              <span>How this was computed · read-only SQL</span>
              <span>
                Ran on {formatCount(result.rowsScanned)} rows · {formatSeconds(result.ms)}
              </span>
            </span>
          }
        />
      )}

      <div className="flex flex-wrap gap-2">
        <StatusBadge status="ready">Read-only query</StatusBadge>
        {result.notes.map((note) => (
          <StatusBadge key={note} status="review" className="whitespace-normal!">
            {note}
          </StatusBadge>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <a href={`/api/ask/messages/${message.id}/csv`} download className={linkButtonClass("secondary", "sm")}>
          Download result CSV
        </a>
      </div>
    </div>
  );
}

function cellText(cell: string | number | boolean | null): ReactNode {
  if (cell === null) return "—";
  if (typeof cell === "number") return cell.toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (typeof cell === "boolean") return cell ? "true" : "false";
  return cell;
}


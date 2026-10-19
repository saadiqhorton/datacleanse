import type { ReactNode } from "react";
import { CodeBlock, Kw } from "@/components/ui";

/** SQL words coloured as keywords. Aggregates and functions are included, as in the design. */
const KEYWORDS = new Set(
  (
    "SELECT FROM WHERE JOIN LEFT RIGHT FULL OUTER INNER CROSS ON USING AS AND OR NOT IN IS NULL DISTINCT " +
    "GROUP BY ORDER HAVING LIMIT OFFSET UNION ALL WITH CASE WHEN THEN ELSE END BETWEEN LIKE ILIKE DESC ASC " +
    "EXISTS CAST COUNT SUM AVG MIN MAX COALESCE ROUND"
  ).split(" "),
);

/** Splits one line into text, keyword, string and comment pieces. Literals are not split on keywords. */
function highlightLine(line: string, keyPrefix: string): ReactNode[] {
  const pieces = line.split(/('(?:[^']|'')*'|--.*$|\b[A-Za-z_][A-Za-z0-9_]*\b)/);
  return pieces.map((piece, i) => {
    if (piece === "") return null;
    if (i % 2 === 0) return <span key={`${keyPrefix}-${i}`}>{piece}</span>;
    if (piece.startsWith("'")) {
      return (
        <span key={`${keyPrefix}-${i}`} className="text-mint">
          {piece}
        </span>
      );
    }
    if (piece.startsWith("--")) {
      return (
        <span key={`${keyPrefix}-${i}`} className="text-white/50">
          {piece}
        </span>
      );
    }
    return KEYWORDS.has(piece.toUpperCase()) ? (
      <Kw key={`${keyPrefix}-${i}`}>{piece}</Kw>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{piece}</span>
    );
  });
}

/** The query behind an answer, with keywords coloured. */
export function SqlBlock({ sql, caption }: { sql: string; caption: ReactNode }) {
  const lines = sql.split("\n");
  return (
    <CodeBlock caption={caption}>
      {lines.map((line, i) => (
        <span key={i} className="block">
          {highlightLine(line, `l${i}`)}
        </span>
      ))}
    </CodeBlock>
  );
}

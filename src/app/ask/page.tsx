import type { Metadata } from "next";
import Link from "next/link";
import { AccountButton, AppHeader } from "@/components/layout";
import {
  Button,
  Card,
  CodeBlock,
  Eyebrow,
  InfoPanel,
  Kw,
  Mono,
  StatusBadge,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Ask · DataCleanse",
};

const files = [
  { name: "orders_2026.csv", detail: "48,211 rows · 9 cols · alias", alias: "orders" },
  { name: "crm_export_q3.csv", detail: "4,775 rows · 11 cols · cleaned ·", alias: "customers" },
  { name: "refunds_q3.csv", detail: "1,904 rows · 5 cols · alias", alias: "refunds" },
];

const topCustomers = [
  { customer: "Northwind Traders", refunded: "$18,420", orders: "312", rate: "22.4%" },
  { customer: "Acme Corp", refunded: "$11,960", orders: "508", rate: "9.1%" },
  { customer: "Globex", refunded: "$9,305", orders: "97", rate: "31.0%" },
];

export default function AskPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader active="Ask" actions={<AccountButton />} />

      <h1 className="sr-only">Ask your data</h1>

      <div className="mx-auto flex w-full max-w-[1344px] flex-col md:min-h-[calc(100dvh-65px)] md:flex-row">
        <aside
          aria-label="Files in this conversation"
          className="flex flex-col gap-4 border-b border-divider px-4 py-8 md:w-[313px] md:shrink-0 md:border-r md:border-b-0"
        >
          <Eyebrow className="px-2">Files in this chat · {files.length}</Eyebrow>

          <ul className="flex flex-col gap-2">
            {files.map((file) => (
              <li
                key={file.name}
                className="flex flex-col gap-1 rounded-lg border border-hairline p-3"
              >
                <Mono className="font-medium">{file.name}</Mono>
                <span className="text-xs text-slate">
                  {file.detail}{" "}
                  <span className="font-mono">{file.alias}</span>
                </span>
              </li>
            ))}
          </ul>

          <Link
            href="/upload"
            className="inline-flex min-h-9 items-center rounded-lg px-3 py-2 text-sm font-medium text-ink no-underline hover:bg-surface"
          >
            + Add file
          </Link>

          <InfoPanel className="flex flex-col gap-2 p-4 text-[13px] leading-normal text-slate">
            <div className="font-semibold text-ink">How answers work</div>
            AI writes a read-only query. We run it on every row of your files, so the numbers
            come from the query, not the AI. AI only sees column names, types and summary
            statistics.
          </InfoPanel>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-8">
          <div className="max-w-[592px] self-end rounded-xl bg-surface px-4 py-3 text-base leading-normal">
            Which customers had the most refunded revenue in Q3, and what share of their orders
            was refunded?
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-review-border bg-review-bg px-5 py-4">
            <div className="text-sm font-semibold text-review">Confirm how these files connect</div>
            <div className="text-sm leading-normal text-ink-2">
              I&apos;ll join <Mono>orders.customer_email</Mono> → <Mono>customers.email</Mono>{" "}
              (96.8% of orders match) and <Mono>refunds.order_id</Mono> →{" "}
              <Mono>orders.id</Mono> (100% match).
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm">
                Use these joins
              </Button>
              <Button variant="secondary" size="sm">
                Change
              </Button>
            </div>
          </div>

          <div className="flex max-w-[820px] flex-col gap-4">
            <div className="text-base leading-normal">
              Northwind Traders had the most refunded revenue in Q3, at{" "}
              <span className="font-semibold">$18,420</span>, which is 22.4% of their orders. Top
              3:
            </div>

            <Card className="overflow-x-auto">
              <table className="w-full text-sm leading-normal">
                <thead>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.5px] text-slate">
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Customer
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                      Refunded
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                      Orders
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                      Refund rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomers.map((row) => (
                    <tr key={row.customer} className="border-t border-divider">
                      <td className="px-4 py-2.5 text-sm">{row.customer}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-[13px]">{row.refunded}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-[13px]">{row.orders}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-[13px]">{row.rate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <CodeBlock
              caption={
                <span className="flex flex-wrap justify-between gap-2">
                  <span>How this was computed · read-only SQL</span>
                  <span>Ran on 54,890 rows · 0.4 s</span>
                </span>
              }
            >
              <span className="block">
                <Kw>SELECT</Kw> c.company, <Kw>SUM</Kw>(r.amount) <Kw>AS</Kw> refunded,{" "}
                <Kw>COUNT</Kw>(<Kw>DISTINCT</Kw> o.id) <Kw>AS</Kw> orders
              </span>
              <span className="block">
                <Kw>FROM</Kw> orders o
              </span>
              <span className="block">
                <Kw>JOIN</Kw> customers c <Kw>ON</Kw> o.customer_email = c.email
              </span>
              <span className="block">
                <Kw>LEFT JOIN</Kw> refunds r <Kw>ON</Kw> r.order_id = o.id
              </span>
              <span className="block">
                <Kw>WHERE</Kw> o.order_date <Kw>BETWEEN</Kw>{" "}
                <span className="text-mint">&apos;2026-07-01&apos;</span> <Kw>AND</Kw>{" "}
                <span className="text-mint">&apos;2026-09-30&apos;</span>
              </span>
              <span className="block">
                <Kw>GROUP BY</Kw> c.company <Kw>ORDER BY</Kw> refunded <Kw>DESC LIMIT</Kw> 3
              </span>
            </CodeBlock>

            <div className="flex flex-wrap gap-2">
              <StatusBadge status="ready">Checked: totals match source files</StatusBadge>
              <StatusBadge status="review" className="whitespace-normal!">
                1,543 orders had no matching customer and were left out
              </StatusBadge>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm">
                Download result CSV
              </Button>
              <Button variant="secondary" size="sm">
                Show unmatched orders
              </Button>
            </div>
          </div>

          <div
            role="group"
            aria-label="Ask a question"
            className="mt-auto flex items-center gap-2 rounded-full border border-hairline py-1.5 pl-5 pr-1.5 focus-within:border-mint"
          >
            <input
              aria-label="Ask a question about your files"
              placeholder="Ask about orders, customers or refunds…"
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            />
            <Button variant="primary" size="md">
              Ask
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
}

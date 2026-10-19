"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button, Card, CodeBlock, Kw } from "@/components/ui";
import type { RuleDraft } from "@/lib/ai";
import type { DraftPreview } from "@/server/rules/draft";
import { describeRule } from "@/server/rules/params";
import { draftRuleAction, saveRuleAction, type DraftResult } from "../actions";
import { Notice, type NoticeState } from "./Notice";

type Draft = Extract<DraftResult, { ok: true }>;

function previewText(preview: DraftPreview): string {
  switch (preview.kind) {
    case "matches":
      return `Preview: ${preview.matches} ${preview.matches === 1 ? "match" : "matches"}`;
    case "no_file":
      return "Upload a file to preview matches";
    case "unavailable":
      return `Preview unavailable: ${preview.reason}`;
  }
}

/** "Describe a rule in plain English": drafts a rule, previews it, and saves it only when asked. */
export function NaturalRule({ setId }: { setId: string }) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [drafting, startDrafting] = useTransition();
  const [saving, startSaving] = useTransition();

  function turnIntoRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("description", text);
    startDrafting(async () => {
      const result = await draftRuleAction(formData);
      if (result.ok) {
        setDraft(result);
        setNotice(null);
      } else {
        setDraft(null);
        setNotice({ tone: "info", text: result.error });
      }
    });
  }

  function save(rule: RuleDraft) {
    const formData = new FormData();
    formData.set("setId", setId);
    formData.set("columnPattern", rule.columnPattern);
    formData.set("action", rule.action);
    formData.set("onLowConfidence", rule.onLowConfidence);
    formData.set("description", rule.description);
    formData.set("params", JSON.stringify(rule.params));
    startSaving(async () => {
      const result = await saveRuleAction(formData);
      if (result.ok) {
        setDraft(null);
        setText("");
        setNotice({ tone: "ok", text: "Rule added to this set." });
      } else {
        setNotice({ tone: "error", text: result.error });
      }
    });
  }

  const lines = draft ? describeRule(draft.draft) : null;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <form onSubmit={turnIntoRule} className="flex flex-col gap-3">
        <label htmlFor="nl-rule" className="text-sm font-medium">
          Describe a rule in plain English
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="nl-rule"
            name="nl-rule"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            placeholder="e.g. Country should always be the full English name"
            className="h-11 min-w-0 flex-1 basis-60 rounded-lg border-2 border-mint px-4 text-sm outline-none"
          />
          <Button type="submit" variant="primary" size="lg" className="w-full md:w-auto" disabled={drafting || text.trim() === ""}>
            {drafting ? "Drafting…" : "Turn into rule"}
          </Button>
        </div>
      </form>

      <Notice state={notice} />

      {draft && lines && (
        <div className="flex flex-col gap-3">
          <CodeBlock
            className="[&_pre]:whitespace-pre-wrap"
            caption={
              <span className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                <span>Draft rule · check before saving</span>
                <span>{previewText(draft.preview)}</span>
              </span>
            }
          >
            <span className="block">
              {"when column matches  "}
              <span className="text-mint">&quot;{lines.column}&quot;</span>
            </span>
            <span className="block">{lines.does}</span>
            {lines.typos && (
              <span className="block">
                {"fix typos within    "}
                <span className="text-[#F5B97A]">{lines.typos}</span>
              </span>
            )}
            <span className="block">
              {"on low confidence   "}
              <Kw>{lines.lowConfidence}</Kw>
            </span>
          </CodeBlock>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="md" disabled={saving} onClick={() => save(draft.draft)}>
              Save rule
            </Button>
            <Button variant="secondary" size="md" onClick={() => setDraft(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

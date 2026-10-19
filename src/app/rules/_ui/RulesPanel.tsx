"use client";

import { useState, useTransition } from "react";
import { Button, Eyebrow, Mono } from "@/components/ui";
import { ACTION_LABELS, ruleSummary, type RuleView } from "@/server/rules/params";
import { deleteRuleAction, moveRuleAction, toggleRuleAction } from "../actions";
import { Notice, type NoticeState } from "./Notice";
import { RuleEditor } from "./RuleEditor";

/** The rules in one set, in run order, with the editor for adding and editing them. */
export function RulesPanel({ setId, rules }: { setId: string; rules: RuleView[] }) {
  const [editing, setEditing] = useState<RuleView | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [pending, startTransition] = useTransition();

  function run(build: () => FormData, action: (fd: FormData) => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) {
    const formData = build();
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) setNotice({ tone: "error", text: result.error });
      else setNotice(null);
    });
  }

  function ruleForm(rule: RuleView, extra: Record<string, string> = {}): () => FormData {
    return () => {
      const formData = new FormData();
      formData.set("ruleId", rule.id);
      for (const [k, v] of Object.entries(extra)) formData.set(k, v);
      return formData;
    };
  }

  function remove(rule: RuleView) {
    if (!window.confirm(`Delete the rule for "${rule.columnPattern}"?`)) return;
    run(ruleForm(rule), deleteRuleAction);
    if (editing?.id === rule.id) setEditing(null);
  }

  return (
    <>
      <section aria-label="Rules in this set" className="flex flex-col">
        <Eyebrow className="pb-2">Active rules · {rules.length}</Eyebrow>
        {rules.length === 0 && (
          <p className="border-t border-divider py-4 text-sm text-slate">
            No rules yet. Describe one above, or add one by hand below.
          </p>
        )}
        {rules.map((rule, i) => {
          const text = rule.description || ruleSummary(rule.action, rule.params);
          const last = i === rules.length - 1;
          return (
            <div
              key={rule.id}
              className={
                "flex flex-wrap items-center gap-3 border-t border-divider py-4" + (last ? " border-b" : "")
              }
            >
              <Mono chip>{rule.columnPattern}</Mono>
              <span className="min-w-0 flex-1 text-sm">
                {text}
                <span className="block text-[13px] text-slate">{ACTION_LABELS[rule.action]}</span>
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending || i === 0}
                  aria-label={`Move ${rule.columnPattern} rule up`}
                  onClick={() => run(ruleForm(rule, { direction: "up" }), moveRuleAction)}
                >
                  Up
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending || last}
                  aria-label={`Move ${rule.columnPattern} rule down`}
                  onClick={() => run(ruleForm(rule, { direction: "down" }), moveRuleAction)}
                >
                  Down
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${rule.columnPattern} rule`}
                  onClick={() => {
                    setEditing(rule);
                    document.getElementById("rule-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  aria-label={`Delete ${rule.columnPattern} rule`}
                  onClick={() => remove(rule)}
                >
                  Delete
                </Button>
              </div>
              <label className="flex min-h-9 items-center gap-1.5 text-[13px] md:min-h-0">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  disabled={pending}
                  aria-label={`Enable ${rule.columnPattern} rule`}
                  onChange={(e) =>
                    run(ruleForm(rule, { enabled: String(e.target.checked) }), toggleRuleAction)
                  }
                />
                {rule.enabled ? "On" : "Off"}
              </label>
            </div>
          );
        })}
        <div className="pt-3">
          <Notice state={notice} />
        </div>
      </section>

      <div id="rule-editor" className="scroll-mt-6">
        <RuleEditor
          key={editing?.id ?? "new"}
          setId={setId}
          rule={editing}
          onDone={() => setEditing(null)}
        />
      </div>
    </>
  );
}

/**
 * "Describe a rule in plain English": drafts a rule with the person's AI provider and previews it on
 * their newest file. Nothing is saved here; the Rules screen saves a draft through the normal rule actions.
 */

import path from "node:path";
import { CsvError, readCsvFile } from "../csv";
import { previewRule } from "../cleaning";
import { env } from "../env";
import { getProviderForUser } from "../ai";
import { AIError, draftRule, type RuleDraft } from "../../lib/ai";
import type { RuleSpec } from "../types";
import { latestProfiledFile, type ProfiledFile } from "./repo";

export type DraftPreview =
  | { kind: "matches"; matches: number; fileName: string }
  | { kind: "no_file" }
  | { kind: "unavailable"; fileName: string; reason: string };

export type DraftOutcome =
  | { ok: true; draft: RuleDraft; preview: DraftPreview }
  | { ok: false; error: string };

/** Counts the cells a draft would change in one file. Reads the original CSV, never the cleaned copy. */
export async function previewOnFile(file: Pick<ProfiledFile, "name" | "storagePath"> | null, spec: RuleSpec): Promise<DraftPreview> {
  if (file === null) return { kind: "no_file" };
  const absolute = path.join(env.dataDir, file.storagePath);
  if (!absolute.startsWith(env.dataDir + path.sep)) {
    return { kind: "unavailable", fileName: file.name, reason: "The file could not be found." };
  }
  try {
    const { table } = await readCsvFile(absolute);
    const { matches } = previewRule(table, spec, 0);
    return { kind: "matches", matches, fileName: file.name };
  } catch (err) {
    const reason = err instanceof CsvError ? err.message : "The file could not be read.";
    return { kind: "unavailable", fileName: file.name, reason };
  }
}

function aiMessage(err: unknown): string {
  if (err instanceof AIError) {
    switch (err.code) {
      case "unreachable":
        return "The AI provider can't be reached right now. Add the rule manually below.";
      case "auth":
        return "The AI provider rejected its key. Check AI settings, or add the rule manually below.";
      case "rate_limited":
        return "The AI provider is busy. Try again in a minute, or add the rule manually below.";
      case "refused":
      case "invalid_output":
        return "The AI couldn't turn that into a rule. Try rewording it, or add the rule manually below.";
      default:
        break;
    }
  }
  console.error("[rules] draft failed", err);
  return "The AI couldn't draft that rule. Add it manually below.";
}

/**
 * Drafts a rule from a sentence. The draft gets the headers and top values of the newest profiled file,
 * and is previewed on that file. Never throws for an AI problem: it returns a message to show inline.
 */
export async function draftRuleForUser(userId: string, description: string): Promise<DraftOutcome> {
  const resolved = getProviderForUser(userId);
  if (resolved.provider === null) {
    if (resolved.source === "off") return { ok: false, error: "AI is off. Add the rule manually below." };
    return { ok: false, error: `AI is unavailable (${resolved.label}). Add the rule manually below.` };
  }

  const file = latestProfiledFile(userId);
  let draft: RuleDraft;
  try {
    draft = await draftRule(resolved.provider, {
      description,
      headers: file ? file.headers : [],
      sampleValues: file ? file.sampleValues : {},
    });
  } catch (err) {
    return { ok: false, error: aiMessage(err) };
  }

  const spec: RuleSpec = {
    id: "draft",
    columnPattern: draft.columnPattern,
    action: draft.action,
    params: draft.params,
    onLowConfidence: draft.onLowConfidence,
    enabled: true,
    description: draft.description,
  };
  const preview = await previewOnFile(file, spec);
  return { ok: true, draft, preview };
}

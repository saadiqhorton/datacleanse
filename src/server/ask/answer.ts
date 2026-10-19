import { AIError, planQuery, summarizeAnswer, type AIProvider, type TableProfile } from "../../lib/ai";
import { describeTables, QueryRejectedError, QueryTimeoutError, runReadOnlyQuery, suggestJoins, unmatchedCount } from "../query";
import type { JoinSuggestion, QueryTable } from "../types";
import {
  ASK_MAX_ROWS,
  ASK_TIMEOUT_MS,
  AI_OFF_MESSAGE,
  FALLBACK_ANSWER,
  NO_FILES_MESSAGE,
} from "./copy";
import { AskError, MESSAGE_NOT_FOUND } from "./errors";
import { hasOuterJoin, proposedJoins, referencedAliases, samePair, sameTables, sharedNameCandidates, withJoinHint } from "./joins";
import {
  findConfirmedJoins,
  getMessageForUser,
  insertMessage,
  resolveChatTables,
  updateMessage,
  type StoredMessage,
} from "./repo";
import type { AskResult, JoinPair, JoinsState, MessageStatus } from "./types";

/**
 * Answers one question in a chat. Every outcome is written to the chat as an assistant message
 * (answer, confirmation card, AI off, blocked, failed). The error is then rethrown, so runTracked
 * can record the job as blocked or failed. Callers treat a rethrown error as already reported.
 */
export async function answerQuestion(
  userId: string,
  chatId: string,
  question: string,
  ai: AIProvider | null,
): Promise<void> {
  let messageId: string | null = null;
  try {
    const { tables } = await resolveChatTables(userId, chatId);
    if (!ai) {
      insertMessage({ chatId, role: "assistant", content: AI_OFF_MESSAGE, status: "done" });
      return;
    }
    if (tables.length === 0) {
      insertMessage({ chatId, role: "assistant", content: NO_FILES_MESSAGE, status: "failed" });
      return;
    }

    const aliases = tables.map((t) => t.alias);
    const confirmed = findConfirmedJoins(chatId, aliases);
    const profiles = await describeTables(tables);
    const plan = await planQuery(ai, confirmed ? withJoinHint(question, confirmed.joins) : question, profiles);
    const referenced = referencedAliases(plan.sql, aliases);
    const joinsNeeded = referenced.length >= 2;

    if (joinsNeeded && !confirmed) {
      const suggestions = await suggestJoins(tables);
      const rowCounts = Object.fromEntries(profiles.map((p) => [p.alias, p.rowCount]));
      const state = buildJoinsState(
        question,
        aliases,
        proposedJoins(suggestions, referenced, rowCounts),
        profiles,
        referenced,
        suggestions,
      );
      insertMessage({ chatId, role: "assistant", content: "", status: "needs_confirmation", sql: plan.sql, joins: state });
      return;
    }

    messageId = insertMessage({
      chatId,
      role: "assistant",
      content: "",
      status: "running",
      sql: plan.sql,
      joins: { question, tables: sorted(aliases), joins: joinsNeeded && confirmed ? confirmed.joins : [], candidates: [], confirmed: joinsNeeded },
    });
    await execute(userId, messageId, ai);
  } catch (err) {
    recordFailure(chatId, messageId, err);
    throw err;
  }
}

/** The user clicked "Use these joins": mark them confirmed and run the planned query. */
export async function confirmJoins(userId: string, messageId: string, ai: AIProvider | null): Promise<void> {
  const msg = requireAwaitingConfirmation(userId, messageId);
  updateMessage(messageId, { status: "running", joins: { ...msg.joins!, confirmed: true } });
  try {
    await execute(userId, messageId, ai);
  } catch (err) {
    recordFailure(msg.chatId, messageId, err);
    throw err;
  }
}

/**
 * The user picked another column pair under "Change". The question is planned again with that pair as
 * the join, so the query and the card agree. The card stays open until "Use these joins".
 */
export async function changeJoins(
  userId: string,
  messageId: string,
  candidateIndex: number,
  ai: AIProvider | null,
): Promise<void> {
  const msg = requireAwaitingConfirmation(userId, messageId);
  const state = msg.joins!;
  const chosen = Number.isInteger(candidateIndex) ? state.candidates[candidateIndex] : undefined;
  if (!chosen) throw new AskError("invalid", "Pick one of the column pairs listed.");
  if (!ai) throw new AskError("invalid", AI_OFF_MESSAGE);

  const { tables } = await resolveChatTables(userId, msg.chatId);
  if (!sameTables(state.tables, tables.map((t) => t.alias))) {
    throw new AskError("conflict", "The files in this chat changed. Ask the question again.");
  }
  try {
    const profiles = await describeTables(tables);
    const plan = await planQuery(ai, withJoinHint(state.question, [chosen]), profiles);
    updateMessage(messageId, { sql: plan.sql, joins: { ...state, joins: [chosen], confirmed: false } });
  } catch (err) {
    if (err instanceof AIError) throw new AskError("invalid", aiErrorText(err));
    throw err;
  }
}

/**
 * Runs the message's planned query, adds the unmatched-row notes, and writes the answer. Throws on
 * failure; the callers record it with recordFailure.
 */
async function execute(userId: string, messageId: string, ai: AIProvider | null): Promise<void> {
  const msg = getMessageForUser(userId, messageId);
  if (!msg || !msg.sql) throw new AskError("not_found", MESSAGE_NOT_FOUND);
  const { tables } = await resolveChatTables(userId, msg.chatId);
  if (tables.length === 0) throw new AskError("conflict", NO_FILES_MESSAGE);

  const sql = msg.sql;
  const question = msg.joins?.question ?? "";
  const result = await runReadOnlyQuery({ tables, sql, timeoutMs: ASK_TIMEOUT_MS, maxRows: ASK_MAX_ROWS });
  const notes = await joinNotes(tables, sql, msg.joins?.confirmed ? msg.joins.joins : [], referencedAliases(sql, tables.map((t) => t.alias)));
  const answer = await answerText(ai, question, sql, result);
  const stored: AskResult = { ...result, notes };
  updateMessage(messageId, { content: answer, status: "done", result: stored });
}

/** Notes for confirmed joins: how many rows of the left file found no match. Only counted when both files are in the query. */
async function joinNotes(tables: QueryTable[], sql: string, joins: JoinPair[], referenced: string[]): Promise<string[]> {
  const notes: string[] = [];
  const outer = hasOuterJoin(sql);
  for (const join of joins.slice(0, 3)) {
    if (!referenced.includes(join.left.alias) || !referenced.includes(join.right.alias)) continue;
    const suggestion: JoinSuggestion = { left: join.left, right: join.right, matchRate: join.matchRate ?? 0 };
    const n = await unmatchedCount(tables, suggestion);
    if (n === 0) continue;
    const rows = n === 1 ? "row" : "rows";
    notes.push(
      `${n.toLocaleString("en-US")} ${rows} from ${join.left.alias} had no matching row in ${join.right.alias}` +
        (outer ? " and are still in the result." : " and were left out."),
    );
  }
  return notes;
}

async function answerText(
  ai: AIProvider | null,
  question: string,
  sql: string,
  result: { columns: string[]; rows: AskResult["rows"]; rowsScanned: number },
): Promise<string> {
  if (!ai) return FALLBACK_ANSWER;
  try {
    const { answer } = await summarizeAnswer(ai, {
      question,
      sql,
      columns: result.columns,
      rows: result.rows,
      rowsScanned: result.rowsScanned,
    });
    return answer;
  } catch {
    return FALLBACK_ANSWER;
  }
}

/** Writes the failure into the chat: the message being run when there is one, else a new message. */
function recordFailure(chatId: string, messageId: string | null, err: unknown): void {
  const report = reportFor(err);
  if (messageId) updateMessage(messageId, { content: report.content, status: report.status });
  else insertMessage({ chatId, role: "assistant", content: report.content, status: report.status });
}

export function reportFor(err: unknown): { content: string; status: MessageStatus } {
  if (err instanceof QueryRejectedError) {
    return { content: `I couldn't run that query: ${err.reason}`, status: "blocked" };
  }
  if (err instanceof QueryTimeoutError) {
    return {
      content: `That query took longer than ${ASK_TIMEOUT_MS / 1000} seconds and was stopped. Try a narrower question.`,
      status: "failed",
    };
  }
  if (err instanceof AIError) return { content: aiErrorText(err), status: "failed" };
  if (err instanceof AskError) return { content: err.message, status: "failed" };
  return { content: "Something went wrong while answering. Try again.", status: "failed" };
}

export function aiErrorText(err: AIError): string {
  switch (err.code) {
    case "unreachable":
      return "The AI service could not be reached. Try again, or check the AI settings.";
    case "auth":
      return "The AI service rejected the API key. Check the AI settings.";
    case "rate_limited":
      return "The AI service is busy. Try again in a minute.";
    case "invalid_output":
      return "The AI could not write a query I can run. Try asking in different words.";
    case "refused":
      return "The AI would not answer that question. Try asking in different words.";
    default:
      return "The AI service failed. Try again.";
  }
}

function requireAwaitingConfirmation(userId: string, messageId: string): StoredMessage {
  const msg = getMessageForUser(userId, messageId);
  if (!msg) throw new AskError("not_found", MESSAGE_NOT_FOUND);
  if (msg.status !== "needs_confirmation" || !msg.joins) {
    throw new AskError("conflict", "This answer is no longer waiting for confirmation.");
  }
  return msg;
}

function buildJoinsState(
  question: string,
  aliases: string[],
  joins: JoinPair[],
  profiles: TableProfile[],
  referenced: string[],
  suggestions: JoinSuggestion[],
): JoinsState {
  const rateOf = (pair: JoinPair): number | null => {
    const found = suggestions.find((s) => samePair(pair, { left: s.left, right: s.right, matchRate: s.matchRate }));
    return found ? found.matchRate : null;
  };
  // Largest table first, so each candidate reads from the "many" side, as the proposed joins do.
  const inQuery = profiles.filter((p) => referenced.includes(p.alias)).sort((a, b) => b.rowCount - a.rowCount);
  const candidates = sharedNameCandidates(inQuery).map((c) => ({
    ...c,
    matchRate: rateOf(c),
  }));
  return { question, tables: sorted(aliases), joins, candidates, confirmed: false };
}

function sorted(values: string[]): string[] {
  return [...values].sort();
}

import { connection } from "next/server";
import { apiSession } from "@/server/files/api";
import { isValidId } from "@/server/files/storage";
import { getMessageForUser } from "@/server/ask/repo";
import { resultCsv } from "@/server/ask/csv";
import { contentDisposition } from "@/server/files/downloads";

/**
 * The result of one answer as CSV. Owner only: the message must belong to a chat the session user owns.
 * Cells are formula-guarded (see resultCsv).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const auth = await apiSession();
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const message = isValidId(id) ? getMessageForUser(auth.user.id, id) : null;
  if (!message) {
    return Response.json({ error: "Answer not found.", code: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (!message.result) {
    return Response.json({ error: "This answer has no result to download.", code: "not_ready" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  return new Response(resultCsv(message.result), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(`answer-${message.id}.csv`),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

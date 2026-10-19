import { connection } from "next/server";
import { apiSession } from "@/server/files/api";
import { CompareError } from "@/server/comparisons/errors";
import { comparisonExport } from "@/server/comparisons/export";

/** The diff of one saved comparison as a CSV attachment. Only the owner can download it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const auth = await apiSession();
  if (auth instanceof Response) return auth;

  const { id } = await params;
  try {
    const { filename, text } = comparisonExport(auth.user.id, id);
    return new Response(text, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof CompareError) {
      const status = err.code === "not_found" ? 404 : err.code === "gone" ? 410 : 400;
      return Response.json({ error: err.message, code: err.code }, { status, headers: { "Cache-Control": "no-store" } });
    }
    throw err;
  }
}

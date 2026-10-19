import { connection } from "next/server";
import { apiSession } from "@/server/files/api";
import { getJobForUser } from "@/server/files/jobs";

/** Job status for the Processing page. Only the job's owner can read it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const auth = await apiSession();
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const job = getJobForUser(auth.user.id, id);
  if (!job) return Response.json({ error: "Job not found.", code: "not_found" }, { status: 404 });
  return Response.json(job, { headers: { "Cache-Control": "no-store" } });
}

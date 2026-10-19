import { connection } from "next/server";
import { apiSession } from "@/server/files/api";
import { cancelJobForUser } from "@/server/files/jobs";

/** Cancels a queued or running job. Only the job's owner can cancel it. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const auth = await apiSession();
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const result = cancelJobForUser(auth.user.id, id);
  if (!result) return Response.json({ error: "Job not found.", code: "not_found" }, { status: 404 });
  return Response.json({ status: result.status });
}

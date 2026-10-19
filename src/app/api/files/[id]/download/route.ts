import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { connection } from "next/server";
import { apiSession } from "@/server/files/api";
import { contentDisposition, prepareDownload } from "@/server/files/downloads";

/**
 * Streams a file download. The link carries a 15-minute token bound to this file, this kind and
 * this user; the session user must match it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const auth = await apiSession();
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const url = new URL(request.url);
  const result = await prepareDownload(auth.user.id, id, url.searchParams.get("kind"), url.searchParams.get("token"));
  if (!result.ok) {
    return Response.json({ error: result.error, code: result.code }, { status: result.status, headers: { "Cache-Control": "no-store" } });
  }

  const headers = {
    "Content-Type": result.contentType,
    "Content-Disposition": contentDisposition(result.filename),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const body = result.body;
  if (body.type === "file") {
    const stream = Readable.toWeb(createReadStream(body.path)) as unknown as ReadableStream<Uint8Array>;
    return new Response(stream, { headers: { ...headers, "Content-Length": String(body.size) } });
  }
  if (body.type === "bytes") {
    return new Response(new Uint8Array(body.bytes), { headers: { ...headers, "Content-Length": String(body.bytes.byteLength) } });
  }
  return new Response(body.text, { headers });
}

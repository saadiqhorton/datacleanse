import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { env } from "../env";

export type ScanResult = { ok: true } | { ok: false; reason: string };

const CLAMD_TIMEOUT_MS = 30_000;
const CHUNK_BYTES = 64 * 1024;
const UNAVAILABLE: ScanResult = { ok: false, reason: "Malware scanner unavailable" };
const UNREADABLE: ScanResult = { ok: false, reason: "This file could not be read for scanning." };

/** Executable and archive signatures that a CSV upload should never start with. */
const BLOCKED_MAGIC: { name: string; bytes: readonly number[] }[] = [
  { name: "Windows executable", bytes: [0x4d, 0x5a] }, // MZ
  { name: "ELF executable", bytes: [0x7f, 0x45, 0x4c, 0x46] }, // \x7fELF
  { name: "Mach-O executable", bytes: [0xfe, 0xed, 0xfa, 0xce] },
  { name: "Mach-O executable", bytes: [0xfe, 0xed, 0xfa, 0xcf] },
  { name: "Mach-O executable", bytes: [0xce, 0xfa, 0xed, 0xfe] },
  { name: "Mach-O executable", bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { name: "Mach-O universal binary", bytes: [0xca, 0xfe, 0xba, 0xbe] },
  { name: "PDF document", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { name: "ZIP archive", bytes: [0x50, 0x4b, 0x03, 0x04] }, // PK\x03\x04
];
const MAGIC_PREFIX_BYTES = 8;

/**
 * Scan an uploaded file before it is parsed. Uses clamd when CLAMD_ADDRESS is set, otherwise
 * built-in checks for executable and archive magic numbers. Fails closed on scanner errors.
 */
export async function scanFile(absPath: string, opts: { timeoutMs?: number } = {}): Promise<ScanResult> {
  const address = env.clamdAddress;
  if (address) return scanWithClamd(absPath, address, opts.timeoutMs ?? CLAMD_TIMEOUT_MS);
  return builtinScan(absPath);
}

async function builtinScan(absPath: string): Promise<ScanResult> {
  let head: Buffer;
  try {
    const handle = await open(absPath, "r");
    try {
      const buf = Buffer.alloc(MAGIC_PREFIX_BYTES);
      const { bytesRead } = await handle.read(buf, 0, MAGIC_PREFIX_BYTES, 0);
      head = buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return UNREADABLE;
  }
  for (const sig of BLOCKED_MAGIC) {
    if (head.length >= sig.bytes.length && sig.bytes.every((b, i) => head[i] === b)) {
      return { ok: false, reason: `This file looks like a ${sig.name} and can't be processed.` };
    }
  }
  return { ok: true };
}

function parseAddress(address: string): { host: string; port: number } | null {
  const idx = address.lastIndexOf(":");
  if (idx < 0) return null;
  const host = address.slice(0, idx).replace(/^\[|\]$/g, "") || "127.0.0.1";
  const port = Number(address.slice(idx + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

/** clamd INSTREAM protocol: zINSTREAM\0, then (4-byte big-endian length, data)*, then a zero length. */
function scanWithClamd(absPath: string, address: string, timeoutMs: number): Promise<ScanResult> {
  const target = parseAddress(address);
  if (target === null) return Promise.resolve(UNAVAILABLE);

  return new Promise<ScanResult>((resolve) => {
    let settled = false;
    let reply = "";
    const socket: Socket = createConnection({ host: target.host, port: target.port });
    const file = createReadStream(absPath, { highWaterMark: CHUNK_BYTES });

    const finish = (result: ScanResult) => {
      if (settled) return;
      settled = true;
      file.destroy();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs, () => finish(UNAVAILABLE));
    socket.on("error", () => finish(UNAVAILABLE));
    socket.on("data", (chunk: Buffer) => {
      reply += chunk.toString("utf8");
      if (reply.includes("\0") || reply.includes("\n")) finish(interpretReply(reply));
    });
    socket.on("close", () => finish(interpretReply(reply)));

    file.on("error", () => finish(UNREADABLE));
    file.on("data", (chunk: string | Buffer) => {
      const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const framed = Buffer.allocUnsafe(4 + data.length);
      framed.writeUInt32BE(data.length, 0);
      data.copy(framed, 4);
      if (!socket.write(framed)) {
        file.pause();
        socket.once("drain", () => file.resume());
      }
    });
    file.on("end", () => {
      if (!settled) socket.write(Buffer.alloc(4)); // zero-length chunk ends the stream
    });

    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
    });
  });
}

function interpretReply(raw: string): ScanResult {
  const reply = raw.replace(/[\0\r\n]+$/g, "").trim();
  if (reply === "stream: OK") return { ok: true };
  const found = /^stream: (.+) FOUND$/.exec(reply);
  if (found) return { ok: false, reason: `Flagged by the malware scan (${found[1]}).` };
  if (/size limit/i.test(reply)) {
    return { ok: false, reason: "This file is too large for the malware scanner." };
  }
  return UNAVAILABLE;
}

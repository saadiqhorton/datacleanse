import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { scanFile } from "./index";

let dir: string;
let counter = 0;
const savedClamd = process.env.CLAMD_ADDRESS;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-scan-test-"));
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  if (savedClamd === undefined) delete process.env.CLAMD_ADDRESS;
  else process.env.CLAMD_ADDRESS = savedClamd;
});

afterEach(() => {
  delete process.env.CLAMD_ADDRESS;
});

function writeFile(bytes: Buffer | string): string {
  const file = path.join(dir, `scan${counter++}.bin`);
  fs.writeFileSync(file, bytes);
  return file;
}

interface FakeClamd {
  address: string;
  /** Bytes of the stream as the server received them, once the terminator arrived. */
  received: Promise<Buffer>;
  close: () => Promise<void>;
}

/**
 * A minimal clamd: accepts zINSTREAM, collects length-prefixed chunks until the zero-length
 * terminator, then answers `reply`. A null reply never answers (for timeout tests).
 */
function fakeClamd(reply: string | null): Promise<FakeClamd> {
  return new Promise((resolve, reject) => {
    let markReceived!: (b: Buffer) => void;
    const received = new Promise<Buffer>((r) => (markReceived = r));
    const sockets = new Set<net.Socket>();
    const server = net.createServer((sock) => {
      sockets.add(sock);
      sock.on("close", () => sockets.delete(sock));
      sock.on("error", () => undefined);
      let buf = Buffer.alloc(0);
      let greeted = false;
      let done = false;
      const chunks: Buffer[] = [];
      sock.on("data", (d: Buffer) => {
        if (done) return;
        buf = Buffer.concat([buf, d]);
        if (!greeted) {
          if (buf.length < 10) return;
          if (buf.subarray(0, 10).toString("latin1") !== "zINSTREAM\0") {
            sock.destroy();
            return;
          }
          buf = buf.subarray(10);
          greeted = true;
        }
        while (buf.length >= 4) {
          const len = buf.readUInt32BE(0);
          if (len === 0) {
            done = true;
            markReceived(Buffer.concat(chunks));
            if (reply !== null) sock.end(reply);
            return;
          }
          if (buf.length < 4 + len) return;
          chunks.push(Buffer.from(buf.subarray(4, 4 + len)));
          buf = buf.subarray(4 + len);
        }
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        address: `127.0.0.1:${addr.port}`,
        received,
        close: () =>
          new Promise<void>((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

describe("built-in scan", () => {
  test("a CSV is clean", async () => {
    const file = writeFile("name,email\nAna,ana@x.co\n");
    assert.deepEqual(await scanFile(file), { ok: true });
  });

  test("a header that starts with letters is clean", async () => {
    const file = writeFile("%%%,a\n1,2\n");
    assert.deepEqual(await scanFile(file), { ok: true });
  });

  const blocked: [string, Buffer][] = [
    ["Windows executable (MZ)", Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0, 0, 0, 0])],
    ["ELF executable", Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])],
    ["PDF document", Buffer.from("%PDF-1.7\n%....")],
    ["ZIP archive", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])],
    ["Mach-O executable", Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0, 0, 0])],
  ];
  for (const [label, bytes] of blocked) {
    test(`${label} is rejected`, async () => {
      const result = await scanFile(writeFile(bytes));
      assert.equal(result.ok, false);
      if (!result.ok) assert.ok(result.reason.includes("can't be processed"), result.reason);
    });
  }

  test("a missing file fails closed", async () => {
    const result = await scanFile(path.join(dir, "does-not-exist.csv"));
    assert.equal(result.ok, false);
  });
});

describe("clamd scan", () => {
  test("stream: OK is clean and the full file is sent in INSTREAM framing", async () => {
    const content = Buffer.alloc(200 * 1024);
    for (let i = 0; i < content.length; i++) content[i] = (i * 31) % 251;
    const file = writeFile(content);
    const clamd = await fakeClamd("stream: OK\0");
    try {
      process.env.CLAMD_ADDRESS = clamd.address;
      const result = await scanFile(file);
      assert.deepEqual(result, { ok: true });
      assert.ok((await clamd.received).equals(content));
    } finally {
      await clamd.close();
    }
  });

  test("stream: Eicar-Signature FOUND is rejected", async () => {
    const file = writeFile("name,email\nAna,ana@x.co\n");
    const clamd = await fakeClamd("stream: Eicar-Signature FOUND\0");
    try {
      process.env.CLAMD_ADDRESS = clamd.address;
      const result = await scanFile(file);
      assert.equal(result.ok, false);
      if (!result.ok) assert.ok(result.reason.includes("Eicar-Signature"), result.reason);
    } finally {
      await clamd.close();
    }
  });

  test("a size-limit reply is rejected with a clear reason", async () => {
    const file = writeFile("a\n1\n");
    const clamd = await fakeClamd("INSTREAM size limit exceeded. ERROR\0");
    try {
      process.env.CLAMD_ADDRESS = clamd.address;
      const result = await scanFile(file);
      assert.equal(result.ok, false);
      if (!result.ok) assert.ok(result.reason.includes("too large"), result.reason);
    } finally {
      await clamd.close();
    }
  });

  test("an unexpected reply fails closed as unavailable", async () => {
    const file = writeFile("a\n1\n");
    const clamd = await fakeClamd("something else\0");
    try {
      process.env.CLAMD_ADDRESS = clamd.address;
      assert.deepEqual(await scanFile(file), { ok: false, reason: "Malware scanner unavailable" });
    } finally {
      await clamd.close();
    }
  });

  test("connection refused is reported as unavailable", async () => {
    const probe = net.createServer();
    const port = await new Promise<number>((resolve) =>
      probe.listen(0, "127.0.0.1", () => resolve((probe.address() as net.AddressInfo).port)),
    );
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    process.env.CLAMD_ADDRESS = `127.0.0.1:${port}`;
    const result = await scanFile(writeFile("a\n1\n"));
    assert.deepEqual(result, { ok: false, reason: "Malware scanner unavailable" });
  });

  test("a scanner that never answers times out as unavailable", async () => {
    const clamd = await fakeClamd(null);
    try {
      process.env.CLAMD_ADDRESS = clamd.address;
      const started = Date.now();
      const result = await scanFile(writeFile("a\n1\n"), { timeoutMs: 300 });
      assert.deepEqual(result, { ok: false, reason: "Malware scanner unavailable" });
      assert.ok(Date.now() - started < 5000);
    } finally {
      await clamd.close();
    }
  });

  test("an unparsable CLAMD_ADDRESS fails closed", async () => {
    process.env.CLAMD_ADDRESS = "not-an-address";
    assert.deepEqual(await scanFile(writeFile("a\n1\n")), { ok: false, reason: "Malware scanner unavailable" });
  });

  test("clamd is used instead of the built-in checks when configured", async () => {
    // An MZ file would be rejected by the built-in check; with clamd configured, clamd decides.
    const clamd = await fakeClamd("stream: OK\0");
    try {
      process.env.CLAMD_ADDRESS = clamd.address;
      assert.deepEqual(await scanFile(writeFile(Buffer.from([0x4d, 0x5a, 0, 0]))), { ok: true });
    } finally {
      await clamd.close();
    }
  });
});

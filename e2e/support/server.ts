import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AppServer {
  url: string;
  dataDir: string;
  /** Everything the server printed so far (dev emails with magic links land here). */
  log(): string;
  stop(): Promise<void>;
}

/** Start `next start` on a free-ish port with a fresh DATA_DIR. Requires a prior `next build`. */
export async function startServer(env: Record<string, string> = {}): Promise<AppServer> {
  const port = 3200 + Math.floor(Math.random() * 700);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-e2e-"));
  let output = "";
  const child: ChildProcess = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env, NODE_ENV: "production", DATA_DIR: dataDir, APP_URL: `http://localhost:${port}`, AI_PROVIDER: "off", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => (output += d));
  child.stderr!.on("data", (d) => (output += d));
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${url}/signin`);
      if (res.ok) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
    if (i === 119) throw new Error(`server did not start:\n${output}`);
  }
  return {
    url,
    dataDir,
    log: () => output,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

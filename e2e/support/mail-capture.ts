import net from "node:net";
import type { AddressInfo } from "node:net";

/**
 * A minimal SMTP server that keeps every message it receives. Point the app at it with
 * SMTP_URL=mail.url, and the app sends mail exactly as it would to a real relay.
 * Plain SMTP only (no STARTTLS, no AUTH), which nodemailer accepts for a local URL.
 */
export interface CapturedMail {
  /** Envelope recipient (RCPT TO). */
  to: string;
  /** Raw message as sent after DATA, with dot-stuffing removed. */
  data: string;
}

export interface MailCapture {
  url: string;
  messages(): CapturedMail[];
  stop(): Promise<void>;
}

export async function startMailCapture(): Promise<MailCapture> {
  const messages: CapturedMail[] = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    socket.setEncoding("utf8");
    socket.write("220 localhost ESMTP capture\r\n");

    let buffer = "";
    let recipients: string[] = [];
    let inData = false;
    let data = "";

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);

        if (inData) {
          if (line === ".") {
            messages.push({ to: recipients.join(", "), data });
            recipients = [];
            data = "";
            inData = false;
            socket.write("250 queued\r\n");
          } else {
            data += (line.startsWith("..") ? line.slice(1) : line) + "\n";
          }
          continue;
        }

        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO" || verb === "HELO") {
          socket.write("250 localhost\r\n");
        } else if (verb === "MAIL") {
          recipients = [];
          socket.write("250 sender ok\r\n");
        } else if (verb === "RCPT") {
          const match = line.match(/<([^>]*)>/);
          recipients.push(match ? match[1] : line.slice(8));
          socket.write("250 recipient ok\r\n");
        } else if (verb === "DATA") {
          inData = true;
          socket.write("354 end with <CRLF>.<CRLF>\r\n");
        } else if (verb === "QUIT") {
          socket.end("221 bye\r\n");
        } else {
          // RSET, NOOP and anything else the client sends.
          socket.write("250 ok\r\n");
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `smtp://127.0.0.1:${port}`,
    messages: () => [...messages],
    stop: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Decodes quoted-printable text, which mailers use for long lines (for example a sign-in link). */
export function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * The readable body of a captured message: headers are dropped and the body is decoded from base64 or
 * quoted-printable, whichever the sender used. Plain bodies come back unchanged.
 */
export function messageBody(raw: string): string {
  const split = raw.indexOf("\n\n");
  const headers = split === -1 ? "" : raw.slice(0, split);
  const body = split === -1 ? raw : raw.slice(split + 2);
  if (/^content-transfer-encoding:\s*base64/im.test(headers)) {
    return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  }
  if (/^content-transfer-encoding:\s*quoted-printable/im.test(headers)) {
    return decodeQuotedPrintable(body);
  }
  return body;
}

import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface SentEmail extends EmailMessage {
  sentAt: number;
}

const MAX_KEPT = 50;
const sent: SentEmail[] = [];

let transporter: Transporter | null = null;

function getTransporter(url: string): Transporter {
  if (!transporter) transporter = nodemailer.createTransport(url);
  return transporter;
}

/**
 * Sends mail through SMTP_URL. Without SMTP_URL, outside production, the message is written to the
 * server log instead, so dev sign-in links can be copied from the console. In production without
 * SMTP_URL, sending fails: live sign-in links must never end up in logs.
 */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (env.smtpUrl) {
    await getTransporter(env.smtpUrl).sendMail({
      from: env.mailFrom,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
    });
  } else {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP_URL is not set; cannot send email in production.");
    }
    console.log(`[email] to=${msg.to} subject=${msg.subject}\n${msg.text}`);
  }
  sent.push({ ...msg, sentAt: Date.now() });
  if (sent.length > MAX_KEPT) sent.splice(0, sent.length - MAX_KEPT);
}

/** Most recent messages (newest last), for tests. Holds up to 50. */
export function getSentEmailsForTests(): SentEmail[] {
  return [...sent];
}

import fs from "node:fs/promises";
import path from "node:path";
import { audit } from "../audit";
import { db } from "../db";
import { env } from "../env";
import { getUserById, normalizeEmail } from "../auth/users";
import { SettingsError } from "./errors";

const USER_ID_RE = /^usr_[a-z0-9]{1,40}$/;

/** DATA_DIR/files/<userId>. The id is validated first, so no user input reaches the path. */
export function userFilesDir(userId: string): string {
  if (!USER_ID_RE.test(userId)) throw new SettingsError("Account not found.");
  const root = path.resolve(env.dataDir, "files");
  const target = path.resolve(root, userId);
  if (path.dirname(target) !== root) throw new SettingsError("Account not found.");
  return target;
}

/**
 * Deletes an account and everything it owns: the files directory on disk, then the Better Auth rows
 * (sessions, credential account, reset tokens, user), then the app's user row. Rows that reference the
 * user cascade (settings, files, changes, rule sets, rules, jobs, chats, compares). Audit entries are kept
 * with the actor cleared, as the schema intends.
 *
 * The caller must confirm by passing the account's email. The last enabled admin cannot be deleted.
 */
export async function deleteAccount(userId: string, confirmEmail: string): Promise<void> {
  const user = getUserById(userId);
  if (!user) throw new SettingsError("Account not found.");
  if (normalizeEmail(confirmEmail) !== user.email) {
    throw new SettingsError("The email doesn't match your account.");
  }

  if (user.role === "admin") {
    const { n } = db()
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?")
      .get(userId) as { n: number };
    if (n === 0) {
      throw new SettingsError(
        "You are the last admin. Make another account an admin before deleting this one.",
      );
    }
  }

  await fs.rm(userFilesDir(userId), { recursive: true, force: true });

  const conn = db();
  conn.transaction(() => {
    conn.prepare("DELETE FROM auth_session WHERE userId = ?").run(userId);
    conn.prepare("DELETE FROM auth_account WHERE userId = ?").run(userId);
    // Password reset links carry the user id as their value.
    conn
      .prepare("DELETE FROM auth_verification WHERE identifier LIKE 'reset-password:%' AND value = ?")
      .run(userId);
    conn.prepare("DELETE FROM auth_user WHERE id = ?").run(userId);
    conn.prepare("DELETE FROM users WHERE id = ?").run(userId);
  })();

  audit("account.deleted", "Account and all of its files deleted.", { actor: null });
}

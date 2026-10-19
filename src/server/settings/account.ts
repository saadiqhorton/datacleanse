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
 * Deletes an account and everything it owns: the files directory on disk, then the user row. Rows that
 * reference the user cascade (sessions, settings, files, changes, rule sets, rules, jobs, chats, compares).
 * Audit entries are kept with the actor cleared, as the schema intends. Login tokens are removed by email.
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

  db().transaction(() => {
    db().prepare("DELETE FROM login_tokens WHERE email = ?").run(user.email);
    db().prepare("DELETE FROM users WHERE id = ?").run(userId);
  })();

  audit("account.deleted", "Account and all of its files deleted.", { actor: null });
}

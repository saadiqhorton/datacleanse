import { z } from "zod";
import { audit } from "../audit";
import { db } from "../db";
import { findUserByEmail, getUserById, normalizeEmail, type UserRecord } from "../auth/users";
import { SettingsError, firstIssue, isUniqueViolation } from "./errors";

export const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(100, "Name must be 100 characters or fewer."),
  email: z.string().trim().min(1, "Enter a valid email address.").max(254, "Enter a valid email address."),
});

export type ProfileInput = z.input<typeof profileSchema>;

/** Name and email as shown on the profile form. */
export function getProfile(userId: string): UserRecord {
  const user = getUserById(userId);
  if (!user) throw new SettingsError("Account not found.");
  return user;
}

/**
 * Updates the app's name and email. An email change is also written to Better Auth's auth_user row in the
 * same transaction, so both tables always agree. The email must be unique across both tables.
 * The name in auth_user is updated by the caller through auth.api.updateUser.
 */
export function updateProfile(userId: string, raw: ProfileInput): UserRecord {
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) throw new SettingsError(firstIssue(parsed.error));

  const email = normalizeEmail(parsed.data.email);
  if (!email) throw new SettingsError("Enter a valid email address.");

  const conn = db();
  const current = getProfile(userId);
  const emailChanged = email !== current.email;

  if (emailChanged) {
    const takenHere = findUserByEmail(email);
    const takenInAuth = conn.prepare("SELECT id FROM auth_user WHERE email = ?").get(email) as { id: string } | undefined;
    if ((takenHere && takenHere.id !== userId) || (takenInAuth && takenInAuth.id !== userId)) {
      throw new SettingsError("An account with this email already exists.");
    }
  }

  try {
    conn.transaction(() => {
      conn.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").run(parsed.data.name, email, userId);
      if (emailChanged) {
        conn
          .prepare("UPDATE auth_user SET email = ?, updatedAt = ? WHERE id = ?")
          .run(email, new Date().toISOString(), userId);
      }
    })();
  } catch (err) {
    if (isUniqueViolation(err, "users.email") || isUniqueViolation(err, "auth_user.email")) {
      throw new SettingsError("An account with this email already exists.");
    }
    throw err;
  }

  audit(
    "settings.updated",
    emailChanged ? "Profile updated. Email address changed." : "Profile updated.",
    { actor: userId },
  );
  return getProfile(userId);
}

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
 * Updates name and email. The email is normalized (trimmed, lowercased) and must be unique across
 * accounts. Throws SettingsError with a message that is safe to show.
 */
export function updateProfile(userId: string, raw: ProfileInput): UserRecord {
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) throw new SettingsError(firstIssue(parsed.error));

  const email = normalizeEmail(parsed.data.email);
  if (!email) throw new SettingsError("Enter a valid email address.");

  const current = getProfile(userId);
  const taken = findUserByEmail(email);
  if (taken && taken.id !== userId) throw new SettingsError("An account with this email already exists.");

  const emailChanged = email !== current.email;
  try {
    db().prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").run(parsed.data.name, email, userId);
  } catch (err) {
    if (isUniqueViolation(err, "users.email")) {
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

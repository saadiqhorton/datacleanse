"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authReady, getAuth } from "@/server/auth/better-auth";
import { requireUser, signOut } from "@/server/auth/session";
import { deleteAccount } from "@/server/settings/account";
import { saveUserAI, testUserAIConnection, type AIConnectionResult, type AIFormInput } from "@/server/settings/ai";
import { SettingsError, firstIssue } from "@/server/settings/errors";
import { updatePrivacySettings } from "@/server/settings/privacy";
import { updateProfile } from "@/server/settings/profile";
import {
  changeOwnPassword,
  passwordFormSchema,
  revokeOneSession,
  signOutOtherSessions,
} from "@/server/settings/security";

/** Result shown under a form. Never contains passwords, keys or secrets. */
export type SettingsState = { error?: string; ok?: string } | null;

/** Text fields from FormData. Missing and non-text values read as "". */
function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

/** Like text(), but blank becomes undefined, for optional fields. */
function optionalText(formData: FormData, name: string): string | undefined {
  return text(formData, name).trim() || undefined;
}

/** Profile form: name and email. The name is also set on the Better Auth user. */
export async function updateProfileAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { user } = await requireUser();
  try {
    const saved = updateProfile(user.id, { name: text(formData, "name"), email: text(formData, "email") });
    await authReady();
    await getAuth().api.updateUser({ body: { name: saved.name }, headers: await headers() });
  } catch (err) {
    if (err instanceof SettingsError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: "Profile saved." };
}

/** Changes the password. Other sessions are signed out; this browser stays signed in. */
export async function changePasswordAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { user } = await requireUser();
  const parsed = passwordFormSchema.safeParse({
    current: text(formData, "current"),
    next: text(formData, "next"),
    confirm: text(formData, "confirm"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  try {
    await changeOwnPassword(user.id, await headers(), parsed.data.current, parsed.data.next);
  } catch (err) {
    if (err instanceof SettingsError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: "Password changed. Other sessions were signed out." };
}

/** Signs out every session except this one. */
export async function signOutOthersAction(): Promise<void> {
  const { user, session } = await requireUser();
  await signOutOtherSessions(user.id, await headers(), session.id);
  refresh();
}

/** Signs out one of the user's other sessions. */
export async function revokeSessionAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { user, session } = await requireUser();
  try {
    await revokeOneSession(user.id, await headers(), session.id, text(formData, "sessionId"));
  } catch (err) {
    if (err instanceof SettingsError) return { error: err.message };
    throw err;
  }
  refresh();
  return null;
}

/** Retention and default cleaning mode. Each select submits only its own field. */
export async function savePrivacySettingAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { user } = await requireUser();
  try {
    updatePrivacySettings(user.id, {
      retentionHours: formData.get("retentionHours") ?? undefined,
      defaultMode: formData.get("defaultMode") ?? undefined,
    });
  } catch (err) {
    if (err instanceof SettingsError) return { error: err.message };
    throw err;
  }
  return { ok: "Saved." };
}

/** Deletes the account and all of its data after the email is typed to confirm. Then signs out. */
export async function deleteAccountAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { user } = await requireUser();
  try {
    await deleteAccount(user.id, text(formData, "confirmEmail"));
  } catch (err) {
    if (err instanceof SettingsError) return { error: err.message };
    throw err;
  }
  // The account's sessions are already gone; this only clears the browser's cookie.
  await signOut().catch(() => undefined);
  redirect("/signin");
}

/** AI section: instance or own-key mode, and the own-key settings. */
export async function saveAIProviderAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { user } = await requireUser();
  const input: AIFormInput = {
    aiMode: text(formData, "aiMode"),
    ownProvider: optionalText(formData, "ownProvider"),
    ownModel: optionalText(formData, "ownModel"),
    ownBaseURL: optionalText(formData, "ownBaseURL"),
    // Blank keeps the saved key. The value is never echoed back.
    ownApiKey: optionalText(formData, "ownApiKey"),
  };
  try {
    saveUserAI(user.id, input);
  } catch (err) {
    if (err instanceof SettingsError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: "AI settings saved." };
}

/** Checks the user's effective provider with its saved settings. */
export async function testAIConnectionAction(): Promise<AIConnectionResult> {
  const { user } = await requireUser();
  return testUserAIConnection(user.id);
}

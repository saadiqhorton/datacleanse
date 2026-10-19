"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { twoFactorLimiter } from "@/server/auth/rateLimit";
import { getCurrentSessionId, passTwoFactor, requireUser, signOut } from "@/server/auth/session";
import { AuthError, changePassword } from "@/server/auth/users";
import { beginTotpEnrollment, confirmTotp, disableTotp } from "@/server/auth/totp";
import { deleteAccount } from "@/server/settings/account";
import { saveUserAI, testUserAIConnection, type AIConnectionResult, type AIFormInput } from "@/server/settings/ai";
import { SettingsError, firstIssue } from "@/server/settings/errors";
import { updatePrivacySettings } from "@/server/settings/privacy";
import { revokeOneSession, passwordFormSchema, setInitialPassword, signOutOtherSessions } from "@/server/settings/security";
import { updateProfile } from "@/server/settings/profile";

/** Result shown under a form. Never contains passwords, keys or secrets. */
export type SettingsState = { error?: string; ok?: string } | null;

export type TwoFactorEnrollment =
  | { ok: true; secret: string; qrDataUrl: string }
  | { ok: false; error: string };

const CODE_RE = /^\d{6}$/;
const CODE_ERROR = "That code isn't right. Check your authenticator app and try again.";

/** Text fields from FormData. Missing and non-text values read as "". */
function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

/** Like text(), but blank becomes undefined, for optional fields. */
function optionalText(formData: FormData, name: string): string | undefined {
  return text(formData, name).trim() || undefined;
}

function minutes(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  return `${m} minute${m === 1 ? "" : "s"}`;
}

/** Profile form: name and email. */
export async function updateProfileAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { user } = await requireUser();
  try {
    updateProfile(user.id, { name: text(formData, "name"), email: text(formData, "email") });
  } catch (err) {
    if (err instanceof SettingsError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: "Profile saved." };
}

/** Starts (or restarts) two-factor setup. Returns the secret and a QR code for the authenticator app. */
export async function startTwoFactorAction(): Promise<TwoFactorEnrollment> {
  const { user } = await requireUser();
  let enrollment: { secret: string; otpauthUrl: string };
  try {
    enrollment = beginTotpEnrollment(user.id);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Two-factor setup could not start." };
  }
  const qrDataUrl = await QRCode.toDataURL(enrollment.otpauthUrl, { errorCorrectionLevel: "M", margin: 1, width: 208 });
  return { ok: true, secret: enrollment.secret, qrDataUrl };
}

/** Confirms enrollment with a code. Turns two-factor sign-in on. */
export async function confirmTwoFactorAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { user } = await requireUser();
  const code = text(formData, "code").replace(/\s+/g, "");
  if (!CODE_RE.test(code)) return { error: "Enter the 6-digit code from your app." };

  const key = `2fa-manage:${user.id}`;
  if (twoFactorLimiter.isLimited(key)) {
    return { error: `Too many incorrect codes. Try again in ${minutes(twoFactorLimiter.retryAfterMs(key))}.` };
  }
  if (!confirmTotp(user.id, code)) {
    twoFactorLimiter.record(key);
    return { error: CODE_ERROR };
  }
  twoFactorLimiter.reset(key);
  // This session just proved possession of the authenticator app, so it should not be challenged again.
  await passTwoFactor();
  refresh();
  return { ok: "Two-factor sign-in is on." };
}

/** Turns two-factor sign-in off after a valid code. */
export async function disableTwoFactorAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { user } = await requireUser();
  const code = text(formData, "code").replace(/\s+/g, "");
  if (!CODE_RE.test(code)) return { error: "Enter the 6-digit code from your app." };

  const key = `2fa-manage:${user.id}`;
  if (twoFactorLimiter.isLimited(key)) {
    return { error: `Too many incorrect codes. Try again in ${minutes(twoFactorLimiter.retryAfterMs(key))}.` };
  }
  if (!disableTotp(user.id, code)) {
    twoFactorLimiter.record(key);
    return { error: CODE_ERROR };
  }
  twoFactorLimiter.reset(key);
  refresh();
  return { ok: "Two-factor sign-in is off." };
}

/** Changes the password, or sets one when the account has none. Other sessions are signed out. */
export async function changePasswordAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { user } = await requireUser();
  const parsed = passwordFormSchema.safeParse({
    current: text(formData, "current"),
    next: text(formData, "next"),
    confirm: text(formData, "confirm"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  if (user.hasPassword && !parsed.data.current) return { error: "Enter your current password." };

  const sessionId = await getCurrentSessionId();
  if (!sessionId) return { error: "Sign in again to change your password." };

  try {
    if (user.hasPassword) {
      await changePassword(user.id, parsed.data.current, parsed.data.next, sessionId);
    } else {
      await setInitialPassword(user.id, parsed.data.next, sessionId);
    }
  } catch (err) {
    if (err instanceof AuthError || err instanceof SettingsError) return { error: err.message };
    throw err;
  }
  refresh();
  return {
    ok: user.hasPassword
      ? "Password changed. Other sessions were signed out."
      : "Password set. Other sessions were signed out.",
  };
}

/** Signs out every session except this one. */
export async function signOutOthersAction(): Promise<void> {
  const { user } = await requireUser();
  const sessionId = await getCurrentSessionId();
  if (sessionId) signOutOtherSessions(user.id, sessionId);
  refresh();
}

/** Signs out one of the user's other sessions. */
export async function revokeSessionAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { user } = await requireUser();
  const sessionId = await getCurrentSessionId();
  try {
    revokeOneSession(user.id, sessionId, text(formData, "sessionId"));
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
  await signOut();
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

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { nextCookies } from "better-auth/next-js";
import { audit } from "../audit";
import { db, type DB } from "../db";
import { sendEmail } from "../email";
import { env } from "../env";
import { getUserById, insertAppUser, signupsOpen, unclaimedUserIdForEmail } from "./users";

/**
 * Email + password auth via Better Auth (https://better-auth.com/docs/authentication/email-password).
 * Better Auth keeps its own tables (auth_user, auth_session, auth_account, auth_verification) in the
 * app's SQLite file; each auth_user gets a matching row in the app's `users` table with the same id,
 * which owns files, settings and the admin role.
 */
function authOptions(conn: DB) {
  return {
    database: conn,
    secret: env.appSecret,
    baseURL: env.appUrl,
    user: { modelName: "auth_user" },
    session: { modelName: "auth_session" },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        // Not awaited, per the docs, so response timing doesn't reveal whether the account exists.
        void sendEmail({
          to: user.email,
          subject: "Reset your DataCleanse password",
          text: `Use this link to choose a new password:\n\n${url}\n\nIf you did not ask for it, ignore this email.`,
        }).catch((err) => console.error("[auth] password reset email failed", err));
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Single-user by default: only the first account may sign up (ALLOW_SIGNUPS=1 reopens it).
          before: async (user) => {
            // An account from before Better Auth is claimed by signing up with its email: reuse its id.
            const legacyId = unclaimedUserIdForEmail(user.email);
            if (legacyId) return { data: { ...user, id: legacyId } };
            if (!signupsOpen()) {
              throw new APIError("FORBIDDEN", {
                message: "Sign-ups are closed on this DataCleanse. Ask the owner to invite you.",
              });
            }
          },
          after: async (user) => {
            insertAppUser(user.id, user.email, user.name);
            audit("auth.signed_up", "Account created.", { actor: user.id });
          },
        },
      },
      session: {
        create: {
          // Disabled accounts can't start new sessions.
          before: async (session) => {
            if (getUserById(session.userId)?.disabled) return false;
          },
        },
      },
    },
    plugins: [nextCookies()], // must stay last
  } satisfies BetterAuthOptions;
}

type Auth = ReturnType<typeof betterAuth<ReturnType<typeof authOptions>>>;

const g = globalThis as unknown as { __dcAuth?: { conn: DB; auth: Auth; ready: Promise<void> } };

/** The Better Auth instance bound to the current database (tests swap the database). */
export function getAuth(): Auth {
  return state().auth;
}

/** Creates Better Auth's tables on first use. Await before handling auth requests. */
export function authReady(): Promise<void> {
  return state().ready;
}

function state() {
  const conn = db();
  if (!g.__dcAuth || g.__dcAuth.conn !== conn) {
    const options = authOptions(conn);
    g.__dcAuth = {
      conn,
      auth: betterAuth(options),
      ready: getMigrations(options).then((m) => m.runMigrations()),
    };
  }
  return g.__dcAuth;
}

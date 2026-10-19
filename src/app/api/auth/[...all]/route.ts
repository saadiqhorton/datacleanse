import { authReady, getAuth } from "@/server/auth/better-auth";

// Better Auth's endpoints (/api/auth/sign-in/email, /sign-up/email, /sign-out, /request-password-reset, ...).
async function handler(request: Request) {
  await authReady();
  return getAuth().handler(request);
}

export { handler as GET, handler as POST };

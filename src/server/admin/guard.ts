import { db } from "../db";
import { AdminError } from "./errors";

/**
 * Admin functions take the acting user's id and check it here, so they stay safe even when
 * called outside a requireAdmin() page or action. The actor must be an enabled admin.
 */
export function assertAdminActor(actorId: string): void {
  const row = db().prepare("SELECT role, disabled FROM users WHERE id = ?").get(actorId) as
    | { role: string; disabled: number }
    | undefined;
  if (!row || row.role !== "admin" || row.disabled === 1) {
    throw new AdminError("Only an active admin can do that.");
  }
}

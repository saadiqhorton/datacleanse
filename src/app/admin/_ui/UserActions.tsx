"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { manageUserAction, type ActionState } from "../actions";

/** Make admin / remove admin and disable / enable for one row of the users table. */
export function UserActions({
  userId,
  email,
  role,
  disabled,
  isSelf,
  isLastAdmin,
}: {
  userId: string;
  email: string;
  role: "user" | "admin";
  disabled: boolean;
  isSelf: boolean;
  isLastAdmin: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(manageUserAction, null);

  if (isSelf) return <span className="text-[13px] text-muted">That&apos;s you</span>;

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex flex-wrap justify-end gap-2">
        {role === "user" ? (
          <Button type="submit" name="op" value="promote" variant="secondary" size="sm" disabled={pending}>
            Make admin
          </Button>
        ) : (
          <Button
            type="submit"
            name="op"
            value="demote"
            variant="secondary"
            size="sm"
            disabled={pending || isLastAdmin}
            title={isLastAdmin ? "This is the last admin" : undefined}
          >
            Remove admin
          </Button>
        )}

        {disabled ? (
          <Button type="submit" name="op" value="enable" variant="secondary" size="sm" disabled={pending}>
            Enable
          </Button>
        ) : (
          <Button
            type="submit"
            name="op"
            value="disable"
            variant="secondary"
            size="sm"
            disabled={pending || isLastAdmin}
            title={isLastAdmin ? "This is the last admin" : undefined}
            onClick={(e) => {
              if (!window.confirm(`Disable ${email}? Their sessions will be signed out.`)) e.preventDefault();
            }}
          >
            Disable
          </Button>
        )}
      </div>
      {state?.error && (
        <span role="alert" className="text-right text-[13px] text-error">
          {state.error}
        </span>
      )}
      {state?.message && !state.error && (
        <span role="status" className="text-right text-[13px] text-slate">
          {state.message}
        </span>
      )}
    </form>
  );
}

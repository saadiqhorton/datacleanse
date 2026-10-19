"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { revokeSessionAction, type SettingsState } from "../actions";
import { FormMessage } from "./Row";

export function RevokeSessionButton({ sessionId }: { sessionId: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(revokeSessionAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="sessionId" value={sessionId} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        Sign out
      </Button>
      <FormMessage error={state?.error} />
    </form>
  );
}

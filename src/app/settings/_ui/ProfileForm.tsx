"use client";

import { useActionState } from "react";
import { Button, Card } from "@/components/ui";
import { updateProfileAction, type SettingsState } from "../actions";
import { FormMessage, Row, inputClass } from "./Row";

export function ProfileForm({ name, email, memberSince }: { name: string; email: string; memberSince: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateProfileAction, null);

  return (
    <form action={action}>
      <Card>
        <Row
          title={
            <label htmlFor="profile-name" className="cursor-pointer">
              Name
            </label>
          }
          description="Shown in the account menu."
        >
          <input
            id="profile-name"
            name="name"
            defaultValue={name}
            required
            maxLength={100}
            autoComplete="name"
            className={inputClass}
          />
        </Row>
        <Row
          title={
            <label htmlFor="profile-email" className="cursor-pointer">
              Email
            </label>
          }
          description="You sign in with this address. Each account needs its own."
        >
          <input
            id="profile-email"
            name="email"
            type="email"
            defaultValue={email}
            required
            maxLength={254}
            autoComplete="email"
            className={inputClass}
          />
        </Row>
        <Row title="Member since" description="When this account was created.">
          <span className="text-sm text-ink">{memberSince}</span>
        </Row>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-divider px-4 py-4 sm:px-6">
          <FormMessage error={state?.error} ok={state?.ok} />
          <Button type="submit" variant="primary" size="md" disabled={pending} className="ml-auto">
            Save changes
          </Button>
        </div>
      </Card>
    </form>
  );
}

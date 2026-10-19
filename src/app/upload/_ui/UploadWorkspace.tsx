import { getProviderForUser } from "@/server/ai";
import { requireUser } from "@/server/auth/session";
import { env } from "@/server/env";
import { listRuleSets } from "@/server/rules/repo";
import { getPrivacySettings } from "@/server/settings/privacy";
import { UploadForm } from "./UploadForm";

/** Loads what the form needs for this user. Reads cookies and the database, so it renders inside Suspense. */
export async function UploadWorkspace() {
  const { user } = await requireUser();
  const ai = getProviderForUser(user.id);
  const aiOff = ai.source === "off";
  const savedMode = getPrivacySettings(user.id).defaultMode;

  return (
    <UploadForm
      maxUploadBytes={env.maxUploadBytes}
      defaultMode={aiOff ? "rules_only" : savedMode}
      ai={{ off: aiOff, label: ai.label }}
      ruleSets={listRuleSets(user.id).map((s) => ({ id: s.id, name: s.name }))}
    />
  );
}

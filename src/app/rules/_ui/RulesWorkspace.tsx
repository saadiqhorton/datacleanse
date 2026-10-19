import { SideNav } from "@/components/layout";
import { Card } from "@/components/ui";
import { requireUser } from "@/server/auth/session";
import { ensureDefaultRuleSet, listProfiledFiles, listRules, listRuleSets } from "@/server/rules/repo";
import { HeaderMatchEditor } from "./HeaderMatchEditor";
import { NaturalRule } from "./NaturalRule";
import { NewRuleSetForm } from "./NewRuleSetForm";
import { RuleSetHeader } from "./RuleSetHeader";
import { RulesPanel } from "./RulesPanel";

type SearchParams = Promise<{ set?: string | string[] }>;

/** Placeholder layout in the same shape while the rule sets load. */
export function RulesSkeleton() {
  return (
    <div aria-hidden="true" className="mx-auto flex max-w-[1344px] animate-pulse flex-wrap">
      <div className="w-full px-4 py-8 md:w-[273px] md:shrink-0 md:border-r md:border-divider">
        <div className="flex flex-col gap-3 px-4">
          <div className="h-3 w-20 rounded bg-divider" />
          <div className="h-8 rounded bg-divider" />
          <div className="h-8 rounded bg-divider" />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 basis-[320px] flex-col gap-6 p-4 md:p-8">
        <div className="h-8 w-60 rounded bg-divider" />
        <div className="h-28 rounded-xl border border-hairline bg-white" />
        <div className="h-40 rounded-xl border border-hairline bg-white" />
        <div className="h-48 rounded-xl border border-hairline bg-white" />
      </div>
    </div>
  );
}

/**
 * The Rules screen body: the user's rule sets in the sidebar, and the selected set's header matches,
 * plain-English drafting and rule list. The first visit seeds the default "CRM exports" set.
 */
export async function RulesWorkspace({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requireUser();
  ensureDefaultRuleSet(user.id);

  const sets = listRuleSets(user.id);
  const { set: requested } = await searchParams;
  const requestedId = typeof requested === "string" ? requested : undefined;
  const selected = sets.find((s) => s.id === requestedId) ?? sets[0] ?? null;
  const rules = selected ? listRules(user.id, selected.id) : [];
  const files = listProfiledFiles(user.id, 10).map((f) => ({ id: f.id, name: f.name, headers: f.headers }));

  return (
    <div className="mx-auto flex max-w-[1344px] flex-wrap">
      {/* Design is content-box: 240px content + 32px nav padding + 1px border = 273px. Full width when stacked on phones. */}
      <div className="w-full md:w-[273px] md:shrink-0 [&>nav]:border-r-0 [&>nav]:px-0 md:[&>nav]:border-r md:[&>nav]:px-4">
        <SideNav
          label="Rule sets"
          bordered
          dot
          active={selected?.name ?? ""}
          items={sets.map((s) => ({ label: s.name, href: `/rules?set=${s.id}` }))}
          footer={<NewRuleSetForm />}
        />
      </div>

      <main className="flex min-w-0 flex-1 basis-[320px] flex-col gap-6 p-4 md:p-8">
        {selected ? (
          <>
            <RuleSetHeader key={`header-${selected.id}`} setId={selected.id} name={selected.name} />
            <HeaderMatchEditor key={`headers-${selected.id}`} setId={selected.id} headers={selected.headerMatch} files={files} />
            <NaturalRule key={`nl-${selected.id}`} setId={selected.id} />
            <RulesPanel key={`rules-${selected.id}`} setId={selected.id} rules={rules} />
          </>
        ) : (
          <Card className="flex flex-col gap-2 p-6">
            <h1 className="text-[28px] font-semibold leading-[1.25]">No rule sets yet</h1>
            <p className="text-sm text-slate">
              Create a rule set with &ldquo;+ New rule set&rdquo;. Its rules apply to files whose headers match it.
            </p>
          </Card>
        )}
      </main>
    </div>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, StatusBadge } from "@/components/ui";
import { countEnabledAdmins, listUsers } from "@/server/admin/users";
import { parsePage } from "@/server/admin/paging";
import { requireAdmin } from "@/server/auth/session";
import { AdminFrame, AdminLoading, TableLoading } from "../_ui/AdminFrame";
import { InviteUserForm } from "../_ui/InviteUserForm";
import { LocalTime } from "../_ui/LocalTime";
import { Pager } from "../_ui/Pager";
import { UserActions } from "../_ui/UserActions";

export const metadata: Metadata = {
  title: "Users · Admin · DataCleanse",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AdminLoading />}>
      <AdminFrame active="Users">
        <h1 className="text-4xl leading-[1.2] font-semibold tracking-[-0.5px]">Users</h1>

        <section aria-labelledby="invite-heading" className="flex flex-col gap-4">
          <div>
            <h2 id="invite-heading" className="text-lg leading-[normal] font-semibold">
              Invite someone
            </h2>
            <p className="text-sm text-slate">Create an account by email and send a sign-in link.</p>
          </div>
          <Card className="p-6">
            <InviteUserForm />
          </Card>
        </section>

        <Suspense fallback={<TableLoading label="Loading users" />}>
          <UsersList searchParams={searchParams} />
        </Suspense>
      </AdminFrame>
    </Suspense>
  );
}

async function UsersList({ searchParams }: { searchParams: SearchParams }) {
  const { user: me } = await requireAdmin();
  const params = await searchParams;
  const users = listUsers({ page: parsePage(first(params.page)) });
  const enabledAdmins = countEnabledAdmins();

  return (
    <>
      <Card className="min-w-0 overflow-x-auto">
        <table aria-label="Users" className="w-full text-sm leading-normal">
          <thead>
            <tr>
              {["Name", "Email", "Role", "2FA", "Files", "Created", "Status", "Actions"].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="px-5 py-3 text-left text-[11px] font-semibold tracking-[0.5px] text-slate uppercase"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.items.map((u) => {
              const isLastAdmin = u.role === "admin" && !u.disabled && enabledAdmins <= 1;
              return (
                <tr key={u.id} className="border-t border-divider align-top">
                  <td className="px-5 py-3.5">{u.name || "—"}</td>
                  <td className="px-5 py-3.5 break-all">{u.email}</td>
                  <td className="px-5 py-3.5">{u.role === "admin" ? "Admin" : "User"}</td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={u.totpEnabled ? "ready" : "deleted"}>{u.totpEnabled ? "On" : "Off"}</StatusBadge>
                  </td>
                  <td className="px-5 py-3.5 text-slate">{u.fileCount.toLocaleString("en-US")}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-slate">
                    <LocalTime at={u.createdAt} format="date" />
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={u.disabled ? "failed" : "ready"}>{u.disabled ? "Disabled" : "Active"}</StatusBadge>
                  </td>
                  <td className="px-5 py-3.5">
                    <UserActions
                      userId={u.id}
                      email={u.email}
                      role={u.role}
                      disabled={u.disabled}
                      isSelf={u.id === me.id}
                      isLastAdmin={isLastAdmin}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <p className="-mt-4 text-[13px] text-muted">
        {users.total.toLocaleString("en-US")} {users.total === 1 ? "account" : "accounts"}
      </p>
      <Pager basePath="/admin/users" query={{}} page={users.page} pageCount={users.pageCount} />
    </>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, StatusBadge } from "@/components/ui";
import { countEnabledAdmins, listUsers } from "@/server/admin/users";
import { parsePage } from "@/server/admin/paging";
import { requireAdmin } from "@/server/auth/session";
import { signupsOpen } from "@/server/auth/users";
import { AdminFrame, AdminLoading, TableLoading } from "../_ui/AdminFrame";
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
      <p className="text-sm text-slate">
        {signupsOpen()
          ? "Sign-ups are open."
          : "Single-user instance. Sign-ups are closed after the first account; set ALLOW_SIGNUPS=1 to let others create accounts."}
      </p>
      <Card className="min-w-0 overflow-x-auto">
        <table aria-label="Users" className="w-full text-sm leading-normal">
          <thead>
            <tr>
              {["Name", "Email", "Role", "Files", "Created", "Status", "Actions"].map((heading) => (
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

import type { CompanyRef, DepartmentDTO, MeDTO, RoleDTO, UserDTO } from "@aibos/shared";
import { UsersAdmin } from "@/components/admin/UsersAdmin";
import { PageError } from "@/components/common/PageError";
import { PageHeader } from "@/components/common/PageHeader";
import { apiGet } from "@/lib/api";

export const metadata = { title: "Users & Access" };

async function load() {
  try {
    const [users, roles, me, departments] = await Promise.all([
      apiGet<{ data: UserDTO[] }>("/v1/users"),
      apiGet<{ data: RoleDTO[] }>("/v1/roles"),
      apiGet<MeDTO>("/v1/auth/me"),
      apiGet<{ data: DepartmentDTO[] }>("/v1/departments"),
    ]);
    return {
      data: {
        users: users.data,
        roles: roles.data,
        companies: me.accessibleCompanies as CompanyRef[],
        departments: departments.data,
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error };
  }
}

export default async function UsersPage() {
  const { data, error } = await load();
  if (!data) return <PageError error={error} />;
  return (
    <div className="mx-auto max-w-[1480px]">
      <PageHeader
        eyebrow="Settings"
        title="Users & Access"
        description="People, their company memberships and roles. You only see users in companies you administer."
        devData={data.users.some((u) => u.origin === "dev_seed")}
      />
      <UsersAdmin {...data} />
    </div>
  );
}

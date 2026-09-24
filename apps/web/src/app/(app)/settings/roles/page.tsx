import type { MeDTO, PermissionDTO, RoleDTO } from "@aibos/shared";
import { RolesAdmin } from "@/components/admin/RolesAdmin";
import { PageError } from "@/components/common/PageError";
import { PageHeader } from "@/components/common/PageHeader";
import { apiGet } from "@/lib/api";

export const metadata = { title: "Roles & Permissions" };

async function load() {
  try {
    const [roles, permissions, me] = await Promise.all([
      apiGet<{ data: RoleDTO[] }>("/v1/roles"),
      apiGet<{ data: PermissionDTO[] }>("/v1/permissions"),
      apiGet<MeDTO>("/v1/auth/me"),
    ]);
    return {
      data: {
        roles: roles.data,
        permissions: permissions.data,
        canManage: me.globalPermissions.includes("security.manage"),
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error };
  }
}

export default async function RolesPage() {
  const { data, error } = await load();
  if (!data) return <PageError error={error} />;
  return (
    <div className="mx-auto max-w-[1480px]">
      <PageHeader
        eyebrow="Settings"
        title="Roles & Permissions"
        description={`${data.roles.length} roles over ${data.permissions.length} granular permissions.`}
      />
      <RolesAdmin {...data} />
    </div>
  );
}

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/next-navigation";
import { ME_OWNER, ept, og, user } from "@/test/fixtures";
import type { PermissionDTO, RoleDTO } from "@aibos/shared";
import { SessionProvider } from "../shell/SessionContext";
import { RolesAdmin } from "./RolesAdmin";
import { UsersAdmin } from "./UsersAdmin";

const role = (key: string, name: string, extra: Partial<RoleDTO> = {}): RoleDTO => ({
  id: `r-${key}`,
  key,
  name,
  isSystem: true,
  description: `${name} role`,
  scope: "company",
  companyId: null,
  rank: 10,
  permissions: ["company.view"],
  userCount: 1,
  ...extra,
});
const ROLES = [
  role("platform_owner", "Platform Owner", {
    scope: "global",
    permissions: ["company.view", "security.manage"],
  }),
  role("staff", "Staff"),
  role("custom_reviewer", "Reviewer", { isSystem: false, userCount: 0 }),
];
const PERMS: PermissionDTO[] = [
  {
    key: "company.view",
    category: "Companies",
    label: "View company",
    description: "See it",
    scope: "company",
    sensitive: false,
  },
  {
    key: "cost.view",
    category: "Costs",
    label: "View costs",
    description: "See spend",
    scope: "company",
    sensitive: false,
  },
  {
    key: "security.manage",
    category: "System",
    label: "Manage security",
    description: "Roles",
    scope: "global",
    sensitive: true,
  },
];
const USERS = [
  user({
    id: "u1",
    email: "owner@aibos.example",
    displayName: "Platform Owner",
    isPlatformOwner: true,
    memberships: [
      {
        id: "m1",
        company: null,
        role: {
          id: "r-platform_owner",
          key: "platform_owner",
          name: "Platform Owner",
          isSystem: true,
        },
        status: "active",
        departments: [],
        joinedAt: null,
        createdAt: "",
      },
    ],
  }),
  user({
    id: "u2",
    email: "og.marketing@aibos.example",
    displayName: "OG Marketing",
    memberships: [
      {
        id: "m2",
        company: og,
        role: { id: "r-staff", key: "staff", name: "Department Manager", isSystem: true },
        status: "active",
        departments: [{ id: "d1", name: "Marketing" }],
        joinedAt: null,
        createdAt: "",
      },
    ],
  }),
  user({ id: "u3", email: "gone@aibos.example", displayName: "Gone User", status: "disabled" }),
];

afterEach(() => vi.unstubAllGlobals());

describe("Users & Access", () => {
  it("lists users with status, memberships and a distinct Platform Owner", () => {
    render(
      <SessionProvider me={ME_OWNER}>
        <UsersAdmin users={USERS} roles={ROLES} companies={[ept, og]} departments={[]} />
      </SessionProvider>,
    );
    const list = screen.getByRole("list", { name: "Users" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getAllByText("Platform Owner").length).toBeGreaterThanOrEqual(2);
    expect(within(list).getByText(/Opportunitygrad ·/)).toHaveTextContent("Marketing");
    expect(within(list).getByText("Disabled")).toBeInTheDocument();
  });

  it("invites a user and shows the single-use link", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: {}, invitationUrl: "http://localhost:3000/invite/abc" }),
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const u = userEvent.setup();
    render(
      <SessionProvider me={ME_OWNER}>
        <UsersAdmin users={USERS} roles={ROLES} companies={[ept, og]} departments={[]} />
      </SessionProvider>,
    );
    await u.click(screen.getByRole("button", { name: "Invite user" }));
    const form = screen.getByRole("form", { name: "Invite user" });
    await u.type(within(form).getByLabelText("Email"), "new@aibos.example");
    await u.type(within(form).getByLabelText("First name"), "New");
    await u.selectOptions(within(form).getByLabelText("Company"), ept.id);
    await u.click(within(form).getByRole("button", { name: /Send invitation/ }));
    expect(await screen.findByText("http://localhost:3000/invite/abc")).toBeInTheDocument();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.memberships[0]).toMatchObject({ companyId: ept.id, roleId: "r-staff" });
  });
});

describe("Roles & Permissions", () => {
  it("locks system roles and edits custom roles", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: ROLES[2] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const u = userEvent.setup();
    render(<RolesAdmin roles={ROLES} permissions={PERMS} canManage />);
    expect(screen.getAllByText("System")).toHaveLength(2);

    await u.click(screen.getByRole("button", { name: /^Platform Owner/ }));
    let dialog = screen.getByRole("dialog", { name: "Platform Owner" });
    expect(within(dialog).getByText(/permissions are locked/)).toBeInTheDocument();
    expect(within(dialog).getByRole("switch", { name: "Manage security" })).toBeDisabled();
    await u.click(within(dialog).getByRole("button", { name: "Close" }));

    await u.click(screen.getByRole("button", { name: /^Reviewer/ }));
    dialog = screen.getByRole("dialog", { name: "Reviewer" });
    const cost = within(dialog).getByRole("switch", { name: "View costs" });
    expect(cost).toBeEnabled();
    await u.click(cost);
    await u.click(within(dialog).getByRole("button", { name: /Save permissions/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/roles/r-custom_reviewer");
    expect(JSON.parse(init.body as string).permissions.sort()).toEqual([
      "company.view",
      "cost.view",
    ]);
  });

  it("hides management controls from non-security users", () => {
    render(<RolesAdmin roles={ROLES} permissions={PERMS} canManage={false} />);
    expect(screen.queryByRole("button", { name: "New custom role" })).not.toBeInTheDocument();
  });
});

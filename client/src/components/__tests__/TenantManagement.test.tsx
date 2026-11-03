import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import TenantManagement from "../TenantManagement";
const tools = vi.hoisted(() => ({
  assign: vi.fn(),
  change: vi.fn(),
  create: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    tenants: {
      list: {
        useQuery: () => ({
          data: [
            { id: 7, name: "Example", slug: "example", status: "pending" },
            { id: 8, name: "Active air", slug: "active-air", status: "active" },
          ],
        }),
      },
      create: { useMutation: () => ({ mutate: tools.create }) },
      setStatus: { useMutation: () => ({ mutate: tools.change }) },
      assignUser: { useMutation: () => ({ mutate: tools.assign }) },
    },
  },
}));
it("binds administrative commands to the selected tenant, hides assignment until active and requires confirmation for changes", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    render(<TenantManagement />);
    fireEvent.change(screen.getByLabelText("Tenant name"), {
      target: { value: "  Air  " },
    });
    fireEvent.change(screen.getByLabelText("Tenant slug"), {
      target: { value: "air-demo" },
    });
    fireEvent.click(screen.getByText("Create pending tenant"));
    expect(tools.create).toHaveBeenCalledWith({
      name: "Air",
      slug: "air-demo",
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "7" } });
    expect(screen.queryByLabelText("User ID")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Activate tenant"));
    expect(tools.change).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByText("Activate tenant"));
    expect(tools.change).toHaveBeenCalledWith({
      tenantId: 7,
      status: "active",
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("User ID"), {
      target: { value: "42" },
    });
    fireEvent.click(screen.getByText("Assign user to tenant"));
    expect(tools.assign).toHaveBeenCalledWith({ tenantId: 8, userId: 42 });
  } finally {
    confirm.mockRestore();
  }
});

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  OperationalReadState,
  useOperationalLabels,
} from "./OperationalReadState";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { toast } from "sonner";

export default function TenantManagement() {
  const l = useOperationalLabels();
  const query = trpc.tenants.list.useQuery();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [userId, setUserId] = useState("");
  const tenant = query.data?.find(row => String(row.id) === selectedId);
  const onError = (e: { message: string }) => toast.error(e.message);
  const refresh = async () => {
    await query.refetch();
  };
  const create = trpc.tenants.create.useMutation({
    onError,
    onSuccess: async row => {
      setName("");
      setSlug("");
      setSelectedId(String(row.id));
      await refresh();
    },
  });
  const change = trpc.tenants.setStatus.useMutation({
    onError,
    onSuccess: refresh,
  });
  const assign = trpc.tenants.assignUser.useMutation({
    onError,
    onSuccess: row => {
      setUserId("");
      toast.success(
        l(
          `تم إسناد المستخدم ${row.userId} إلى الشركة ${row.tenantId}`,
          `Assigned user ${row.userId} to tenant ${row.tenantId}`
        )
      );
    },
  });
  const busy =
    query.isFetching ||
    create.isPending ||
    change.isPending ||
    assign.isPending;
  const statuses = {
    pending: l("بانتظار التفعيل", "Pending"),
    active: l("نشطة", "Active"),
    suspended: l("موقوفة", "Suspended"),
  };
  return (
    <section className="space-y-4 rounded-lg border bg-background p-5 mb-5">
      <h2 className="text-xl font-semibold">
        {l("شركات الطيران المستأجرة", "Airline tenants")}
      </h2>
      <OperationalReadState query={query}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={e => {
            e.preventDefault();
            create.mutate({ name: name.trim(), slug });
          }}
        >
          <label>
            {l("اسم الشركة", "Tenant name")}
            <Input
              required
              maxLength={255}
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </label>
          <label>
            {l("معرّف الشركة النصي", "Tenant slug")}
            <Input
              required
              minLength={2}
              maxLength={64}
              pattern="[a-z0-9\-]{2,64}"
              value={slug}
              onChange={e => setSlug(e.target.value)}
            />
          </label>
          <Button
            disabled={busy || !name.trim() || !/^[a-z0-9-]{2,64}$/.test(slug)}
          >
            {l("إنشاء شركة بانتظار التفعيل", "Create pending tenant")}
          </Button>
        </form>
        <label className="block">
          {l("اختر شركة", "Select tenant")}{" "}
          <select
            value={selectedId}
            onChange={e => {
              setSelectedId(e.target.value);
              setUserId("");
            }}
          >
            <option value="">{l("اختر شركة", "Select tenant")}</option>
            {query.data?.map(row => (
              <option key={row.id} value={row.id}>
                {row.name} ({row.slug}, #{row.id}) · {statuses[row.status]}
              </option>
            ))}
          </select>
        </label>
        {tenant && (
          <div className="space-y-3">
            <p>
              {tenant.name} (#{tenant.id}) · {statuses[tenant.status]}
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                const status =
                  tenant.status === "active" ? "suspended" : "active";
                const prompt =
                  status === "suspended"
                    ? l(
                        `إيقاف وصول شركة ${tenant.name} (#${tenant.id})؟`,
                        `Suspend access for ${tenant.name} (#${tenant.id})?`
                      )
                    : l(
                        `تفعيل شركة ${tenant.name} (#${tenant.id})؟`,
                        `Activate ${tenant.name} (#${tenant.id})?`
                      );
                if (window.confirm(prompt))
                  change.mutate({ tenantId: tenant.id, status });
              }}
            >
              {tenant.status === "active"
                ? l("إيقاف الشركة", "Suspend tenant")
                : l("تفعيل الشركة", "Activate tenant")}
            </Button>
            {tenant.status === "active" && (
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={e => {
                  e.preventDefault();
                  const id = Number(userId);
                  if (
                    Number.isSafeInteger(id) &&
                    id > 0 &&
                    window.confirm(
                      l(
                        `إسناد المستخدم #${id} إلى شركة ${tenant.name} (#${tenant.id})؟`,
                        `Assign user #${id} to ${tenant.name} (#${tenant.id})?`
                      )
                    )
                  )
                    assign.mutate({ tenantId: tenant.id, userId: id });
                }}
              >
                <label>
                  {l("رقم المستخدم", "User ID")}
                  <Input
                    type="number"
                    required
                    min="1"
                    step="1"
                    value={userId}
                    onChange={e => setUserId(e.target.value)}
                  />
                </label>
                <Button disabled={busy || !userId}>
                  {l("إسناد المستخدم إلى الشركة", "Assign user to tenant")}
                </Button>
              </form>
            )}
          </div>
        )}
      </OperationalReadState>
    </section>
  );
}

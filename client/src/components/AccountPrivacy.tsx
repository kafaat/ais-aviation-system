import { useState } from "react";
import { toast } from "sonner";
import { MFASetup } from "./MFASetup";
import {
  OperationalReadState,
  useOperationalLabels,
} from "./OperationalReadState";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { trpc } from "@/lib/trpc";

function AccountProtection() {
  const l = useOperationalLabels();
  const status = trpc.mfa.getStatus.useQuery();
  const [enrolling, setEnrolling] = useState(false);
  const finish = () => {
    setEnrolling(false);
    void status.refetch();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {l("المصادقة الثنائية", "Two-factor authentication")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {enrolling ? (
          <MFASetup onComplete={finish} onCancel={finish} />
        ) : (
          <OperationalReadState query={status}>
            {status.data?.enabled ? (
              <p>
                {l(
                  "المصادقة الثنائية مفعّلة",
                  "Two-factor authentication is enabled"
                )}
              </p>
            ) : (
              <Button onClick={() => setEnrolling(true)}>
                {l("فتح إعدادات تطبيق المصادقة", "Open authenticator setup")}
              </Button>
            )}
          </OperationalReadState>
        )}
      </CardContent>
    </Card>
  );
}

function PrivacyExports() {
  const l = useOperationalLabels();
  const history = trpc.gdpr.getExportHistory.useQuery({ limit: 50 });
  const [format, setFormat] = useState<"json" | "csv">("json");
  const request = trpc.gdpr.exportData.useMutation({
    onSuccess: async () => {
      await history.refetch();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{l("تصدير بيانات الحساب", "Export account data")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <OperationalReadState query={history}>
          <label className="block">
            {l("صيغة الملف", "File format")}{" "}
            <select
              value={format}
              onChange={e =>
                setFormat(e.target.value === "csv" ? "csv" : "json")
              }
            >
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <Button
            disabled={
              request.isPending ||
              history.data?.some(item =>
                ["pending", "processing"].includes(item.status)
              )
            }
            onClick={() => request.mutate({ format })}
          >
            {l("طلب نسخة", "Request export")}
          </Button>
          <Button
            variant="outline"
            disabled={history.isFetching}
            onClick={() => void history.refetch()}
          >
            {l("تحديث الطلبات", "Refresh exports")}
          </Button>
          {history.data?.length === 0 && (
            <p>{l("لا توجد طلبات تصدير", "No export requests")}</p>
          )}
          <ul>
            {history.data?.map(row => (
              <li key={row.id} className="space-x-2">
                <span>
                  #{row.id} · {row.format.toUpperCase()} ·{" "}
                  {row.requestedAt.toLocaleDateString()} · {row.status}
                </span>{" "}
                {row.status === "completed" && (
                  <a
                    className="underline"
                    href={`/api/gdpr/download/${row.id}`}
                    download
                  >
                    {l("تنزيل", "Download")}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </OperationalReadState>
      </CardContent>
    </Card>
  );
}

function PrivacyDeletion() {
  const l = useOperationalLabels();
  const status = trpc.gdpr.getDeletionStatus.useQuery();
  // Keep the confirmation returned for this request in memory only.
  const [confirmation, setConfirmation] = useState<{
    id: number;
    token: string;
  } | null>(null);
  const refresh = async () => {
    await status.refetch();
  };
  const onError = (error: { message: string }) => toast.error(error.message);
  const request = trpc.gdpr.deleteAccount.useMutation({
    gcTime: 0,
    onError,
    onSuccess: async data => {
      setConfirmation({ id: data.requestId, token: data.confirmationToken });
      await refresh();
    },
  });
  const finish = async () => {
    setConfirmation(null);
    request.reset();
    await refresh();
  };
  const confirm = trpc.gdpr.confirmDeletion.useMutation({
    gcTime: 0,
    onError,
    onSuccess: finish,
  });
  const cancel = trpc.gdpr.cancelDeletion.useMutation({
    onError,
    onSuccess: finish,
  });
  const busy = request.isPending || confirm.isPending || cancel.isPending;
  const current = status.data?.request;
  const pending = current?.status === "pending";
  const cancellable =
    pending &&
    (!current.confirmedAt ||
      (current.scheduledDeletionAt &&
        current.scheduledDeletionAt > new Date()));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{l("طلب حذف الحساب", "Account deletion request")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p>
          {l(
            "بعد التأكيد وانتهاء فترة السماح يُوقف الوصول للحساب، ويخضع محو السجلات لمراجعة الاحتفاظ بالبيانات.",
            "After confirmation and the grace period, account access ends. Erasure of records requires a retention review."
          )}
        </p>
        <OperationalReadState query={status}>
          {current ? (
            <>
              <p role="status">
                #{current.id} ·{" "}
                {pending && current.confirmedAt
                  ? l("تم تأكيد الطلب", "Request confirmed")
                  : current.status}{" "}
                {current.scheduledDeletionAt?.toLocaleDateString()}
              </p>
              {pending &&
                !current.confirmedAt &&
                (confirmation?.id === current.id ? (
                  <Button
                    disabled={busy}
                    variant="destructive"
                    onClick={() =>
                      confirm.mutate({ confirmationToken: confirmation.token })
                    }
                  >
                    {l("تأكيد طلب الحذف", "Confirm deletion request")}
                  </Button>
                ) : (
                  <p>
                    {l(
                      "للتأكيد من هذه الجلسة، ألغِ الطلب السابق واطلب الحذف مجدداً.",
                      "To confirm from this session, cancel the previous request and start a new one."
                    )}
                  </p>
                ))}
              {cancellable && (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => cancel.mutate()}
                >
                  {l("إلغاء طلب الحذف", "Cancel deletion request")}
                </Button>
              )}
            </>
          ) : (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => request.mutate({ deletionType: "anonymize" })}
            >
              {l("بدء طلب الحذف", "Start deletion request")}
            </Button>
          )}
        </OperationalReadState>
      </CardContent>
    </Card>
  );
}

export default function AccountPrivacy() {
  return (
    <div className="space-y-5">
      <AccountProtection />
      <PrivacyExports />
      <PrivacyDeletion />
    </div>
  );
}

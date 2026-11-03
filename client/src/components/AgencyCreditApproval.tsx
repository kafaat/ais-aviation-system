import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AgencyCreditApproval({ agencyId }: { agencyId: number }) {
  const { t, i18n } = useTranslation();
  const [limit, setLimit] = useState("");
  const [reason, setReason] = useState("");
  const balance = trpc.travelAgent.creditBalance.useQuery({ agencyId });
  const approve = trpc.travelAgent.approveCredit.useMutation({
    onSuccess: async () => {
      await balance.refetch();
      setReason("");
      setLimit("");
    },
  });
  const current = balance.data;
  const money = (minor: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: "currency",
      currency: "SAR",
    }).format(minor / 100);
  const submit = (limitMinor: number | null) => {
    if (current && reason.trim())
      approve.mutate({
        agencyId,
        limitMinor,
        expectedTermsId: current.termsId,
        reason,
      });
  };
  const minor = Math.round(Number(limit) * 100);
  const canApprove = /^\d+(\.\d{1,2})?$/.test(limit) && minor <= 2147483647;
  return (
    <section
      aria-label={t("agencyCredit.title")}
      className="space-y-2 border-t pt-3"
    >
      <h3 className="font-semibold">{t("agencyCredit.title")}</h3>
      {current?.settlementReview && (
        <p role="status">{t("agencyCredit.settlementReview")}</p>
      )}
      {balance.error && <p role="alert">{balance.error.message}</p>}
      {current && (
        <>
          <p>
            {current.limitMinor == null
              ? t("agencyCredit.disabled")
              : t("agencyCredit.balance", {
                  limit: money(current.limitMinor),
                  outstanding: money(current.outstandingMinor),
                  available: money(current.availableMinor ?? 0),
                })}
          </p>
          <label className="block">
            {t("agencyCredit.newLimit")}
            <Input
              inputMode="decimal"
              value={limit}
              onChange={e => setLimit(e.target.value)}
            />
          </label>
          <label className="block">
            {t("agencyCredit.reason")}
            <Input
              maxLength={255}
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </label>
          <Button
            disabled={!canApprove || !reason.trim() || approve.isPending}
            onClick={() => submit(minor)}
          >
            {t("agencyCredit.approve")}
          </Button>
          <Button
            variant="outline"
            disabled={
              current.limitMinor == null || !reason.trim() || approve.isPending
            }
            onClick={() => submit(null)}
          >
            {t("agencyCredit.disable")}
          </Button>
          {approve.error && <p role="alert">{approve.error.message}</p>}
        </>
      )}
    </section>
  );
}

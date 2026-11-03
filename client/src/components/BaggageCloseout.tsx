import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

export function BaggageCloseout({
  flightId,
  disabled = false,
}: {
  flightId: number;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const closeout = trpc.baggage.flightCloseout.useQuery(
    { flightId },
    { enabled: false, retry: false }
  );
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="mt-4"
        disabled={closeout.isFetching || disabled}
        onClick={() => void closeout.refetch()}
      >
        {t("dcs.manifest.checkBaggage")}
      </Button>
      {closeout.isError && (
        <p role="alert">{t("dcs.manifest.closeoutUnavailable")}</p>
      )}
      {!closeout.isError &&
        !disabled &&
        closeout.data?.flightId === flightId && (
          <div role="status" className="mt-2 space-y-1">
            <p>
              {t(
                closeout.data.readyToClose
                  ? "dcs.manifest.closeoutMatched"
                  : "dcs.manifest.closeoutIncomplete"
              )}
            </p>
            <p>
              {t("dcs.manifest.closeoutCounts", {
                loaded: closeout.data.loadedBags,
                expected: closeout.data.expectedBags,
                unexpected: closeout.data.unexpectedBags,
              })}
            </p>
            {closeout.data.missingEntry.length > 0 && (
              <p>
                {t("dcs.manifest.missingEntry")}{" "}
                <bdi>{closeout.data.missingEntry.join(", ")}</bdi>
              </p>
            )}
            {closeout.data.missingLoading.length > 0 && (
              <p>
                {t("dcs.manifest.missingLoading")}{" "}
                <bdi>{closeout.data.missingLoading.join(", ")}</bdi>
              </p>
            )}
            {closeout.data.duplicates.length > 0 && (
              <p>
                {t("dcs.manifest.duplicateScans")}{" "}
                <bdi>
                  {closeout.data.duplicates
                    .map(row => row.tagNumber)
                    .join(", ")}
                </bdi>
              </p>
            )}
          </div>
        )}
    </>
  );
}

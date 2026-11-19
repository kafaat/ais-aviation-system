import { Button } from "@/components/ui/button";
import { useOperationalLabels } from "@/components/OperationalReadState";

type SourceError = { message: string; data?: { code?: string } | null };

/**
 * A failed read is not an empty result. Access errors (UNAUTHORIZED,
 * FORBIDDEN) are shown without a retry because repeating them cannot help;
 * every other failure offers a retry of the same idempotent read.
 * error.message is never rendered: transport errors, BAD_REQUEST JSON and
 * server diagnostics can carry internal paths or tenant details.
 */
export function SourceErrorAlert({
  error,
  onRetry,
}: {
  error: SourceError;
  onRetry: () => unknown;
}) {
  const l = useOperationalLabels();
  const code = error.data?.code;
  const access = code === "UNAUTHORIZED" || code === "FORBIDDEN";
  return (
    <div role="alert" className="rounded-md border border-destructive/50 p-3">
      {access
        ? l("لا تملك صلاحية الوصول إلى هذه البيانات", "Access denied")
        : l(
            "تعذر تحميل البيانات. حاول مرة أخرى.",
            "Source unavailable. Please try again."
          )}{" "}
      {!access && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void onRetry();
          }}
        >
          {l("إعادة المحاولة", "Retry")}
        </Button>
      )}
    </div>
  );
}

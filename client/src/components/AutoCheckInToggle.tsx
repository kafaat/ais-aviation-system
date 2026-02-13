import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CheckSquare, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface AutoCheckInToggleProps {
  className?: string;
}

export function AutoCheckInToggle({ className = "" }: AutoCheckInToggleProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.travelScenarios.getAutoCheckIn.useQuery();

  const mutation = trpc.travelScenarios.setAutoCheckIn.useMutation({
    onSuccess: result => {
      utils.travelScenarios.getAutoCheckIn.invalidate();
      toast.success(
        result.autoCheckIn
          ? t("autoCheckIn.enabled")
          : t("autoCheckIn.disabled")
      );
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  return (
    <Card
      className={`p-4 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/30 border-violet-200 dark:border-violet-800 ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center flex-shrink-0">
          <CheckSquare className="h-5 w-5 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-semibold text-violet-900 dark:text-violet-200 text-sm">
                {t("autoCheckIn.title")}
              </h4>
              <p className="text-xs text-violet-600 dark:text-violet-400 mt-1">
                {t("autoCheckIn.description")}
              </p>
            </div>
            {isLoading || mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
            ) : (
              <Switch
                id="auto-check-in"
                checked={data?.autoCheckIn ?? false}
                onCheckedChange={checked => {
                  mutation.mutate({ enabled: checked });
                }}
              />
            )}
          </div>
          <Label htmlFor="auto-check-in" className="sr-only">
            {t("autoCheckIn.title")}
          </Label>
        </div>
      </div>
    </Card>
  );
}

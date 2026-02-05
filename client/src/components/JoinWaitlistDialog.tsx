/**
 * JoinWaitlistDialog Component
 * Dialog for joining the waitlist for a fully booked flight
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Clock, Users, Loader2, Bell, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { getLoginUrl } from "@/const";

interface JoinWaitlistDialogProps {
  flightId: number;
  flightNumber: string;
  originCity: string;
  destinationCity: string;
  departureTime: Date;
  cabinClass?: "economy" | "business";
  onSuccess?: () => void;
  triggerButton?: React.ReactNode;
}

export function JoinWaitlistDialog({
  flightId,
  flightNumber,
  originCity,
  destinationCity,
  departureTime,
  cabinClass: initialCabinClass = "economy",
  onSuccess,
  triggerButton,
}: JoinWaitlistDialogProps) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [passengers, setPassengers] = useState("1");
  const [cabinClass, setCabinClass] = useState<"economy" | "business">(
    initialCabinClass
  );
  const [notifyByEmail, setNotifyByEmail] = useState(true);
  const [notifyBySms, setNotifyBySms] = useState(false);
  const [success, setSuccess] = useState(false);
  const [position, setPosition] = useState<number | null>(null);

  const joinWaitlist = trpc.waitlist.join.useMutation({
    onSuccess: data => {
      setSuccess(true);
      setPosition(data.position);
      toast.success(t("waitlist.joinSuccess"));
      onSuccess?.();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const handleJoin = () => {
    if (!isAuthenticated) {
      window.location.href = getLoginUrl();
      return;
    }

    joinWaitlist.mutate({
      flightId,
      passengers: parseInt(passengers),
      cabinClass,
    });
  };

  const handleClose = () => {
    setOpen(false);
    // Reset state after close animation
    setTimeout(() => {
      setSuccess(false);
      setPosition(null);
    }, 200);
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button variant="outline" className="w-full">
            <Clock className="h-4 w-4 mr-2" />
            {t("waitlist.joinWaitlist")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        {success ? (
          // Success state
          <div className="py-8 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h3 className="text-xl font-bold mb-2">
              {t("waitlist.joinedSuccessfully")}
            </h3>
            <p className="text-muted-foreground mb-4">
              {t("waitlist.positionMessage", { position })}
            </p>
            <div className="bg-muted/50 rounded-lg p-4 mb-6">
              <p className="text-sm text-muted-foreground">
                {t("waitlist.notificationMessage")}
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={handleClose}>
                {t("common.cancel")}
              </Button>
              <Button asChild>
                <a href="/my-waitlist">{t("waitlist.viewMyWaitlist")}</a>
              </Button>
            </div>
          </div>
        ) : (
          // Form state
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                {t("waitlist.joinWaitlist")}
              </DialogTitle>
              <DialogDescription>
                {t("waitlist.joinDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* Flight Info */}
              <div className="bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-800/50 dark:to-blue-900/20 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t("booking.flightNumber")}
                  </span>
                  <span className="font-bold">{flightNumber}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t("booking.route")}
                  </span>
                  <span className="font-medium">
                    {originCity} - {destinationCity}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t("myBookings.departureDate")}
                  </span>
                  <span className="font-medium">
                    {formatDate(departureTime)}
                  </span>
                </div>
              </div>

              {/* Passengers */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  {t("booking.passengers")}
                </Label>
                <Select value={passengers} onValueChange={setPassengers}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                      <SelectItem key={num} value={num.toString()}>
                        {num}{" "}
                        {num === 1
                          ? t("waitlist.passenger")
                          : t("waitlist.passengers")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Cabin Class */}
              <div className="space-y-2">
                <Label>{t("filters.cabinClass")}</Label>
                <RadioGroup
                  value={cabinClass}
                  onValueChange={(value: "economy" | "business") =>
                    setCabinClass(value)
                  }
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="economy" id="wl-economy" />
                    <Label
                      htmlFor="wl-economy"
                      className="font-normal cursor-pointer"
                    >
                      {t("cabin.economy")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="business" id="wl-business" />
                    <Label
                      htmlFor="wl-business"
                      className="font-normal cursor-pointer"
                    >
                      {t("cabin.business")}
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Notification Preferences */}
              <div className="space-y-4">
                <Label className="flex items-center gap-2">
                  <Bell className="h-4 w-4" />
                  {t("waitlist.notificationPreferences")}
                </Label>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {t("profile.notifications.email")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("waitlist.emailNotificationDesc")}
                      </p>
                    </div>
                    <Switch
                      checked={notifyByEmail}
                      onCheckedChange={setNotifyByEmail}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {t("profile.notifications.sms")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("waitlist.smsNotificationDesc")}
                      </p>
                    </div>
                    <Switch
                      checked={notifyBySms}
                      onCheckedChange={setNotifyBySms}
                    />
                  </div>
                </div>
              </div>

              {/* Info Box */}
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  {t("waitlist.howItWorks")}
                </p>
                <ul className="mt-2 text-sm text-amber-700 dark:text-amber-300 list-disc list-inside space-y-1">
                  <li>{t("waitlist.step1")}</li>
                  <li>{t("waitlist.step2")}</li>
                  <li>{t("waitlist.step3")}</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleJoin} disabled={joinWaitlist.isPending}>
                {joinWaitlist.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Clock className="h-4 w-4 mr-2" />
                )}
                {t("waitlist.joinWaitlist")}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default JoinWaitlistDialog;

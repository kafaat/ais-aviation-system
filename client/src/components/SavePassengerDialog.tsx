/**
 * SavePassengerDialog Component
 * Dialog for saving a new passenger profile
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { UserPlus, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

interface PassengerFormData {
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
  nationality?: string;
  passportNumber?: string;
  passportExpiry?: Date;
  email?: string;
  phone?: string;
}

interface SavePassengerDialogProps {
  onSuccess?: () => void;
  triggerButton?: React.ReactNode;
  initialData?: PassengerFormData;
  mode?: "create" | "edit";
  passengerId?: number;
}

export function SavePassengerDialog({
  onSuccess,
  triggerButton,
  initialData,
  mode = "create",
  passengerId,
}: SavePassengerDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState(initialData?.firstName || "");
  const [lastName, setLastName] = useState(initialData?.lastName || "");
  const [dateOfBirth, setDateOfBirth] = useState(
    initialData?.dateOfBirth
      ? initialData.dateOfBirth.toISOString().split("T")[0]
      : ""
  );
  const [nationality, setNationality] = useState(
    initialData?.nationality || ""
  );
  const [passportNumber, setPassportNumber] = useState(
    initialData?.passportNumber || ""
  );
  const [passportExpiry, setPassportExpiry] = useState(
    initialData?.passportExpiry
      ? initialData.passportExpiry.toISOString().split("T")[0]
      : ""
  );
  const [email, setEmail] = useState(initialData?.email || "");
  const [phone, setPhone] = useState(initialData?.phone || "");
  const [isDefault, setIsDefault] = useState(false);

  const utils = trpc.useUtils();

  const addPassenger = trpc.savedPassengers.add.useMutation({
    onSuccess: () => {
      toast.success(t("savedPassengers.saveSuccess"));
      utils.savedPassengers.getAll.invalidate();
      setOpen(false);
      resetForm();
      onSuccess?.();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const updatePassenger = trpc.savedPassengers.update.useMutation({
    onSuccess: () => {
      toast.success(t("savedPassengers.updateSuccess"));
      utils.savedPassengers.getAll.invalidate();
      setOpen(false);
      onSuccess?.();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setDateOfBirth("");
    setNationality("");
    setPassportNumber("");
    setPassportExpiry("");
    setEmail("");
    setPhone("");
    setIsDefault(false);
  };

  const handleSubmit = () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error(t("savedPassengers.nameRequired"));
      return;
    }

    const data = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      nationality: nationality.trim() || undefined,
      passportNumber: passportNumber.trim() || undefined,
      passportExpiry: passportExpiry ? new Date(passportExpiry) : undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      isDefault,
    };

    if (mode === "edit" && passengerId) {
      updatePassenger.mutate({ id: passengerId, data });
    } else {
      addPassenger.mutate(data);
    }
  };

  const isPending = addPassenger.isPending || updatePassenger.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button variant="outline" size="sm">
            <UserPlus className="h-4 w-4 mr-2" />
            {t("savedPassengers.addNew")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            {mode === "edit"
              ? t("savedPassengers.editPassenger")
              : t("savedPassengers.addNewPassenger")}
          </DialogTitle>
          <DialogDescription>
            {t("savedPassengers.dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">{t("booking.firstName")} *</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder={t("booking.firstName")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">{t("booking.lastName")} *</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder={t("booking.lastName")}
              />
            </div>
          </div>

          {/* Date of Birth */}
          <div className="space-y-2">
            <Label htmlFor="dateOfBirth">
              {t("savedPassengers.dateOfBirth")}
            </Label>
            <Input
              id="dateOfBirth"
              type="date"
              value={dateOfBirth}
              onChange={e => setDateOfBirth(e.target.value)}
            />
          </div>

          {/* Nationality */}
          <div className="space-y-2">
            <Label htmlFor="nationality">{t("booking.nationality")}</Label>
            <Input
              id="nationality"
              value={nationality}
              onChange={e => setNationality(e.target.value)}
              placeholder={t("profile.personal.nationalityPlaceholder")}
            />
          </div>

          {/* Passport */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="passportNumber">
                {t("profile.personal.passportNumber")}
              </Label>
              <Input
                id="passportNumber"
                value={passportNumber}
                onChange={e => setPassportNumber(e.target.value)}
                placeholder={t("profile.personal.passportPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="passportExpiry">
                {t("profile.personal.passportExpiry")}
              </Label>
              <Input
                id="passportExpiry"
                type="date"
                value={passportExpiry}
                onChange={e => setPassportExpiry(e.target.value)}
              />
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("savedPassengers.email")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t("footer.email")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">{t("profile.personal.phone")}</Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder={t("footer.phone")}
              />
            </div>
          </div>

          {/* Default checkbox */}
          <div className="flex items-center space-x-2 pt-2">
            <Checkbox
              id="isDefault"
              checked={isDefault}
              onCheckedChange={(checked: boolean) => setIsDefault(checked)}
            />
            <Label htmlFor="isDefault" className="font-normal cursor-pointer">
              {t("savedPassengers.setAsDefault")}
            </Label>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {mode === "edit" ? t("common.save") : t("savedPassengers.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SavePassengerDialog;

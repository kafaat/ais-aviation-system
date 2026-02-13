/**
 * SavedPassengerSelect Component
 * Dropdown to select a saved passenger and auto-fill form fields
 */

import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { User, Star } from "lucide-react";

export interface PassengerData {
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
  nationality?: string;
  passportNumber?: string;
  passportExpiry?: Date;
  email?: string;
  phone?: string;
}

interface SavedPassengerSelectProps {
  onSelect: (passenger: PassengerData | null) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function SavedPassengerSelect({
  onSelect,
  disabled = false,
  placeholder,
}: SavedPassengerSelectProps) {
  const { t } = useTranslation();
  const { data: savedPassengers, isLoading } =
    trpc.savedPassengers.getAll.useQuery();

  const handleSelect = (value: string) => {
    if (value === "none") {
      onSelect(null);
      return;
    }

    const passenger = savedPassengers?.find(p => p.id.toString() === value);
    if (passenger) {
      onSelect({
        firstName: passenger.firstName,
        lastName: passenger.lastName,
        dateOfBirth: passenger.dateOfBirth || undefined,
        nationality: passenger.nationality || undefined,
        passportNumber: passenger.passportNumber || undefined,
        passportExpiry: passenger.passportExpiry || undefined,
        email: passenger.email || undefined,
        phone: passenger.phone || undefined,
      });
    }
  };

  if (isLoading) {
    return <Skeleton className="h-10 w-full" />;
  }

  if (!savedPassengers || savedPassengers.length === 0) {
    return null;
  }

  return (
    <Select onValueChange={handleSelect} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue
          placeholder={placeholder || t("savedPassengers.selectSaved")}
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">
          <div className="flex items-center gap-2 text-muted-foreground">
            <User className="h-4 w-4" />
            {t("savedPassengers.enterManually")}
          </div>
        </SelectItem>
        {savedPassengers.map(passenger => (
          <SelectItem key={passenger.id} value={passenger.id.toString()}>
            <div className="flex items-center gap-2">
              {passenger.isDefault && (
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              )}
              <span className="font-medium">
                {passenger.firstName} {passenger.lastName}
              </span>
              {passenger.passportNumber && (
                <span className="text-muted-foreground text-sm">
                  ({passenger.passportNumber})
                </span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default SavedPassengerSelect;

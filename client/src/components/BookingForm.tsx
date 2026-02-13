/**
 * BookingForm Component
 *
 * Handles passenger information collection for flight bookings.
 * Supports multiple passengers with validation.
 */

import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

export type PassengerType = "adult" | "child" | "infant";
export type TitleType = "Mr" | "Mrs" | "Ms";

export interface Passenger {
  type: PassengerType;
  title?: TitleType | string;
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
  passportNumber?: string;
  nationality?: string;
}

export interface BookingFormProps {
  passengers: Passenger[];
  onPassengerChange: (
    index: number,
    field: keyof Passenger,
    value: Passenger[keyof Passenger]
  ) => void;
  onAddPassenger: () => void;
  onRemovePassenger: (index: number) => void;
  disabled?: boolean;
}

export function BookingForm({
  passengers,
  onPassengerChange,
  onAddPassenger,
  onRemovePassenger,
  disabled = false,
}: BookingFormProps) {
  const { t } = useTranslation();

  return (
    <Card className="p-6" data-testid="booking-form">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold" data-testid="form-title">
          {t("booking.passengerInfo")}
        </h2>
        <Button
          onClick={onAddPassenger}
          variant="outline"
          size="sm"
          disabled={disabled}
          data-testid="add-passenger-button"
        >
          <Plus className="h-4 w-4 me-2" />
          {t("booking.addPassenger")}
        </Button>
      </div>

      <div className="space-y-6" data-testid="passengers-list">
        {passengers.map((passenger, index) => (
          <div
            key={index}
            className="p-4 border rounded-lg hover:border-primary/30 transition-colors"
            data-testid={`passenger-form-${index}`}
          >
            <div className="flex items-center justify-between mb-4">
              <h3
                className="font-medium"
                data-testid={`passenger-header-${index}`}
              >
                {t("booking.passenger")} {index + 1}
              </h3>
              {passengers.length > 1 && (
                <Button
                  onClick={() => onRemovePassenger(index)}
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={disabled}
                  data-testid={`remove-passenger-${index}`}
                  aria-label={`${t("booking.removePassenger")} ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Passenger Type */}
              <div className="space-y-2">
                <Label htmlFor={`passenger-type-${index}`}>
                  {t("booking.passengerType")}
                </Label>
                <Select
                  value={passenger.type}
                  onValueChange={(value: PassengerType) =>
                    onPassengerChange(index, "type", value)
                  }
                  disabled={disabled}
                >
                  <SelectTrigger
                    id={`passenger-type-${index}`}
                    data-testid={`passenger-type-${index}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="adult">{t("booking.adult")}</SelectItem>
                    <SelectItem value="child">{t("booking.child")}</SelectItem>
                    <SelectItem value="infant">
                      {t("booking.infant")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor={`passenger-title-${index}`}>
                  {t("booking.honorific")}
                </Label>
                <Select
                  value={passenger.title || ""}
                  onValueChange={value =>
                    onPassengerChange(index, "title", value)
                  }
                  disabled={disabled}
                >
                  <SelectTrigger
                    id={`passenger-title-${index}`}
                    data-testid={`passenger-title-${index}`}
                  >
                    <SelectValue placeholder={t("common.search")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Mr">{t("booking.mr")}</SelectItem>
                    <SelectItem value="Mrs">{t("booking.mrs")}</SelectItem>
                    <SelectItem value="Ms">{t("booking.ms")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* First Name */}
              <div className="space-y-2">
                <Label htmlFor={`passenger-firstname-${index}`}>
                  {t("booking.firstName")}
                </Label>
                <Input
                  id={`passenger-firstname-${index}`}
                  value={passenger.firstName}
                  onChange={e =>
                    onPassengerChange(index, "firstName", e.target.value)
                  }
                  placeholder={t("booking.firstName")}
                  disabled={disabled}
                  data-testid={`passenger-firstname-${index}`}
                  required
                />
              </div>

              {/* Last Name */}
              <div className="space-y-2">
                <Label htmlFor={`passenger-lastname-${index}`}>
                  {t("booking.lastName")}
                </Label>
                <Input
                  id={`passenger-lastname-${index}`}
                  value={passenger.lastName}
                  onChange={e =>
                    onPassengerChange(index, "lastName", e.target.value)
                  }
                  placeholder={t("booking.lastName")}
                  disabled={disabled}
                  data-testid={`passenger-lastname-${index}`}
                  required
                />
              </div>

              {/* Passport Number */}
              <div className="space-y-2">
                <Label htmlFor={`passenger-passport-${index}`}>
                  {t("booking.passportNumber")}
                </Label>
                <Input
                  id={`passenger-passport-${index}`}
                  value={passenger.passportNumber || ""}
                  onChange={e =>
                    onPassengerChange(index, "passportNumber", e.target.value)
                  }
                  placeholder={t("booking.passportNumber")}
                  disabled={disabled}
                  data-testid={`passenger-passport-${index}`}
                />
              </div>

              {/* Nationality */}
              <div className="space-y-2">
                <Label htmlFor={`passenger-nationality-${index}`}>
                  {t("booking.nationality")}
                </Label>
                <Input
                  id={`passenger-nationality-${index}`}
                  value={passenger.nationality || ""}
                  onChange={e =>
                    onPassengerChange(index, "nationality", e.target.value)
                  }
                  placeholder={t("booking.nationality")}
                  disabled={disabled}
                  data-testid={`passenger-nationality-${index}`}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default BookingForm;

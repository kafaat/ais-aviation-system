/**
 * UserProfileForm Component
 *
 * A form component for managing user preferences including:
 * - Travel preferences (seat, cabin class, meal)
 * - Personal information (passport, contact)
 * - Notification settings
 */

import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Save, Loader2, Plane, Settings, Bell } from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

export type SeatType = "window" | "aisle" | "middle";
export type CabinClass = "economy" | "business" | "first";
export type MealPreference =
  | "regular"
  | "vegetarian"
  | "vegan"
  | "halal"
  | "kosher"
  | "gluten_free";

export interface UserPreferencesFormData {
  preferredSeatType: SeatType;
  preferredCabinClass: CabinClass;
  mealPreference: MealPreference;
  wheelchairAssistance: boolean;
  extraLegroom: boolean;
  passportNumber: string;
  passportExpiry: Date | undefined;
  nationality: string;
  phoneNumber: string;
  emergencyContact: string;
  emergencyPhone: string;
  emailNotifications: boolean;
  smsNotifications: boolean;
}

export interface UserProfileFormProps {
  formData: UserPreferencesFormData;
  onFormDataChange: (data: UserPreferencesFormData) => void;
  onSave: () => void;
  isSaving?: boolean;
  userEmail?: string;
}

export function UserProfileForm({
  formData,
  onFormDataChange,
  onSave,
  isSaving = false,
  userEmail,
}: UserProfileFormProps) {
  const { t, i18n } = useTranslation();

  const updateField = <K extends keyof UserPreferencesFormData>(
    field: K,
    value: UserPreferencesFormData[K]
  ) => {
    onFormDataChange({ ...formData, [field]: value });
  };

  return (
    <div className="space-y-6" data-testid="user-profile-form">
      {/* User Email Display */}
      {userEmail && (
        <p className="text-sm text-muted-foreground" data-testid="user-email">
          {userEmail}
        </p>
      )}

      <Tabs defaultValue="travel" className="space-y-6" data-testid="profile-tabs">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="travel" data-testid="tab-travel">
            <Plane className="h-4 w-4 mr-2" />
            {t("profile.tabs.travel")}
          </TabsTrigger>
          <TabsTrigger value="personal" data-testid="tab-personal">
            <Settings className="h-4 w-4 mr-2" />
            {t("profile.tabs.personal")}
          </TabsTrigger>
          <TabsTrigger value="notifications" data-testid="tab-notifications">
            <Bell className="h-4 w-4 mr-2" />
            {t("profile.tabs.notifications")}
          </TabsTrigger>
        </TabsList>

        {/* Travel Preferences Tab */}
        <TabsContent value="travel" data-testid="tab-content-travel">
          <Card>
            <CardHeader>
              <CardTitle>{t("profile.travel.title")}</CardTitle>
              <CardDescription>{t("profile.travel.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Seat Preference */}
              <div className="space-y-2">
                <Label htmlFor="seat-preference">{t("profile.travel.preferredSeat")}</Label>
                <Select
                  value={formData.preferredSeatType}
                  onValueChange={(value: SeatType) =>
                    updateField("preferredSeatType", value)
                  }
                >
                  <SelectTrigger id="seat-preference" data-testid="seat-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="window">{t("profile.travel.window")}</SelectItem>
                    <SelectItem value="aisle">{t("profile.travel.aisle")}</SelectItem>
                    <SelectItem value="middle">{t("profile.travel.middle")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Cabin Class */}
              <div className="space-y-2">
                <Label htmlFor="cabin-class">{t("profile.travel.preferredClass")}</Label>
                <Select
                  value={formData.preferredCabinClass}
                  onValueChange={(value: CabinClass) =>
                    updateField("preferredCabinClass", value)
                  }
                >
                  <SelectTrigger id="cabin-class" data-testid="cabin-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="economy">{t("profile.travel.economy")}</SelectItem>
                    <SelectItem value="business">{t("profile.travel.business")}</SelectItem>
                    <SelectItem value="first">{t("profile.travel.first")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Meal Preference */}
              <div className="space-y-2">
                <Label htmlFor="meal-preference">{t("profile.travel.mealPreference")}</Label>
                <Select
                  value={formData.mealPreference}
                  onValueChange={(value: MealPreference) =>
                    updateField("mealPreference", value)
                  }
                >
                  <SelectTrigger id="meal-preference" data-testid="meal-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regular">{t("profile.travel.meals.regular")}</SelectItem>
                    <SelectItem value="vegetarian">{t("profile.travel.meals.vegetarian")}</SelectItem>
                    <SelectItem value="vegan">{t("profile.travel.meals.vegan")}</SelectItem>
                    <SelectItem value="halal">{t("profile.travel.meals.halal")}</SelectItem>
                    <SelectItem value="kosher">{t("profile.travel.meals.kosher")}</SelectItem>
                    <SelectItem value="gluten_free">{t("profile.travel.meals.glutenFree")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Special Services */}
              <div className="space-y-4">
                <Label>{t("profile.travel.specialServices")}</Label>
                <div className="flex items-center justify-between" data-testid="wheelchair-toggle">
                  <span className="text-sm">{t("profile.travel.wheelchair")}</span>
                  <Switch
                    checked={formData.wheelchairAssistance}
                    onCheckedChange={(checked) =>
                      updateField("wheelchairAssistance", checked)
                    }
                    data-testid="wheelchair-switch"
                  />
                </div>
                <div className="flex items-center justify-between" data-testid="legroom-toggle">
                  <span className="text-sm">{t("profile.travel.extraLegroom")}</span>
                  <Switch
                    checked={formData.extraLegroom}
                    onCheckedChange={(checked) =>
                      updateField("extraLegroom", checked)
                    }
                    data-testid="legroom-switch"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Personal Information Tab */}
        <TabsContent value="personal" data-testid="tab-content-personal">
          <Card>
            <CardHeader>
              <CardTitle>{t("profile.personal.title")}</CardTitle>
              <CardDescription>{t("profile.personal.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Passport Number */}
              <div className="space-y-2">
                <Label htmlFor="passport-number">{t("profile.personal.passportNumber")}</Label>
                <Input
                  id="passport-number"
                  value={formData.passportNumber}
                  onChange={(e) => updateField("passportNumber", e.target.value)}
                  placeholder={t("profile.personal.passportPlaceholder")}
                  data-testid="passport-input"
                />
              </div>

              {/* Passport Expiry */}
              <div className="space-y-2">
                <Label>{t("profile.personal.passportExpiry")}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left"
                      data-testid="passport-expiry-button"
                    >
                      {formData.passportExpiry
                        ? format(formData.passportExpiry, "PPP", {
                            locale: i18n.language === "ar" ? ar : undefined,
                          })
                        : t("profile.personal.selectDate")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={formData.passportExpiry}
                      onSelect={(date) => updateField("passportExpiry", date)}
                      data-testid="passport-expiry-calendar"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Nationality */}
              <div className="space-y-2">
                <Label htmlFor="nationality">{t("profile.personal.nationality")}</Label>
                <Input
                  id="nationality"
                  value={formData.nationality}
                  onChange={(e) => updateField("nationality", e.target.value)}
                  placeholder={t("profile.personal.nationalityPlaceholder")}
                  data-testid="nationality-input"
                />
              </div>

              {/* Phone Number */}
              <div className="space-y-2">
                <Label htmlFor="phone">{t("profile.personal.phone")}</Label>
                <Input
                  id="phone"
                  value={formData.phoneNumber}
                  onChange={(e) => updateField("phoneNumber", e.target.value)}
                  placeholder="+966 5X XXX XXXX"
                  data-testid="phone-input"
                />
              </div>

              {/* Emergency Contact */}
              <div className="space-y-2">
                <Label htmlFor="emergency-contact">{t("profile.personal.emergencyContact")}</Label>
                <Input
                  id="emergency-contact"
                  value={formData.emergencyContact}
                  onChange={(e) => updateField("emergencyContact", e.target.value)}
                  placeholder={t("profile.personal.emergencyContactPlaceholder")}
                  data-testid="emergency-contact-input"
                />
              </div>

              {/* Emergency Phone */}
              <div className="space-y-2">
                <Label htmlFor="emergency-phone">{t("profile.personal.emergencyPhone")}</Label>
                <Input
                  id="emergency-phone"
                  value={formData.emergencyPhone}
                  onChange={(e) => updateField("emergencyPhone", e.target.value)}
                  placeholder="+966 5X XXX XXXX"
                  data-testid="emergency-phone-input"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" data-testid="tab-content-notifications">
          <Card>
            <CardHeader>
              <CardTitle>{t("profile.notifications.title")}</CardTitle>
              <CardDescription>{t("profile.notifications.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between" data-testid="email-notifications">
                <div>
                  <p className="font-medium">{t("profile.notifications.email")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("profile.notifications.emailDesc")}
                  </p>
                </div>
                <Switch
                  checked={formData.emailNotifications}
                  onCheckedChange={(checked) =>
                    updateField("emailNotifications", checked)
                  }
                  data-testid="email-switch"
                />
              </div>

              <div className="flex items-center justify-between" data-testid="sms-notifications">
                <div>
                  <p className="font-medium">{t("profile.notifications.sms")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("profile.notifications.smsDesc")}
                  </p>
                </div>
                <Switch
                  checked={formData.smsNotifications}
                  onCheckedChange={(checked) =>
                    updateField("smsNotifications", checked)
                  }
                  data-testid="sms-switch"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button
          onClick={onSave}
          disabled={isSaving}
          size="lg"
          data-testid="save-button"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {t("common.loading")}
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              {t("common.save")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export default UserProfileForm;

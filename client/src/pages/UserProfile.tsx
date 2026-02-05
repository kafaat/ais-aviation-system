import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { toast } from "sonner";
import { User, Settings, Bell, Plane, Save, Loader2 } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

type SeatType = "window" | "aisle" | "middle";
type CabinClass = "economy" | "business" | "first";
type MealPreference = "regular" | "vegetarian" | "vegan" | "halal" | "kosher" | "gluten_free";

export default function UserProfile() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const { data: preferences, isLoading } =
    trpc.userPreferences.getMyPreferences.useQuery();
  const updatePreferences =
    trpc.userPreferences.updateMyPreferences.useMutation({
      onSuccess: () => {
        utils.userPreferences.getMyPreferences.invalidate();
        toast.success(t("profile.updateSuccess"));
      },
      onError: error => {
        toast.error(t("common.error") + ": " + error.message);
      },
    });

  const [formData, setFormData] = useState({
    preferredSeatType: preferences?.preferredSeatType || "window",
    preferredCabinClass: preferences?.preferredCabinClass || "economy",
    mealPreference: preferences?.mealPreference || "regular",
    wheelchairAssistance: preferences?.wheelchairAssistance || false,
    extraLegroom: preferences?.extraLegroom || false,
    passportNumber: preferences?.passportNumber || "",
    passportExpiry: preferences?.passportExpiry || undefined,
    nationality: preferences?.nationality || "",
    phoneNumber: preferences?.phoneNumber || "",
    emergencyContact: preferences?.emergencyContact || "",
    emergencyPhone: preferences?.emergencyPhone || "",
    emailNotifications: preferences?.emailNotifications ?? true,
    smsNotifications: preferences?.smsNotifications ?? false,
  });

  // Update formData when preferences load
  useEffect(() => {
    if (preferences) {
      setFormData({
        preferredSeatType: preferences.preferredSeatType || "window",
        preferredCabinClass: preferences.preferredCabinClass || "economy",
        mealPreference: preferences.mealPreference || "regular",
        wheelchairAssistance: preferences.wheelchairAssistance || false,
        extraLegroom: preferences.extraLegroom || false,
        passportNumber: preferences.passportNumber || "",
        passportExpiry: preferences.passportExpiry || undefined,
        nationality: preferences.nationality || "",
        phoneNumber: preferences.phoneNumber || "",
        emergencyContact: preferences.emergencyContact || "",
        emergencyPhone: preferences.emergencyPhone || "",
        emailNotifications: preferences.emailNotifications ?? true,
        smsNotifications: preferences.smsNotifications ?? false,
      });
    }
  }, [preferences]);

  const handleSave = () => {
    updatePreferences.mutate(formData);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="container py-6">
          <div className="flex items-center gap-3">
            <User className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">{t("profile.title")}</h1>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="container py-8">
        <Tabs defaultValue="travel" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="travel">
              <Plane className="h-4 w-4 mr-2" />
              {t("profile.tabs.travel")}
            </TabsTrigger>
            <TabsTrigger value="personal">
              <Settings className="h-4 w-4 mr-2" />
              {t("profile.tabs.personal")}
            </TabsTrigger>
            <TabsTrigger value="notifications">
              <Bell className="h-4 w-4 mr-2" />
              {t("profile.tabs.notifications")}
            </TabsTrigger>
          </TabsList>

          {/* Travel Preferences */}
          <TabsContent value="travel">
            <Card>
              <CardHeader>
                <CardTitle>{t("profile.travel.title")}</CardTitle>
                <CardDescription>
                  {t("profile.travel.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Seat Preference */}
                <div className="space-y-2">
                  <Label>{t("profile.travel.preferredSeat")}</Label>
                  <Select
                    value={formData.preferredSeatType}
                    onValueChange={(value: string) =>
                      setFormData({
                        ...formData,
                        preferredSeatType: value as SeatType,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="window">
                        {t("profile.travel.window")}
                      </SelectItem>
                      <SelectItem value="aisle">
                        {t("profile.travel.aisle")}
                      </SelectItem>
                      <SelectItem value="middle">
                        {t("profile.travel.middle")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Cabin Class */}
                <div className="space-y-2">
                  <Label>{t("profile.travel.preferredClass")}</Label>
                  <Select
                    value={formData.preferredCabinClass}
                    onValueChange={(value: string) =>
                      setFormData({
                        ...formData,
                        preferredCabinClass: value as CabinClass,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="economy">
                        {t("profile.travel.economy")}
                      </SelectItem>
                      <SelectItem value="business">
                        {t("profile.travel.business")}
                      </SelectItem>
                      <SelectItem value="first">
                        {t("profile.travel.first")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Meal Preference */}
                <div className="space-y-2">
                  <Label>{t("profile.travel.mealPreference")}</Label>
                  <Select
                    value={formData.mealPreference}
                    onValueChange={(value: string) =>
                      setFormData({ ...formData, mealPreference: value as MealPreference })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="regular">
                        {t("profile.travel.meals.regular")}
                      </SelectItem>
                      <SelectItem value="vegetarian">
                        {t("profile.travel.meals.vegetarian")}
                      </SelectItem>
                      <SelectItem value="vegan">
                        {t("profile.travel.meals.vegan")}
                      </SelectItem>
                      <SelectItem value="halal">
                        {t("profile.travel.meals.halal")}
                      </SelectItem>
                      <SelectItem value="kosher">
                        {t("profile.travel.meals.kosher")}
                      </SelectItem>
                      <SelectItem value="gluten_free">
                        {t("profile.travel.meals.glutenFree")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Special Services */}
                <div className="space-y-4">
                  <Label>{t("profile.travel.specialServices")}</Label>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      {t("profile.travel.wheelchair")}
                    </span>
                    <Switch
                      checked={formData.wheelchairAssistance}
                      onCheckedChange={checked =>
                        setFormData({
                          ...formData,
                          wheelchairAssistance: checked,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      {t("profile.travel.extraLegroom")}
                    </span>
                    <Switch
                      checked={formData.extraLegroom}
                      onCheckedChange={checked =>
                        setFormData({ ...formData, extraLegroom: checked })
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Personal Information */}
          <TabsContent value="personal">
            <Card>
              <CardHeader>
                <CardTitle>{t("profile.personal.title")}</CardTitle>
                <CardDescription>
                  {t("profile.personal.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Passport Info */}
                <div className="space-y-4">
                  <Label className="text-base font-semibold">
                    {t("profile.personal.passport")}
                  </Label>

                  <div className="space-y-2">
                    <Label>{t("profile.personal.passportNumber")}</Label>
                    <Input
                      value={formData.passportNumber}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          passportNumber: e.target.value,
                        })
                      }
                      placeholder={t("profile.personal.passportPlaceholder")}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{t("profile.personal.passportExpiry")}</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start text-left"
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
                          onSelect={date =>
                            setFormData({ ...formData, passportExpiry: date })
                          }
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-2">
                    <Label>{t("profile.personal.nationality")}</Label>
                    <Input
                      value={formData.nationality}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          nationality: e.target.value,
                        })
                      }
                      placeholder={t("profile.personal.nationalityPlaceholder")}
                    />
                  </div>
                </div>

                {/* Contact Info */}
                <div className="space-y-4">
                  <Label className="text-base font-semibold">
                    {t("profile.personal.contact")}
                  </Label>

                  <div className="space-y-2">
                    <Label>{t("profile.personal.phone")}</Label>
                    <Input
                      value={formData.phoneNumber}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          phoneNumber: e.target.value,
                        })
                      }
                      placeholder="+966 5X XXX XXXX"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{t("profile.personal.emergencyContact")}</Label>
                    <Input
                      value={formData.emergencyContact}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          emergencyContact: e.target.value,
                        })
                      }
                      placeholder={t(
                        "profile.personal.emergencyContactPlaceholder"
                      )}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{t("profile.personal.emergencyPhone")}</Label>
                    <Input
                      value={formData.emergencyPhone}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          emergencyPhone: e.target.value,
                        })
                      }
                      placeholder="+966 5X XXX XXXX"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications */}
          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle>{t("profile.notifications.title")}</CardTitle>
                <CardDescription>
                  {t("profile.notifications.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {t("profile.notifications.email")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t("profile.notifications.emailDesc")}
                    </p>
                  </div>
                  <Switch
                    checked={formData.emailNotifications}
                    onCheckedChange={checked =>
                      setFormData({ ...formData, emailNotifications: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {t("profile.notifications.sms")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t("profile.notifications.smsDesc")}
                    </p>
                  </div>
                  <Switch
                    checked={formData.smsNotifications}
                    onCheckedChange={checked =>
                      setFormData({ ...formData, smsNotifications: checked })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Save Button */}
        <div className="flex justify-end mt-6">
          <Button
            onClick={handleSave}
            disabled={updatePreferences.isPending}
            size="lg"
          >
            {updatePreferences.isPending ? (
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
    </div>
  );
}

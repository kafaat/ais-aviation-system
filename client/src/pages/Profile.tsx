import { useState, useEffect, useRef } from "react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ProfileSkeleton } from "@/components/skeletons";
import { AutoCheckInToggle } from "@/components/AutoCheckInToggle";
import { toast } from "sonner";
import {
  User,
  Settings,
  Bell,
  Plane,
  Save,
  Loader2,
  Camera,
  Mail,
  Phone,
  Shield,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { cn } from "@/lib/utils";

type SeatType = "window" | "aisle" | "middle";
type CabinClass = "economy" | "business" | "first";
type MealPreference =
  | "regular"
  | "vegetarian"
  | "vegan"
  | "halal"
  | "kosher"
  | "gluten_free";

interface FormErrors {
  passportNumber?: string;
  phoneNumber?: string;
  emergencyPhone?: string;
  nationality?: string;
}

export default function Profile() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [activeTab, setActiveTab] = useState("travel");

  const { data: preferences, isLoading } =
    trpc.userPreferences.getMyPreferences.useQuery();

  const updatePreferences =
    trpc.userPreferences.updateMyPreferences.useMutation({
      onSuccess: () => {
        utils.userPreferences.getMyPreferences.invalidate();
        toast.success(t("profile.updateSuccess"), {
          icon: <CheckCircle2 className="h-4 w-4 text-green-500" />,
        });
      },
      onError: error => {
        toast.error(t("profile.updateError") + ": " + error.message, {
          icon: <AlertCircle className="h-4 w-4 text-red-500" />,
        });
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

  // Validation function
  const validateForm = (): boolean => {
    const errors: FormErrors = {};

    // Passport number validation (alphanumeric, 6-12 characters)
    if (
      formData.passportNumber &&
      !/^[A-Za-z0-9]{6,12}$/.test(formData.passportNumber)
    ) {
      errors.passportNumber = t("profile.validation.invalidPassport");
    }

    // Phone number validation (basic international format)
    if (
      formData.phoneNumber &&
      !/^\+?[0-9\s-]{8,15}$/.test(formData.phoneNumber)
    ) {
      errors.phoneNumber = t("profile.validation.invalidPhone");
    }

    // Emergency phone validation
    if (
      formData.emergencyPhone &&
      !/^\+?[0-9\s-]{8,15}$/.test(formData.emergencyPhone)
    ) {
      errors.emergencyPhone = t("profile.validation.invalidPhone");
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = () => {
    if (!validateForm()) {
      toast.error(t("profile.validation.pleaseCorrect"), {
        icon: <AlertCircle className="h-4 w-4 text-red-500" />,
      });
      return;
    }
    updatePreferences.mutate(formData);
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith("image/")) {
        toast.error(t("profile.avatar.invalidType"));
        return;
      }
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast.error(t("profile.avatar.tooLarge"));
        return;
      }

      const reader = new FileReader();
      reader.onload = e => {
        setAvatarPreview(e.target?.result as string);
        toast.success(t("profile.avatar.uploadSuccess"));
      };
      reader.readAsDataURL(file);
    }
  };

  const getUserInitials = () => {
    if (!user?.email) return "U";
    return user.email.charAt(0).toUpperCase();
  };

  // Loading skeleton
  if (isLoading) {
    return <ProfileSkeleton />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Header with Gradient */}
      <header className="bg-gradient-to-r from-primary/90 to-primary shadow-lg">
        <div className="container py-8">
          <div className="flex items-center gap-6">
            {/* Avatar with Upload */}
            <div className="relative group">
              <Avatar
                className="h-24 w-24 border-4 border-white/30 shadow-xl"
                data-testid="avatar"
              >
                <AvatarImage src={avatarPreview || undefined} />
                <AvatarFallback className="bg-white/20 text-white text-2xl font-bold">
                  {getUserInitials()}
                </AvatarFallback>
              </Avatar>
              <button
                onClick={handleAvatarClick}
                className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                aria-label={t("profile.avatar.change")}
                data-testid="avatar-upload"
              >
                <Camera className="h-8 w-8 text-white" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>

            {/* User Info */}
            <div className="text-white">
              <h1 className="text-3xl font-bold tracking-tight">
                {t("profile.title")}
              </h1>
              <div className="flex items-center gap-2 mt-2 text-white/80">
                <Mail className="h-4 w-4" />
                <span>{user?.email}</span>
              </div>
              <p className="text-sm text-white/60 mt-1">
                {t("profile.subtitle")}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="container py-8 -mt-4">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-6"
          data-testid="profile-tabs"
        >
          {/* Improved Tabs */}
          <TabsList className="grid w-full grid-cols-3 bg-white/80 backdrop-blur-sm shadow-md rounded-xl p-1.5 h-auto">
            <TabsTrigger
              value="travel"
              className={cn(
                "flex items-center gap-2 py-3 rounded-lg transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary data-[state=active]:to-primary/80 data-[state=active]:text-white data-[state=active]:shadow-md"
              )}
            >
              <Plane className="h-4 w-4" />
              <span className="hidden sm:inline">
                {t("profile.tabs.travel")}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="personal"
              className={cn(
                "flex items-center gap-2 py-3 rounded-lg transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary data-[state=active]:to-primary/80 data-[state=active]:text-white data-[state=active]:shadow-md"
              )}
            >
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">
                {t("profile.tabs.personal")}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="notifications"
              className={cn(
                "flex items-center gap-2 py-3 rounded-lg transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary data-[state=active]:to-primary/80 data-[state=active]:text-white data-[state=active]:shadow-md"
              )}
            >
              <Bell className="h-4 w-4" />
              <span className="hidden sm:inline">
                {t("profile.tabs.notifications")}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Travel Preferences */}
          <TabsContent value="travel">
            <Card className="border-0 shadow-xl bg-white/90 backdrop-blur-sm rounded-2xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-primary/5 to-primary/10 border-b">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Plane className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>{t("profile.travel.title")}</CardTitle>
                    <CardDescription>
                      {t("profile.travel.description")}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
                {/* Seat Preference */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    {t("profile.travel.preferredSeat")}
                  </Label>
                  <Select
                    value={formData.preferredSeatType}
                    onValueChange={(value: string) =>
                      setFormData({
                        ...formData,
                        preferredSeatType: value as SeatType,
                      })
                    }
                  >
                    <SelectTrigger className="bg-white border-gray-200 hover:border-primary/50 transition-colors">
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
                  <Label className="text-sm font-medium">
                    {t("profile.travel.preferredClass")}
                  </Label>
                  <Select
                    value={formData.preferredCabinClass}
                    onValueChange={(value: string) =>
                      setFormData({
                        ...formData,
                        preferredCabinClass: value as CabinClass,
                      })
                    }
                  >
                    <SelectTrigger className="bg-white border-gray-200 hover:border-primary/50 transition-colors">
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
                  <Label className="text-sm font-medium">
                    {t("profile.travel.mealPreference")}
                  </Label>
                  <Select
                    value={formData.mealPreference}
                    onValueChange={(value: string) =>
                      setFormData({
                        ...formData,
                        mealPreference: value as MealPreference,
                      })
                    }
                  >
                    <SelectTrigger className="bg-white border-gray-200 hover:border-primary/50 transition-colors">
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
                <div className="space-y-4 pt-4 border-t">
                  <Label className="text-base font-semibold">
                    {t("profile.travel.specialServices")}
                  </Label>
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <span className="text-sm font-medium">
                        {t("profile.travel.wheelchair")}
                      </span>
                    </div>
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
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <Plane className="h-4 w-4 text-primary" />
                      </div>
                      <span className="text-sm font-medium">
                        {t("profile.travel.extraLegroom")}
                      </span>
                    </div>
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
            <Card className="border-0 shadow-xl bg-white/90 backdrop-blur-sm rounded-2xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-primary/5 to-primary/10 border-b">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Settings className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>{t("profile.personal.title")}</CardTitle>
                    <CardDescription>
                      {t("profile.personal.description")}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
                {/* Passport Info */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-primary" />
                    <Label className="text-base font-semibold">
                      {t("profile.personal.passport")}
                    </Label>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="passportNumber" className="text-sm">
                      {t("profile.personal.passportNumber")}
                    </Label>
                    <div className="relative">
                      <Input
                        id="passportNumber"
                        value={formData.passportNumber}
                        onChange={e =>
                          setFormData({
                            ...formData,
                            passportNumber: e.target.value.toUpperCase(),
                          })
                        }
                        placeholder={t("profile.personal.passportPlaceholder")}
                        aria-invalid={!!formErrors.passportNumber}
                        aria-describedby={
                          formErrors.passportNumber
                            ? "passportNumber-error"
                            : undefined
                        }
                        className={cn(
                          "bg-white border-gray-200 hover:border-primary/50 transition-colors",
                          formErrors.passportNumber &&
                            "border-red-500 focus-visible:ring-red-500"
                        )}
                      />
                      {formErrors.passportNumber && (
                        <div
                          id="passportNumber-error"
                          role="alert"
                          className="flex items-center gap-1 mt-1 text-red-500 text-sm"
                        >
                          <AlertCircle className="h-3 w-3" aria-hidden="true" />
                          <span>{formErrors.passportNumber}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">
                      {t("profile.personal.passportExpiry")}
                    </Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start text-left bg-white border-gray-200 hover:border-primary/50 transition-colors"
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
                    <Label htmlFor="nationality" className="text-sm">
                      {t("profile.personal.nationality")}
                    </Label>
                    <Input
                      id="nationality"
                      value={formData.nationality}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          nationality: e.target.value,
                        })
                      }
                      placeholder={t("profile.personal.nationalityPlaceholder")}
                      className="bg-white border-gray-200 hover:border-primary/50 transition-colors"
                    />
                  </div>
                </div>

                {/* Contact Info */}
                <div className="space-y-4 pt-4 border-t">
                  <div className="flex items-center gap-2">
                    <Phone className="h-5 w-5 text-primary" />
                    <Label className="text-base font-semibold">
                      {t("profile.personal.contact")}
                    </Label>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phoneNumber" className="text-sm">
                      {t("profile.personal.phone")}
                    </Label>
                    <div className="relative">
                      <Input
                        id="phoneNumber"
                        value={formData.phoneNumber}
                        onChange={e =>
                          setFormData({
                            ...formData,
                            phoneNumber: e.target.value,
                          })
                        }
                        placeholder="+966 5X XXX XXXX"
                        aria-invalid={!!formErrors.phoneNumber}
                        aria-describedby={
                          formErrors.phoneNumber
                            ? "phoneNumber-error"
                            : undefined
                        }
                        className={cn(
                          "bg-white border-gray-200 hover:border-primary/50 transition-colors",
                          formErrors.phoneNumber &&
                            "border-red-500 focus-visible:ring-red-500"
                        )}
                      />
                      {formErrors.phoneNumber && (
                        <div
                          id="phoneNumber-error"
                          role="alert"
                          className="flex items-center gap-1 mt-1 text-red-500 text-sm"
                        >
                          <AlertCircle className="h-3 w-3" aria-hidden="true" />
                          <span>{formErrors.phoneNumber}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="emergencyContact" className="text-sm">
                      {t("profile.personal.emergencyContact")}
                    </Label>
                    <Input
                      id="emergencyContact"
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
                      className="bg-white border-gray-200 hover:border-primary/50 transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="emergencyPhone" className="text-sm">
                      {t("profile.personal.emergencyPhone")}
                    </Label>
                    <div className="relative">
                      <Input
                        id="emergencyPhone"
                        value={formData.emergencyPhone}
                        onChange={e =>
                          setFormData({
                            ...formData,
                            emergencyPhone: e.target.value,
                          })
                        }
                        placeholder="+966 5X XXX XXXX"
                        aria-invalid={!!formErrors.emergencyPhone}
                        aria-describedby={
                          formErrors.emergencyPhone
                            ? "emergencyPhone-error"
                            : undefined
                        }
                        className={cn(
                          "bg-white border-gray-200 hover:border-primary/50 transition-colors",
                          formErrors.emergencyPhone &&
                            "border-red-500 focus-visible:ring-red-500"
                        )}
                      />
                      {formErrors.emergencyPhone && (
                        <div
                          id="emergencyPhone-error"
                          role="alert"
                          className="flex items-center gap-1 mt-1 text-red-500 text-sm"
                        >
                          <AlertCircle className="h-3 w-3" aria-hidden="true" />
                          <span>{formErrors.emergencyPhone}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications */}
          <TabsContent value="notifications">
            <Card className="border-0 shadow-xl bg-white/90 backdrop-blur-sm rounded-2xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-primary/5 to-primary/10 border-b">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Bell className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>{t("profile.notifications.title")}</CardTitle>
                    <CardDescription>
                      {t("profile.notifications.description")}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <Mail className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">
                        {t("profile.notifications.email")}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t("profile.notifications.emailDesc")}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={formData.emailNotifications}
                    onCheckedChange={checked =>
                      setFormData({ ...formData, emailNotifications: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <Phone className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">
                        {t("profile.notifications.sms")}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t("profile.notifications.smsDesc")}
                      </p>
                    </div>
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

            {/* Auto Check-In */}
            <AutoCheckInToggle className="mt-4" />
          </TabsContent>
        </Tabs>

        {/* Save Button */}
        <div className="flex justify-end mt-6">
          <Button
            onClick={handleSave}
            disabled={updatePreferences.isPending}
            size="lg"
            className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg hover:shadow-xl transition-all px-8"
            data-testid="save-button"
          >
            {updatePreferences.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("profile.saving")}
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

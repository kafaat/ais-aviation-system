import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { BaggageTracker } from "@/components/BaggageTracker";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Package,
  Search,
  AlertTriangle,
  MapPin,
  Clock,
  Luggage,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export default function BaggageStatus() {
  const { t } = useTranslation();
  const { user } = useAuth();

  // State for tabs
  const [activeTab, setActiveTab] = useState("track");

  // State for lost baggage report dialog
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [selectedTagNumber, setSelectedTagNumber] = useState("");
  const [lostDescription, setLostDescription] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  // Report lost baggage mutation
  const reportLostMutation = trpc.baggage.reportLost.useMutation({
    onSuccess: () => {
      toast.success(t("baggage.lostReportSuccess"));
      setReportDialogOpen(false);
      setSelectedTagNumber("");
      setLostDescription("");
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const handleReportLost = () => {
    if (!selectedTagNumber || !lostDescription.trim()) {
      toast.error(t("baggage.fillAllFields"));
      return;
    }

    reportLostMutation.mutate({
      tagNumber: selectedTagNumber,
      description: lostDescription,
      contactEmail: contactEmail || undefined,
      contactPhone: contactPhone || undefined,
    });
  };

  // Function to open report dialog with tag number pre-filled
  const _openReportDialog = (tagNumber: string) => {
    setSelectedTagNumber(tagNumber);
    setLostDescription("");
    setContactEmail(user?.email || "");
    setReportDialogOpen(true);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Luggage className="h-8 w-8 text-primary" />
          {t("baggage.title")}
        </h1>
        <p className="text-muted-foreground mt-2">{t("baggage.subtitle")}</p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="track" className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            {t("baggage.trackTab")}
          </TabsTrigger>
          <TabsTrigger value="report" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {t("baggage.reportLostTab")}
          </TabsTrigger>
        </TabsList>

        {/* Track Baggage Tab */}
        <TabsContent value="track">
          <BaggageTracker showSearch={true} />
        </TabsContent>

        {/* Report Lost Baggage Tab */}
        <TabsContent value="report">
          <Card className="p-6">
            <div className="space-y-6">
              <div className="text-center mb-6">
                <AlertTriangle className="h-12 w-12 text-orange-500 mx-auto mb-4" />
                <h2 className="text-xl font-semibold">
                  {t("baggage.reportLostTitle")}
                </h2>
                <p className="text-muted-foreground">
                  {t("baggage.reportLostDescription")}
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="tagNumber">{t("baggage.tagNumber")} *</Label>
                  <Input
                    id="tagNumber"
                    value={selectedTagNumber}
                    onChange={e =>
                      setSelectedTagNumber(e.target.value.toUpperCase())
                    }
                    placeholder={t("baggage.enterTagNumber")}
                    maxLength={20}
                    className="uppercase"
                  />
                </div>

                <div>
                  <Label htmlFor="description">
                    {t("baggage.lostDescriptionLabel")} *
                  </Label>
                  <Textarea
                    id="description"
                    value={lostDescription}
                    onChange={e => setLostDescription(e.target.value)}
                    placeholder={t("baggage.lostDescriptionPlaceholder")}
                    rows={4}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="email">{t("baggage.contactEmail")}</Label>
                    <Input
                      id="email"
                      type="email"
                      value={contactEmail}
                      onChange={e => setContactEmail(e.target.value)}
                      placeholder={t("baggage.emailPlaceholder")}
                    />
                  </div>
                  <div>
                    <Label htmlFor="phone">{t("baggage.contactPhone")}</Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={contactPhone}
                      onChange={e => setContactPhone(e.target.value)}
                      placeholder={t("baggage.phonePlaceholder")}
                    />
                  </div>
                </div>

                <Button
                  onClick={handleReportLost}
                  disabled={
                    !selectedTagNumber ||
                    !lostDescription.trim() ||
                    reportLostMutation.isPending
                  }
                  className="w-full"
                >
                  {reportLostMutation.isPending
                    ? t("common.loading")
                    : t("baggage.submitReport")}
                </Button>
              </div>

              {/* Instructions */}
              <div className="mt-8 p-4 bg-muted/50 rounded-lg">
                <h3 className="font-medium mb-3">{t("baggage.whatHappens")}</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <span className="bg-primary/10 text-primary rounded-full w-5 h-5 flex items-center justify-center text-xs shrink-0 mt-0.5">
                      1
                    </span>
                    {t("baggage.step1")}
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="bg-primary/10 text-primary rounded-full w-5 h-5 flex items-center justify-center text-xs shrink-0 mt-0.5">
                      2
                    </span>
                    {t("baggage.step2")}
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="bg-primary/10 text-primary rounded-full w-5 h-5 flex items-center justify-center text-xs shrink-0 mt-0.5">
                      3
                    </span>
                    {t("baggage.step3")}
                  </li>
                </ul>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Information Section */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <Package className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-medium">{t("baggage.feature1Title")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("baggage.feature1Desc")}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="bg-green-100 p-2 rounded-lg">
              <MapPin className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <h3 className="font-medium">{t("baggage.feature2Title")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("baggage.feature2Desc")}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="bg-orange-100 p-2 rounded-lg">
              <Clock className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h3 className="font-medium">{t("baggage.feature3Title")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("baggage.feature3Desc")}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Report Lost Dialog */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("baggage.reportLostTitle")}</DialogTitle>
            <DialogDescription>
              {t("baggage.reportLostDialogDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-sm">
                <strong>{t("baggage.tagNumber")}:</strong> {selectedTagNumber}
              </p>
            </div>

            <div>
              <Label htmlFor="lost-description">
                {t("baggage.lostDescriptionLabel")} *
              </Label>
              <Textarea
                id="lost-description"
                value={lostDescription}
                onChange={e => setLostDescription(e.target.value)}
                placeholder={t("baggage.lostDescriptionPlaceholder")}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReportDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleReportLost}
              disabled={!lostDescription.trim() || reportLostMutation.isPending}
              variant="destructive"
            >
              {reportLostMutation.isPending
                ? t("common.loading")
                : t("baggage.submitReport")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

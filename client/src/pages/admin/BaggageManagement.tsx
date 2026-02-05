import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Luggage,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Search,
  Plane,
  Scale,
  Eye,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

// Type for baggage item from API
interface BaggageItemType {
  id: number;
  bookingId: number;
  passengerId: number;
  tagNumber: string;
  weight: string;
  status: string;
  lastLocation: string | null;
  description: string | null;
  specialHandling: string | null;
  lostReportedAt: Date | null;
  lostDescription: string | null;
  createdAt: Date;
  updatedAt: Date;
  passengerName?: string;
}

type BaggageStatus =
  | "checked_in"
  | "security_screening"
  | "loading"
  | "in_transit"
  | "arrived"
  | "customs"
  | "ready_for_pickup"
  | "claimed"
  | "lost"
  | "found"
  | "damaged";

const BAGGAGE_STATUSES: BaggageStatus[] = [
  "checked_in",
  "security_screening",
  "loading",
  "in_transit",
  "arrived",
  "customs",
  "ready_for_pickup",
  "claimed",
  "lost",
  "found",
  "damaged",
];

export default function BaggageManagement() {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === "ar" ? ar : enUS;

  // State
  const [statusFilter, setStatusFilter] = useState<BaggageStatus | "all">(
    "all"
  );
  const [searchTag, setSearchTag] = useState("");
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [foundDialogOpen, setFoundDialogOpen] = useState(false);
  const [trackDialogOpen, setTrackDialogOpen] = useState(false);
  const [selectedBaggage, setSelectedBaggage] =
    useState<BaggageItemType | null>(null);

  // Update form state
  const [newStatus, setNewStatus] = useState<BaggageStatus>("checked_in");
  const [newLocation, setNewLocation] = useState("");
  const [updateNotes, setUpdateNotes] = useState("");

  // Found form state
  const [foundLocation, setFoundLocation] = useState("");
  const [foundNotes, setFoundNotes] = useState("");

  // Fetch stats
  const { data: stats, isLoading: statsLoading } =
    trpc.baggage.adminGetStats.useQuery();

  // Fetch baggage list
  const {
    data: baggageList,
    isLoading: listLoading,
    refetch: refetchList,
  } = trpc.baggage.adminGetAll.useQuery(
    statusFilter === "all" ? undefined : { status: statusFilter }
  );

  // Fetch tracking history
  const { data: trackingData, isLoading: trackingLoading } =
    trpc.baggage.track.useQuery(
      { tagNumber: selectedBaggage?.tagNumber || "" },
      { enabled: trackDialogOpen && !!selectedBaggage?.tagNumber }
    );

  // Mutations
  const updateStatusMutation = trpc.baggage.adminUpdateStatus.useMutation({
    onSuccess: () => {
      toast.success(t("baggage.admin.statusUpdated"));
      setUpdateDialogOpen(false);
      setSelectedBaggage(null);
      refetchList();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const markFoundMutation = trpc.baggage.adminMarkFound.useMutation({
    onSuccess: () => {
      toast.success(t("baggage.admin.markedFound"));
      setFoundDialogOpen(false);
      setSelectedBaggage(null);
      refetchList();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  // Handlers
  const handleUpdateStatus = () => {
    if (!selectedBaggage || !newLocation.trim()) {
      toast.error(t("baggage.fillAllFields"));
      return;
    }

    updateStatusMutation.mutate({
      tagNumber: selectedBaggage.tagNumber,
      status: newStatus,
      location: newLocation,
      notes: updateNotes || undefined,
    });
  };

  const handleMarkFound = () => {
    if (!selectedBaggage || !foundLocation.trim()) {
      toast.error(t("baggage.fillAllFields"));
      return;
    }

    markFoundMutation.mutate({
      tagNumber: selectedBaggage.tagNumber,
      foundLocation,
      notes: foundNotes || undefined,
    });
  };

  const openUpdateDialog = (baggage: BaggageItemType) => {
    setSelectedBaggage(baggage);
    setNewStatus(baggage.status as BaggageStatus);
    setNewLocation(baggage.lastLocation || "");
    setUpdateNotes("");
    setUpdateDialogOpen(true);
  };

  const openFoundDialog = (baggage: BaggageItemType) => {
    setSelectedBaggage(baggage);
    setFoundLocation("");
    setFoundNotes("");
    setFoundDialogOpen(true);
  };

  const openTrackDialog = (baggage: BaggageItemType) => {
    setSelectedBaggage(baggage);
    setTrackDialogOpen(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "checked_in":
      case "security_screening":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "loading":
      case "in_transit":
        return "bg-yellow-50 text-yellow-700 border-yellow-200";
      case "arrived":
      case "customs":
      case "ready_for_pickup":
        return "bg-green-50 text-green-700 border-green-200";
      case "claimed":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "lost":
      case "damaged":
        return "bg-red-50 text-red-700 border-red-200";
      case "found":
        return "bg-purple-50 text-purple-700 border-purple-200";
      default:
        return "bg-gray-50 text-gray-700 border-gray-200";
    }
  };

  // Filter baggage by search
  const filteredBaggage =
    baggageList?.filter(
      item =>
        !searchTag ||
        item.tagNumber.toLowerCase().includes(searchTag.toLowerCase())
    ) || [];

  if (statsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Luggage className="h-8 w-8" />
          {t("baggage.admin.title")}
        </h1>
        <p className="text-muted-foreground">{t("baggage.admin.subtitle")}</p>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("baggage.admin.totalBaggage")}
            </p>
            <Package className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold">{stats?.totalBaggage || 0}</p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("baggage.admin.allTime")}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("baggage.admin.checkedIn")}
            </p>
            <CheckCircle2 className="h-4 w-4 text-blue-600" />
          </div>
          <p className="text-3xl font-bold text-blue-600">
            {stats?.checkedIn || 0}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("baggage.admin.processing")}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("baggage.admin.inTransit")}
            </p>
            <Plane className="h-4 w-4 text-yellow-600" />
          </div>
          <p className="text-3xl font-bold text-yellow-600">
            {stats?.inTransit || 0}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("baggage.admin.onTheWay")}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("baggage.admin.claimed")}
            </p>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </div>
          <p className="text-3xl font-bold text-green-600">
            {stats?.claimed || 0}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("baggage.admin.delivered")}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("baggage.admin.lost")}
            </p>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </div>
          <p className="text-3xl font-bold text-red-600">{stats?.lost || 0}</p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("baggage.admin.needsAttention")}
          </p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <Label htmlFor="search">{t("baggage.admin.searchByTag")}</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="search"
                value={searchTag}
                onChange={e => setSearchTag(e.target.value.toUpperCase())}
                placeholder={t("baggage.enterTagNumber")}
                className="pl-10 uppercase"
              />
            </div>
          </div>
          <div className="w-full md:w-64">
            <Label>{t("baggage.admin.filterByStatus")}</Label>
            <Select
              value={statusFilter}
              onValueChange={(value: BaggageStatus | "all") =>
                setStatusFilter(value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("baggage.admin.allStatuses")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("baggage.admin.allStatuses")}
                </SelectItem>
                {BAGGAGE_STATUSES.map(status => (
                  <SelectItem key={status} value={status}>
                    {t(`baggage.status.${status}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={() => refetchList()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t("common.refresh")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Baggage Table */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">
          {t("baggage.admin.baggageList")}
        </h2>
        {listLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : filteredBaggage.length === 0 ? (
          <div className="text-center py-12">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {t("baggage.admin.noBaggage")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("baggage.tagNumber")}</TableHead>
                  <TableHead>{t("baggage.passenger")}</TableHead>
                  <TableHead>{t("baggage.weight")}</TableHead>
                  <TableHead>{t("baggage.statusLabel")}</TableHead>
                  <TableHead>{t("baggage.location")}</TableHead>
                  <TableHead>{t("baggage.lastUpdated")}</TableHead>
                  <TableHead>{t("baggage.admin.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBaggage.map(baggage => (
                  <TableRow key={baggage.id}>
                    <TableCell className="font-mono font-medium">
                      {baggage.tagNumber}
                    </TableCell>
                    <TableCell>{baggage.passengerName || "-"}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1">
                        <Scale className="h-3 w-3" />
                        {baggage.weight} kg
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={getStatusColor(baggage.status)}
                      >
                        {t(`baggage.status.${baggage.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {baggage.lastLocation ? (
                        <span className="flex items-center gap-1 text-sm">
                          <MapPin className="h-3 w-3" />
                          {baggage.lastLocation}
                        </span>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(baggage.updatedAt), "PPp", {
                        locale: currentLocale,
                      })}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openTrackDialog(baggage)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {baggage.status !== "claimed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openUpdateDialog(baggage)}
                          >
                            {t("baggage.admin.update")}
                          </Button>
                        )}
                        {baggage.status === "lost" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-green-50 text-green-700"
                            onClick={() => openFoundDialog(baggage)}
                          >
                            {t("baggage.admin.markFound")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Update Status Dialog */}
      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("baggage.admin.updateStatus")}</DialogTitle>
            <DialogDescription>
              {t("baggage.admin.updateStatusDesc")}
            </DialogDescription>
          </DialogHeader>
          {selectedBaggage && (
            <div className="space-y-4">
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-sm">
                  <strong>{t("baggage.tagNumber")}:</strong>{" "}
                  {selectedBaggage.tagNumber}
                </p>
                <p className="text-sm">
                  <strong>{t("baggage.currentStatus")}:</strong>{" "}
                  {t(`baggage.status.${selectedBaggage.status}`)}
                </p>
              </div>

              <div>
                <Label>{t("baggage.newStatus")} *</Label>
                <Select
                  value={newStatus}
                  onValueChange={(value: BaggageStatus) => setNewStatus(value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BAGGAGE_STATUSES.map(status => (
                      <SelectItem key={status} value={status}>
                        {t(`baggage.status.${status}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>{t("baggage.location")} *</Label>
                <Input
                  value={newLocation}
                  onChange={e => setNewLocation(e.target.value)}
                  placeholder={t("baggage.locationPlaceholder")}
                />
              </div>

              <div>
                <Label>{t("baggage.notes")}</Label>
                <Textarea
                  value={updateNotes}
                  onChange={e => setUpdateNotes(e.target.value)}
                  placeholder={t("baggage.notesPlaceholder")}
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUpdateDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleUpdateStatus}
              disabled={!newLocation.trim() || updateStatusMutation.isPending}
            >
              {updateStatusMutation.isPending
                ? t("common.loading")
                : t("baggage.admin.updateStatus")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Found Dialog */}
      <Dialog open={foundDialogOpen} onOpenChange={setFoundDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("baggage.admin.markFoundTitle")}</DialogTitle>
            <DialogDescription>
              {t("baggage.admin.markFoundDesc")}
            </DialogDescription>
          </DialogHeader>
          {selectedBaggage && (
            <div className="space-y-4">
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-sm">
                  <strong>{t("baggage.tagNumber")}:</strong>{" "}
                  {selectedBaggage.tagNumber}
                </p>
                {selectedBaggage.lostDescription && (
                  <p className="text-sm mt-1">
                    <strong>{t("baggage.lostReport")}:</strong>{" "}
                    {selectedBaggage.lostDescription}
                  </p>
                )}
              </div>

              <div>
                <Label>{t("baggage.foundLocation")} *</Label>
                <Input
                  value={foundLocation}
                  onChange={e => setFoundLocation(e.target.value)}
                  placeholder={t("baggage.foundLocationPlaceholder")}
                />
              </div>

              <div>
                <Label>{t("baggage.notes")}</Label>
                <Textarea
                  value={foundNotes}
                  onChange={e => setFoundNotes(e.target.value)}
                  placeholder={t("baggage.foundNotesPlaceholder")}
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFoundDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleMarkFound}
              disabled={!foundLocation.trim() || markFoundMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {markFoundMutation.isPending
                ? t("common.loading")
                : t("baggage.admin.markFound")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tracking History Dialog */}
      <Dialog open={trackDialogOpen} onOpenChange={setTrackDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("baggage.trackingHistory")}</DialogTitle>
            <DialogDescription>{selectedBaggage?.tagNumber}</DialogDescription>
          </DialogHeader>
          {trackingLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : trackingData ? (
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {trackingData.tracking.map((record, index) => (
                <div
                  key={record.id}
                  className="flex gap-4 p-3 bg-muted/50 rounded-lg"
                >
                  <div
                    className={`w-3 h-3 rounded-full mt-1.5 ${
                      index === 0 ? "bg-primary" : "bg-muted-foreground"
                    }`}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={getStatusColor(record.status)}
                      >
                        {t(`baggage.status.${record.status}`)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(record.scannedAt), "PPp", {
                          locale: currentLocale,
                        })}
                      </span>
                    </div>
                    <p className="text-sm mt-1 flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {record.location}
                    </p>
                    {record.notes && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {record.notes}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setTrackDialogOpen(false)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

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
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Plane,
  Mail,
  Phone,
  User,
  Percent,
  DollarSign,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

type GroupBookingStatus = "pending" | "confirmed" | "cancelled";

export default function GroupBookingsManagement() {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === "ar" ? ar : enUS;

  // Filter state
  const [statusFilter, setStatusFilter] = useState<GroupBookingStatus | "all">(
    "all"
  );

  // Dialog state
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [discountPercent, setDiscountPercent] = useState(5);
  const [rejectionReason, setRejectionReason] = useState("");

  // Fetch data
  const { data: stats, isLoading: statsLoading } =
    trpc.groupBookings.getStats.useQuery();

  const {
    data: bookings,
    isLoading: bookingsLoading,
    refetch: refetchBookings,
  } = trpc.groupBookings.list.useQuery(
    statusFilter === "all" ? undefined : { status: statusFilter }
  );

  // Mutations
  const approveMutation = trpc.groupBookings.approve.useMutation({
    onSuccess: () => {
      toast.success(t("groupBooking.admin.approveSuccess"));
      setApproveDialogOpen(false);
      setSelectedBooking(null);
      refetchBookings();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const rejectMutation = trpc.groupBookings.reject.useMutation({
    onSuccess: () => {
      toast.success(t("groupBooking.admin.rejectSuccess"));
      setRejectDialogOpen(false);
      setSelectedBooking(null);
      setRejectionReason("");
      refetchBookings();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const handleApprove = () => {
    if (!selectedBooking) return;
    approveMutation.mutate({
      id: selectedBooking.id,
      discountPercent,
    });
  };

  const handleReject = () => {
    if (!selectedBooking || !rejectionReason.trim()) {
      toast.error(t("groupBooking.admin.rejectReasonRequired"));
      return;
    }
    rejectMutation.mutate({
      id: selectedBooking.id,
      reason: rejectionReason,
    });
  };

  const openApproveDialog = (booking: any) => {
    setSelectedBooking(booking);
    // Calculate suggested discount based on group size
    if (booking.groupSize >= 50) {
      setDiscountPercent(15);
    } else if (booking.groupSize >= 20) {
      setDiscountPercent(10);
    } else {
      setDiscountPercent(5);
    }
    setApproveDialogOpen(true);
  };

  const openRejectDialog = (booking: any) => {
    setSelectedBooking(booking);
    setRejectionReason("");
    setRejectDialogOpen(true);
  };

  const getStatusBadge = (status: GroupBookingStatus) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
            <Clock className="h-3 w-3 mr-1" />
            {t("groupBooking.status.pending")}
          </Badge>
        );
      case "confirmed":
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {t("groupBooking.status.confirmed")}
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700">
            <XCircle className="h-3 w-3 mr-1" />
            {t("groupBooking.status.cancelled")}
          </Badge>
        );
    }
  };

  if (statsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
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
        <h1 className="text-3xl font-bold">{t("groupBooking.admin.title")}</h1>
        <p className="text-muted-foreground">
          {t("groupBooking.admin.subtitle")}
        </p>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("groupBooking.admin.totalRequests")}
            </p>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold">{stats?.totalRequests || 0}</p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("groupBooking.admin.allTime")}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("groupBooking.admin.pendingRequests")}
            </p>
            <Clock className="h-4 w-4 text-yellow-600" />
          </div>
          <p className="text-3xl font-bold text-yellow-600">
            {stats?.pendingRequests || 0}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("groupBooking.admin.awaitingReview")}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("groupBooking.admin.confirmedRequests")}
            </p>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </div>
          <p className="text-3xl font-bold text-green-600">
            {stats?.confirmedRequests || 0}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("groupBooking.admin.approved")}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("groupBooking.admin.totalPassengers")}
            </p>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold">
            {stats?.totalGroupPassengers || 0}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("groupBooking.admin.fromConfirmed")}
          </p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <Label htmlFor="status-filter">
            {t("groupBooking.admin.filterByStatus")}
          </Label>
          <Select
            value={statusFilter}
            onValueChange={(value: GroupBookingStatus | "all") =>
              setStatusFilter(value)
            }
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder={t("groupBooking.admin.allStatuses")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("groupBooking.admin.allStatuses")}
              </SelectItem>
              <SelectItem value="pending">
                {t("groupBooking.status.pending")}
              </SelectItem>
              <SelectItem value="confirmed">
                {t("groupBooking.status.confirmed")}
              </SelectItem>
              <SelectItem value="cancelled">
                {t("groupBooking.status.cancelled")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Bookings Table */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">
          {t("groupBooking.admin.bookingRequests")}
        </h2>
        {bookingsLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : !bookings || bookings.length === 0 ? (
          <div className="text-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {t("groupBooking.admin.noRequests")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("groupBooking.admin.id")}</TableHead>
                  <TableHead>{t("groupBooking.admin.organizer")}</TableHead>
                  <TableHead>{t("groupBooking.admin.flight")}</TableHead>
                  <TableHead>{t("groupBooking.admin.groupSize")}</TableHead>
                  <TableHead>{t("groupBooking.admin.status")}</TableHead>
                  <TableHead>{t("groupBooking.admin.discount")}</TableHead>
                  <TableHead>{t("groupBooking.admin.date")}</TableHead>
                  <TableHead>{t("groupBooking.admin.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.map((booking: any) => (
                  <TableRow key={booking.id}>
                    <TableCell className="font-medium">#{booking.id}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {booking.organizerName}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {booking.organizerEmail}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {booking.organizerPhone}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Plane className="h-4 w-4" />
                        {booking.flight?.flightNumber || `#${booking.flightId}`}
                      </div>
                      {booking.flight && (
                        <p className="text-xs text-muted-foreground">
                          {format(
                            new Date(booking.flight.departureTime),
                            "PPP",
                            {
                              locale: currentLocale,
                            }
                          )}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        <Users className="h-3 w-3 mr-1" />
                        {booking.groupSize}
                      </Badge>
                    </TableCell>
                    <TableCell>{getStatusBadge(booking.status)}</TableCell>
                    <TableCell>
                      {booking.discountPercent ? (
                        <span className="text-green-600 font-semibold flex items-center gap-1">
                          <Percent className="h-3 w-3" />
                          {booking.discountPercent}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(booking.createdAt), "PPp", {
                        locale: currentLocale,
                      })}
                    </TableCell>
                    <TableCell>
                      {booking.status === "pending" && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-green-50 text-green-700 hover:bg-green-100"
                            onClick={() => openApproveDialog(booking)}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            {t("groupBooking.admin.approve")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-red-50 text-red-700 hover:bg-red-100"
                            onClick={() => openRejectDialog(booking)}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            {t("groupBooking.admin.reject")}
                          </Button>
                        </div>
                      )}
                      {booking.status === "cancelled" &&
                        booking.rejectionReason && (
                          <p className="text-xs text-muted-foreground">
                            {t("groupBooking.admin.reason")}:{" "}
                            {booking.rejectionReason}
                          </p>
                        )}
                      {booking.status === "confirmed" && booking.totalPrice && (
                        <span className="text-sm font-semibold flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          {(booking.totalPrice / 100).toFixed(2)} SAR
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Approve Dialog */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("groupBooking.admin.approveTitle")}</DialogTitle>
            <DialogDescription>
              {t("groupBooking.admin.approveDescription")}
            </DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <div className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-sm">
                  <strong>{t("groupBooking.admin.organizer")}:</strong>{" "}
                  {selectedBooking.organizerName}
                </p>
                <p className="text-sm">
                  <strong>{t("groupBooking.admin.groupSize")}:</strong>{" "}
                  {selectedBooking.groupSize} {t("groupBooking.passengers")}
                </p>
                <p className="text-sm">
                  <strong>{t("groupBooking.admin.flight")}:</strong>{" "}
                  {selectedBooking.flight?.flightNumber ||
                    `#${selectedBooking.flightId}`}
                </p>
              </div>
              <div>
                <Label htmlFor="discount">
                  {t("groupBooking.admin.discountPercent")}
                </Label>
                <Input
                  id="discount"
                  type="number"
                  min={0}
                  max={50}
                  value={discountPercent}
                  onChange={e => setDiscountPercent(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("groupBooking.admin.discountHint")}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setApproveDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleApprove}
              disabled={approveMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {approveMutation.isPending
                ? t("common.loading")
                : t("groupBooking.admin.confirmApprove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("groupBooking.admin.rejectTitle")}</DialogTitle>
            <DialogDescription>
              {t("groupBooking.admin.rejectDescription")}
            </DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <div className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-sm">
                  <strong>{t("groupBooking.admin.organizer")}:</strong>{" "}
                  {selectedBooking.organizerName}
                </p>
                <p className="text-sm">
                  <strong>{t("groupBooking.admin.groupSize")}:</strong>{" "}
                  {selectedBooking.groupSize} {t("groupBooking.passengers")}
                </p>
              </div>
              <div>
                <Label htmlFor="reason">
                  {t("groupBooking.admin.rejectionReason")} *
                </Label>
                <Textarea
                  id="reason"
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  placeholder={t(
                    "groupBooking.admin.rejectionReasonPlaceholder"
                  )}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleReject}
              disabled={rejectMutation.isPending}
              variant="destructive"
            >
              {rejectMutation.isPending
                ? t("common.loading")
                : t("groupBooking.admin.confirmReject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

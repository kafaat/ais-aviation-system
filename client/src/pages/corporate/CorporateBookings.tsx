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
  Plane,
  Clock,
  CheckCircle2,
  XCircle,
  Building2,
  Filter,
  DollarSign,
  Calendar,
  FileText,
  Briefcase,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { Link } from "wouter";

type ApprovalStatus = "pending" | "approved" | "rejected";

export default function CorporateBookings() {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === "ar" ? ar : enUS;

  // Filter state
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | "all">(
    "all"
  );
  const [costCenterFilter, setCostCenterFilter] = useState("");
  const [projectCodeFilter, setProjectCodeFilter] = useState("");

  // Dialog state
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);

  // Fetch data
  const { data: account, isLoading: accountLoading } =
    trpc.corporate.getMyAccount.useQuery();

  const filters: any = {};
  if (statusFilter !== "all") {
    filters.approvalStatus = statusFilter;
  }
  if (costCenterFilter) {
    filters.costCenter = costCenterFilter;
  }
  if (projectCodeFilter) {
    filters.projectCode = projectCodeFilter;
  }

  const {
    data: bookings,
    isLoading: bookingsLoading,
    refetch: refetchBookings,
  } = trpc.corporate.getBookings.useQuery(
    Object.keys(filters).length > 0 ? filters : undefined,
    { enabled: !!account }
  );

  // Mutations
  const approveMutation = trpc.corporate.approveBooking.useMutation({
    onSuccess: () => {
      toast.success(t("corporate.bookingApproved"));
      refetchBookings();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const rejectMutation = trpc.corporate.rejectBooking.useMutation({
    onSuccess: () => {
      toast.success(t("corporate.bookingRejected"));
      setRejectDialogOpen(false);
      setSelectedBooking(null);
      setRejectionReason("");
      refetchBookings();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const handleReject = () => {
    if (!selectedBooking || !rejectionReason.trim()) {
      toast.error(t("corporate.rejectReasonRequired"));
      return;
    }
    rejectMutation.mutate({
      id: selectedBooking.id,
      reason: rejectionReason,
    });
  };

  const openRejectDialog = (booking: any) => {
    setSelectedBooking(booking);
    setRejectionReason("");
    setRejectDialogOpen(true);
  };

  const openDetailsDialog = (booking: any) => {
    setSelectedBooking(booking);
    setDetailsDialogOpen(true);
  };

  const getStatusBadge = (status: ApprovalStatus) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
            <Clock className="h-3 w-3 me-1" />
            {t("corporate.status.pending")}
          </Badge>
        );
      case "approved":
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700">
            <CheckCircle2 className="h-3 w-3 me-1" />
            {t("corporate.status.approved")}
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700">
            <XCircle className="h-3 w-3 me-1" />
            {t("corporate.status.rejected")}
          </Badge>
        );
    }
  };

  // Loading state
  if (accountLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  // No corporate account
  if (!account) {
    return (
      <div className="p-6">
        <Card className="p-12 text-center">
          <Building2 className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">
            {t("corporate.noAccount")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("corporate.noAccountDescription")}
          </p>
          <Link href="/corporate">
            <Button>{t("corporate.registerAccount")}</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const isCorporateAdmin = account.role === "admin";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("corporate.bookingsTitle")}</h1>
          <p className="text-muted-foreground">
            {t("corporate.bookingsSubtitle")}
          </p>
        </div>
        <Link href="/corporate">
          <Button variant="outline">
            <Building2 className="h-4 w-4 me-2" />
            {t("corporate.backToDashboard")}
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label htmlFor="status-filter" className="flex items-center gap-1">
              <Filter className="h-3 w-3" />
              {t("corporate.filterByStatus")}
            </Label>
            <Select
              value={statusFilter}
              onValueChange={(value: ApprovalStatus | "all") =>
                setStatusFilter(value)
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t("corporate.allStatuses")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("corporate.allStatuses")}
                </SelectItem>
                <SelectItem value="pending">
                  {t("corporate.status.pending")}
                </SelectItem>
                <SelectItem value="approved">
                  {t("corporate.status.approved")}
                </SelectItem>
                <SelectItem value="rejected">
                  {t("corporate.status.rejected")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="cost-center">{t("corporate.costCenter")}</Label>
            <Input
              id="cost-center"
              placeholder={t("corporate.filterByCostCenter")}
              value={costCenterFilter}
              onChange={e => setCostCenterFilter(e.target.value)}
              className="w-[180px]"
            />
          </div>

          <div>
            <Label htmlFor="project-code">{t("corporate.projectCode")}</Label>
            <Input
              id="project-code"
              placeholder={t("corporate.filterByProjectCode")}
              value={projectCodeFilter}
              onChange={e => setProjectCodeFilter(e.target.value)}
              className="w-[180px]"
            />
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatusFilter("all");
              setCostCenterFilter("");
              setProjectCodeFilter("");
            }}
          >
            {t("common.clearAll")}
          </Button>
        </div>
      </Card>

      {/* Bookings Table */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">
          {t("corporate.allBookings")}
        </h2>

        {bookingsLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : !bookings || bookings.length === 0 ? (
          <div className="text-center py-12">
            <Plane className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">{t("corporate.noBookings")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("corporate.bookingRef")}</TableHead>
                  <TableHead>{t("corporate.flight")}</TableHead>
                  <TableHead>{t("corporate.departureDate")}</TableHead>
                  <TableHead>{t("corporate.costCenter")}</TableHead>
                  <TableHead>{t("corporate.projectCode")}</TableHead>
                  <TableHead>{t("corporate.amount")}</TableHead>
                  <TableHead>{t("corporate.approvalStatus")}</TableHead>
                  <TableHead>{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.map((booking: any) => (
                  <TableRow key={booking.id}>
                    <TableCell className="font-mono">
                      {booking.booking.bookingReference}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Plane className="h-4 w-4" />
                        {booking.flight.flightNumber}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        {format(new Date(booking.flight.departureTime), "PPp", {
                          locale: currentLocale,
                        })}
                      </div>
                    </TableCell>
                    <TableCell>
                      {booking.costCenter ? (
                        <Badge variant="outline">
                          <Briefcase className="h-3 w-3 me-1" />
                          {booking.costCenter}
                        </Badge>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      {booking.projectCode ? (
                        <Badge variant="outline">
                          <FileText className="h-3 w-3 me-1" />
                          {booking.projectCode}
                        </Badge>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1 font-semibold">
                        <DollarSign className="h-3 w-3" />
                        {(booking.booking.totalAmount / 100).toFixed(2)} SAR
                      </span>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(booking.approvalStatus)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openDetailsDialog(booking)}
                        >
                          {t("corporate.viewDetails")}
                        </Button>
                        {isCorporateAdmin &&
                          booking.approvalStatus === "pending" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="bg-green-50 text-green-700 hover:bg-green-100"
                                onClick={() =>
                                  approveMutation.mutate({ id: booking.id })
                                }
                                disabled={approveMutation.isPending}
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="bg-red-50 text-red-700 hover:bg-red-100"
                                onClick={() => openRejectDialog(booking)}
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </>
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

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("corporate.rejectBookingTitle")}</DialogTitle>
            <DialogDescription>
              {t("corporate.rejectBookingDescription")}
            </DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <div className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-sm">
                  <strong>{t("corporate.bookingRef")}:</strong>{" "}
                  {selectedBooking.booking.bookingReference}
                </p>
                <p className="text-sm">
                  <strong>{t("corporate.flight")}:</strong>{" "}
                  {selectedBooking.flight.flightNumber}
                </p>
                <p className="text-sm">
                  <strong>{t("corporate.amount")}:</strong>{" "}
                  {(selectedBooking.booking.totalAmount / 100).toFixed(2)} SAR
                </p>
              </div>
              <div>
                <Label htmlFor="reason">
                  {t("corporate.rejectionReason")} *
                </Label>
                <Textarea
                  id="reason"
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  placeholder={t("corporate.rejectionReasonPlaceholder")}
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
                : t("corporate.confirmReject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details Dialog */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("corporate.bookingDetails")}</DialogTitle>
          </DialogHeader>
          {selectedBooking && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.bookingRef")}
                  </p>
                  <p className="font-mono font-semibold">
                    {selectedBooking.booking.bookingReference}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.flight")}
                  </p>
                  <p className="font-semibold">
                    {selectedBooking.flight.flightNumber}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.departureDate")}
                  </p>
                  <p className="font-semibold">
                    {format(
                      new Date(selectedBooking.flight.departureTime),
                      "PPp",
                      { locale: currentLocale }
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.amount")}
                  </p>
                  <p className="font-semibold">
                    {(selectedBooking.booking.totalAmount / 100).toFixed(2)} SAR
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.costCenter")}
                  </p>
                  <p className="font-semibold">
                    {selectedBooking.costCenter || "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.projectCode")}
                  </p>
                  <p className="font-semibold">
                    {selectedBooking.projectCode || "-"}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.travelPurpose")}
                  </p>
                  <p className="font-semibold">
                    {selectedBooking.travelPurpose || "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.approvalStatus")}
                  </p>
                  {getStatusBadge(selectedBooking.approvalStatus)}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.createdAt")}
                  </p>
                  <p className="font-semibold">
                    {format(new Date(selectedBooking.createdAt), "PPp", {
                      locale: currentLocale,
                    })}
                  </p>
                </div>
                {selectedBooking.rejectionReason && (
                  <div className="col-span-2">
                    <p className="text-sm text-muted-foreground">
                      {t("corporate.rejectionReason")}
                    </p>
                    <p className="text-red-600">
                      {selectedBooking.rejectionReason}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setDetailsDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

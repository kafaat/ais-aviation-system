import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  Users,
  CreditCard,
  TrendingUp,
  Clock,
  CheckCircle2,
  XCircle,
  Percent,
  Plus,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { Link } from "wouter";

export default function CorporateDashboard() {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === "ar" ? ar : enUS;

  // Dialog state
  const [addUserDialogOpen, setAddUserDialogOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState<
    "admin" | "booker" | "traveler"
  >("traveler");

  // Fetch data
  const { data: account, isLoading: accountLoading } =
    trpc.corporate.getMyAccount.useQuery();

  const { data: stats, isLoading: statsLoading } =
    trpc.corporate.getStats.useQuery(undefined, {
      enabled: !!account,
    });

  const {
    data: users,
    isLoading: usersLoading,
    refetch: refetchUsers,
  } = trpc.corporate.getUsers.useQuery(
    { accountId: account?.id || 0 },
    { enabled: !!account }
  );

  const {
    data: bookings,
    isLoading: bookingsLoading,
    refetch: refetchBookings,
  } = trpc.corporate.getBookings.useQuery(
    { approvalStatus: "pending" },
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
      refetchBookings();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const getStatusBadge = (status: string) => {
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
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "admin":
        return (
          <Badge className="bg-purple-100 text-purple-700">
            {t("corporate.roles.admin")}
          </Badge>
        );
      case "booker":
        return (
          <Badge className="bg-blue-100 text-blue-700">
            {t("corporate.roles.booker")}
          </Badge>
        );
      case "traveler":
        return (
          <Badge className="bg-gray-100 text-gray-700">
            {t("corporate.roles.traveler")}
          </Badge>
        );
      default:
        return <Badge variant="outline">{role}</Badge>;
    }
  };

  // Loading state
  if (accountLoading) {
    return (
      <div className="space-y-6 p-6">
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
            <Button>
              <Plus className="h-4 w-4 me-2" />
              {t("corporate.registerAccount")}
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  // Account not active
  if (account.status !== "active") {
    return (
      <div className="p-6">
        <Card className="p-12 text-center">
          <Clock className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">
            {t("corporate.accountPending")}
          </h2>
          <p className="text-muted-foreground mb-4">
            {t("corporate.accountPendingDescription")}
          </p>
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
            {t("corporate.status." + account.status)}
          </Badge>
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
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Building2 className="h-8 w-8" />
            {account.companyName}
          </h1>
          <p className="text-muted-foreground">
            {t("corporate.dashboardSubtitle")}
          </p>
        </div>
        <div className="flex gap-2">
          {getRoleBadge(account.role)}
          {account.discountPercent && Number(account.discountPercent) > 0 && (
            <Badge variant="outline" className="bg-green-50 text-green-700">
              <Percent className="h-3 w-3 me-1" />
              {account.discountPercent}% {t("corporate.discount")}
            </Badge>
          )}
        </div>
      </div>

      {/* Statistics Cards */}
      {statsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">
                {t("corporate.stats.totalBookings")}
              </p>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-3xl font-bold">{stats?.totalBookings || 0}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {t("corporate.stats.allTime")}
            </p>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">
                {t("corporate.stats.pendingApprovals")}
              </p>
              <Clock className="h-4 w-4 text-yellow-600" />
            </div>
            <p className="text-3xl font-bold text-yellow-600">
              {stats?.pendingApprovals || 0}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {t("corporate.stats.awaitingReview")}
            </p>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">
                {t("corporate.stats.totalSpent")}
              </p>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-3xl font-bold">
              {((stats?.totalSpent || 0) / 100).toFixed(2)} SAR
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {t("corporate.stats.approvedBookings")}
            </p>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">
                {t("corporate.stats.teamMembers")}
              </p>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-3xl font-bold">{stats?.userCount || 0}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {t("corporate.stats.activeUsers")}
            </p>
          </Card>
        </div>
      )}

      {/* Pending Approvals (Corporate Admin Only) */}
      {isCorporateAdmin && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">
              {t("corporate.pendingApprovals")}
            </h2>
            <Link href="/corporate/bookings">
              <Button variant="outline" size="sm">
                {t("corporate.viewAll")}
              </Button>
            </Link>
          </div>

          {bookingsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !bookings || bookings.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <p className="text-muted-foreground">
                {t("corporate.noPendingApprovals")}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("corporate.bookingRef")}</TableHead>
                  <TableHead>{t("corporate.flight")}</TableHead>
                  <TableHead>{t("corporate.costCenter")}</TableHead>
                  <TableHead>{t("corporate.amount")}</TableHead>
                  <TableHead>{t("corporate.date")}</TableHead>
                  <TableHead>{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.slice(0, 5).map((booking: any) => (
                  <TableRow key={booking.id}>
                    <TableCell className="font-mono">
                      {booking.booking.bookingReference}
                    </TableCell>
                    <TableCell>{booking.flight.flightNumber}</TableCell>
                    <TableCell>{booking.costCenter || "-"}</TableCell>
                    <TableCell>
                      {(booking.booking.totalAmount / 100).toFixed(2)} SAR
                    </TableCell>
                    <TableCell>
                      {format(new Date(booking.createdAt), "PPp", {
                        locale: currentLocale,
                      })}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
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
                          onClick={() => {
                            const reason = prompt(
                              t("corporate.enterRejectionReason")
                            );
                            if (reason) {
                              rejectMutation.mutate({
                                id: booking.id,
                                reason,
                              });
                            }
                          }}
                          disabled={rejectMutation.isPending}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {/* Team Members */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">
            {t("corporate.teamMembers")}
          </h2>
          {isCorporateAdmin && (
            <Button size="sm" onClick={() => setAddUserDialogOpen(true)}>
              <UserPlus className="h-4 w-4 me-2" />
              {t("corporate.addMember")}
            </Button>
          )}
        </div>

        {usersLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : !users || users.length === 0 ? (
          <div className="text-center py-8">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {t("corporate.noTeamMembers")}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("corporate.name")}</TableHead>
                <TableHead>{t("corporate.email")}</TableHead>
                <TableHead>{t("corporate.role")}</TableHead>
                <TableHead>{t("corporate.joined")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((member: any) => (
                <TableRow key={member.id}>
                  <TableCell>{member.user.name || "-"}</TableCell>
                  <TableCell>{member.user.email}</TableCell>
                  <TableCell>{getRoleBadge(member.role)}</TableCell>
                  <TableCell>
                    {format(new Date(member.createdAt), "PP", {
                      locale: currentLocale,
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/search">
          <Card className="p-6 hover:bg-muted/50 cursor-pointer transition-colors">
            <h3 className="font-semibold mb-2">
              {t("corporate.actions.bookFlight")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("corporate.actions.bookFlightDesc")}
            </p>
          </Card>
        </Link>
        <Link href="/corporate/bookings">
          <Card className="p-6 hover:bg-muted/50 cursor-pointer transition-colors">
            <h3 className="font-semibold mb-2">
              {t("corporate.actions.viewBookings")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("corporate.actions.viewBookingsDesc")}
            </p>
          </Card>
        </Link>
        <Link href="/my-bookings">
          <Card className="p-6 hover:bg-muted/50 cursor-pointer transition-colors">
            <h3 className="font-semibold mb-2">
              {t("corporate.actions.myTrips")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("corporate.actions.myTripsDesc")}
            </p>
          </Card>
        </Link>
      </div>

      {/* Add User Dialog */}
      <Dialog open={addUserDialogOpen} onOpenChange={setAddUserDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("corporate.addMemberTitle")}</DialogTitle>
            <DialogDescription>
              {t("corporate.addMemberDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="email">{t("corporate.userEmail")}</Label>
              <Input
                id="email"
                type="email"
                value={newUserEmail}
                onChange={e => setNewUserEmail(e.target.value)}
                placeholder={t("corporate.userEmailPlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="role">{t("corporate.userRole")}</Label>
              <Select
                value={newUserRole}
                onValueChange={(value: "admin" | "booker" | "traveler") =>
                  setNewUserRole(value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">
                    {t("corporate.roles.admin")}
                  </SelectItem>
                  <SelectItem value="booker">
                    {t("corporate.roles.booker")}
                  </SelectItem>
                  <SelectItem value="traveler">
                    {t("corporate.roles.traveler")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {t("corporate.roleHint." + newUserRole)}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddUserDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                // This would require a user lookup by email
                // For now, show a placeholder message
                toast.info(t("corporate.inviteSent"));
                setAddUserDialogOpen(false);
                setNewUserEmail("");
              }}
            >
              {t("corporate.sendInvite")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

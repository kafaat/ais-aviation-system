import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  Building2,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  DollarSign,
  Percent,
  TrendingUp,
  Mail,
  Phone,
  MapPin,
  FileText,
  Settings,
  Eye,
  Ban,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

type AccountStatus = "pending" | "active" | "suspended" | "closed";

export default function CorporateManagement() {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === "ar" ? ar : enUS;

  // Filter state
  const [statusFilter, setStatusFilter] = useState<AccountStatus | "all">(
    "all"
  );

  // Dialog state
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [creditLimit, setCreditLimit] = useState(0);
  const [discountPercent, setDiscountPercent] = useState(0);

  // Fetch data
  const {
    data: accounts,
    isLoading: accountsLoading,
    refetch: refetchAccounts,
  } = trpc.corporate.listAccounts.useQuery(
    statusFilter === "all" ? undefined : { status: statusFilter }
  );

  const { data: accountStats } = trpc.corporate.getAccountStats.useQuery(
    { id: selectedAccount?.id || 0 },
    { enabled: !!selectedAccount }
  );

  // Mutations
  const activateMutation = trpc.corporate.activateAccount.useMutation({
    onSuccess: () => {
      toast.success(t("corporate.admin.accountActivated"));
      refetchAccounts();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const suspendMutation = trpc.corporate.suspendAccount.useMutation({
    onSuccess: () => {
      toast.success(t("corporate.admin.accountSuspended"));
      refetchAccounts();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const updateMutation = trpc.corporate.updateAccount.useMutation({
    onSuccess: () => {
      toast.success(t("corporate.admin.accountUpdated"));
      setSettingsDialogOpen(false);
      refetchAccounts();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const openDetailsDialog = (account: any) => {
    setSelectedAccount(account);
    setDetailsDialogOpen(true);
  };

  const openSettingsDialog = (account: any) => {
    setSelectedAccount(account);
    setCreditLimit(account.creditLimit / 100);
    setDiscountPercent(Number(account.discountPercent) || 0);
    setSettingsDialogOpen(true);
  };

  const handleUpdateSettings = () => {
    if (!selectedAccount) return;
    updateMutation.mutate({
      id: selectedAccount.id,
      creditLimit: Math.round(creditLimit * 100),
      discountPercent,
    });
  };

  const getStatusBadge = (status: AccountStatus) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
            <Clock className="h-3 w-3 mr-1" />
            {t("corporate.admin.status.pending")}
          </Badge>
        );
      case "active":
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {t("corporate.admin.status.active")}
          </Badge>
        );
      case "suspended":
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700">
            <Ban className="h-3 w-3 mr-1" />
            {t("corporate.admin.status.suspended")}
          </Badge>
        );
      case "closed":
        return (
          <Badge variant="outline" className="bg-gray-50 text-gray-700">
            <XCircle className="h-3 w-3 mr-1" />
            {t("corporate.admin.status.closed")}
          </Badge>
        );
    }
  };

  // Calculate totals
  const totalAccounts = accounts?.length || 0;
  const pendingAccounts =
    accounts?.filter(a => a.status === "pending").length || 0;
  const activeAccounts =
    accounts?.filter(a => a.status === "active").length || 0;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Building2 className="h-8 w-8" />
          {t("corporate.admin.title")}
        </h1>
        <p className="text-muted-foreground">{t("corporate.admin.subtitle")}</p>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("corporate.admin.totalAccounts")}
            </p>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold">{totalAccounts}</p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("corporate.admin.allTime")}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("corporate.admin.pendingApproval")}
            </p>
            <Clock className="h-4 w-4 text-yellow-600" />
          </div>
          <p className="text-3xl font-bold text-yellow-600">
            {pendingAccounts}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("corporate.admin.awaitingReview")}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("corporate.admin.activeAccounts")}
            </p>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </div>
          <p className="text-3xl font-bold text-green-600">{activeAccounts}</p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("corporate.admin.currentlyActive")}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("corporate.admin.approvalRate")}
            </p>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold">
            {totalAccounts > 0
              ? Math.round((activeAccounts / totalAccounts) * 100)
              : 0}
            %
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("corporate.admin.ofTotal")}
          </p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <Label htmlFor="status-filter">
            {t("corporate.admin.filterByStatus")}
          </Label>
          <Select
            value={statusFilter}
            onValueChange={(value: AccountStatus | "all") =>
              setStatusFilter(value)
            }
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder={t("corporate.admin.allStatuses")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("corporate.admin.allStatuses")}
              </SelectItem>
              <SelectItem value="pending">
                {t("corporate.admin.status.pending")}
              </SelectItem>
              <SelectItem value="active">
                {t("corporate.admin.status.active")}
              </SelectItem>
              <SelectItem value="suspended">
                {t("corporate.admin.status.suspended")}
              </SelectItem>
              <SelectItem value="closed">
                {t("corporate.admin.status.closed")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Accounts Table */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">
          {t("corporate.admin.corporateAccounts")}
        </h2>

        {accountsLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : !accounts || accounts.length === 0 ? (
          <div className="text-center py-12">
            <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {t("corporate.admin.noAccounts")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("corporate.admin.id")}</TableHead>
                  <TableHead>{t("corporate.admin.companyName")}</TableHead>
                  <TableHead>{t("corporate.admin.contact")}</TableHead>
                  <TableHead>{t("corporate.admin.creditLimit")}</TableHead>
                  <TableHead>{t("corporate.admin.discount")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead>{t("corporate.admin.createdAt")}</TableHead>
                  <TableHead>{t("corporate.admin.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account: any) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">#{account.id}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-semibold">
                          {account.companyName}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {account.taxId}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm">{account.contactName}</span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {account.contactEmail}
                        </span>
                        {account.contactPhone && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {account.contactPhone}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1 font-semibold">
                        <DollarSign className="h-3 w-3" />
                        {(account.creditLimit / 100).toFixed(2)}{" "}
                        {t("common.sar")}
                      </span>
                    </TableCell>
                    <TableCell>
                      {Number(account.discountPercent) > 0 ? (
                        <span className="text-green-600 font-semibold flex items-center gap-1">
                          <Percent className="h-3 w-3" />
                          {account.discountPercent}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(account.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(account.createdAt), "PPp", {
                        locale: currentLocale,
                      })}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openDetailsDialog(account)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openSettingsDialog(account)}
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
                        {account.status === "pending" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-green-50 text-green-700 hover:bg-green-100"
                            onClick={() =>
                              activateMutation.mutate({ id: account.id })
                            }
                            disabled={activateMutation.isPending}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                        )}
                        {account.status === "active" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-red-50 text-red-700 hover:bg-red-100"
                            onClick={() =>
                              suspendMutation.mutate({ id: account.id })
                            }
                            disabled={suspendMutation.isPending}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                        {account.status === "suspended" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-green-50 text-green-700 hover:bg-green-100"
                            onClick={() =>
                              activateMutation.mutate({ id: account.id })
                            }
                            disabled={activateMutation.isPending}
                          >
                            <CheckCircle2 className="h-4 w-4" />
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

      {/* Details Dialog */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("corporate.admin.accountDetails")}</DialogTitle>
          </DialogHeader>
          {selectedAccount && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.admin.companyName")}
                  </p>
                  <p className="font-semibold">{selectedAccount.companyName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.admin.taxId")}
                  </p>
                  <p className="font-mono">{selectedAccount.taxId}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.admin.address")}
                  </p>
                  <p className="flex items-start gap-1">
                    <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
                    {selectedAccount.address || "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.admin.contactName")}
                  </p>
                  <p className="font-semibold">{selectedAccount.contactName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.admin.contactEmail")}
                  </p>
                  <p>{selectedAccount.contactEmail}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.admin.creditLimit")}
                  </p>
                  <p className="font-semibold">
                    {(selectedAccount.creditLimit / 100).toFixed(2)}{" "}
                    {t("common.sar")}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.admin.discount")}
                  </p>
                  <p className="font-semibold">
                    {selectedAccount.discountPercent}%
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("common.status")}
                  </p>
                  {getStatusBadge(selectedAccount.status)}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("corporate.admin.createdAt")}
                  </p>
                  <p>
                    {format(new Date(selectedAccount.createdAt), "PPp", {
                      locale: currentLocale,
                    })}
                  </p>
                </div>
              </div>

              {/* Account Statistics */}
              {accountStats && (
                <div className="border-t pt-4 mt-4">
                  <h4 className="font-semibold mb-2">
                    {t("corporate.admin.accountStats")}
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("corporate.admin.totalBookings")}:
                      </span>
                      <span className="font-semibold">
                        {accountStats.totalBookings}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("corporate.admin.totalSpent")}:
                      </span>
                      <span className="font-semibold">
                        {(accountStats.totalSpent / 100).toFixed(2)}{" "}
                        {t("common.sar")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("corporate.admin.teamMembers")}:
                      </span>
                      <span className="font-semibold">
                        {accountStats.userCount}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("corporate.admin.pendingApprovals")}:
                      </span>
                      <span className="font-semibold">
                        {accountStats.pendingApprovals}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setDetailsDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("corporate.admin.editSettings")}</DialogTitle>
            <DialogDescription>
              {t("corporate.admin.editSettingsDescription")}
            </DialogDescription>
          </DialogHeader>
          {selectedAccount && (
            <div className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="font-semibold">{selectedAccount.companyName}</p>
                <p className="text-sm text-muted-foreground">
                  {selectedAccount.taxId}
                </p>
              </div>
              <div>
                <Label htmlFor="creditLimit">
                  {t("corporate.admin.creditLimit")} ({t("common.sar")})
                </Label>
                <Input
                  id="creditLimit"
                  type="number"
                  min={0}
                  value={creditLimit}
                  onChange={e => setCreditLimit(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("corporate.admin.creditLimitHint")}
                </p>
              </div>
              <div>
                <Label htmlFor="discountPercent">
                  {t("corporate.admin.discountPercent")} (%)
                </Label>
                <Input
                  id="discountPercent"
                  type="number"
                  min={0}
                  max={100}
                  value={discountPercent}
                  onChange={e => setDiscountPercent(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("corporate.admin.discountHint")}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSettingsDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleUpdateSettings}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending
                ? t("common.loading")
                : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

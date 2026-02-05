import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Ticket,
  Plus,
  Wallet,
  Users,
  TrendingUp,
  Calendar,
  Edit,
  Trash2,
  Copy,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { useAuth } from "@/_core/hooks/useAuth";
import { Redirect } from "wouter";

type VoucherType = "fixed" | "percentage";

interface CreateVoucherForm {
  code: string;
  type: VoucherType;
  value: number;
  minPurchase: number;
  maxDiscount: number | null;
  maxUses: number | null;
  validFrom: string;
  validUntil: string;
  description: string;
  isActive: boolean;
}

const initialFormState: CreateVoucherForm = {
  code: "",
  type: "fixed",
  value: 0,
  minPurchase: 0,
  maxDiscount: null,
  maxUses: null,
  validFrom: new Date().toISOString().split("T")[0],
  validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0],
  description: "",
  isActive: true,
};

export default function VoucherManagement() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? ar : enUS;
  const { user, loading: authLoading } = useAuth();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [formData, setFormData] = useState<CreateVoucherForm>(initialFormState);
  const [activeTab, setActiveTab] = useState("vouchers");

  const {
    data: vouchers,
    isLoading: vouchersLoading,
    refetch: refetchVouchers,
  } = trpc.vouchers.getAll.useQuery({ includeInactive: true });

  const {
    data: credits,
    isLoading: creditsLoading,
    refetch: refetchCredits,
  } = trpc.vouchers.getAllCredits.useQuery({ limit: 100, offset: 0 });

  const createVoucherMutation = trpc.vouchers.create.useMutation({
    onSuccess: () => {
      toast.success(t("admin.voucher.created"));
      setIsCreateDialogOpen(false);
      setFormData(initialFormState);
      refetchVouchers();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deactivateVoucherMutation = trpc.vouchers.deactivate.useMutation({
    onSuccess: () => {
      toast.success(t("admin.voucher.deactivated"));
      refetchVouchers();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  if (authLoading) {
    return (
      <div className="container mx-auto max-w-7xl space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return <Redirect to="/" />;
  }

  const handleCreateVoucher = () => {
    createVoucherMutation.mutate({
      code: formData.code,
      type: formData.type,
      value: Math.round(formData.value * 100), // Convert to cents
      minPurchase: Math.round(formData.minPurchase * 100),
      maxDiscount: formData.maxDiscount
        ? Math.round(formData.maxDiscount * 100)
        : undefined,
      maxUses: formData.maxUses || undefined,
      validFrom: new Date(formData.validFrom),
      validUntil: new Date(formData.validUntil),
      description: formData.description || undefined,
      isActive: formData.isActive,
    });
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success(t("admin.voucher.codeCopied"));
  };

  const stats = {
    totalVouchers: vouchers?.length ?? 0,
    activeVouchers: vouchers?.filter((v) => v.isActive).length ?? 0,
    totalUsage: vouchers?.reduce((sum, v) => sum + v.usedCount, 0) ?? 0,
    totalCredits: credits?.reduce((sum, c) => sum + c.amount - c.usedAmount, 0) ?? 0,
  };

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <SEO
        title={t("admin.voucher.title")}
        description={t("admin.voucher.description")}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("admin.voucher.title")}</h1>
          <p className="text-muted-foreground">
            {t("admin.voucher.description")}
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {t("admin.voucher.create")}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{t("admin.voucher.createTitle")}</DialogTitle>
              <DialogDescription>
                {t("admin.voucher.createDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="code">{t("admin.voucher.code")}</Label>
                <Input
                  id="code"
                  value={formData.code}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      code: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="SUMMER2024"
                  className="uppercase"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="type">{t("admin.voucher.type")}</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value: VoucherType) =>
                      setFormData({ ...formData, type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">
                        {t("admin.voucher.typeFixed")}
                      </SelectItem>
                      <SelectItem value="percentage">
                        {t("admin.voucher.typePercentage")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="value">
                    {formData.type === "fixed"
                      ? t("admin.voucher.valueFixed")
                      : t("admin.voucher.valuePercentage")}
                  </Label>
                  <Input
                    id="value"
                    type="number"
                    min="0"
                    value={formData.value}
                    onChange={(e) =>
                      setFormData({ ...formData, value: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="minPurchase">
                    {t("admin.voucher.minPurchase")}
                  </Label>
                  <Input
                    id="minPurchase"
                    type="number"
                    min="0"
                    value={formData.minPurchase}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        minPurchase: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="maxUses">{t("admin.voucher.maxUses")}</Label>
                  <Input
                    id="maxUses"
                    type="number"
                    min="0"
                    value={formData.maxUses ?? ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        maxUses: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    placeholder={t("admin.voucher.unlimited")}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="validFrom">
                    {t("admin.voucher.validFrom")}
                  </Label>
                  <Input
                    id="validFrom"
                    type="date"
                    value={formData.validFrom}
                    onChange={(e) =>
                      setFormData({ ...formData, validFrom: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="validUntil">
                    {t("admin.voucher.validUntil")}
                  </Label>
                  <Input
                    id="validUntil"
                    type="date"
                    value={formData.validUntil}
                    onChange={(e) =>
                      setFormData({ ...formData, validUntil: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">
                  {t("admin.voucher.descriptionLabel")}
                </Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder={t("admin.voucher.descriptionPlaceholder")}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="isActive"
                  checked={formData.isActive}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, isActive: checked })
                  }
                />
                <Label htmlFor="isActive">{t("admin.voucher.active")}</Label>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsCreateDialogOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleCreateVoucher}
                disabled={createVoucherMutation.isPending || !formData.code}
              >
                {createVoucherMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {t("common.create")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.voucher.totalVouchers")}
            </CardTitle>
            <Ticket className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalVouchers}</div>
            <p className="text-xs text-muted-foreground">
              {stats.activeVouchers} {t("admin.voucher.active")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.voucher.totalUsage")}
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalUsage}</div>
            <p className="text-xs text-muted-foreground">
              {t("admin.voucher.timesUsed")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.voucher.totalCredits")}
            </CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(stats.totalCredits / 100).toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">{t("common.sar")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.voucher.creditUsers")}
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Set(credits?.map((c) => c.userId) ?? []).size}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("admin.voucher.usersWithCredits")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="vouchers">
            <Ticket className="mr-2 h-4 w-4" />
            {t("admin.voucher.vouchersTab")}
          </TabsTrigger>
          <TabsTrigger value="credits">
            <Wallet className="mr-2 h-4 w-4" />
            {t("admin.voucher.creditsTab")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="vouchers" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {vouchersLoading ? (
                <div className="space-y-4 p-6">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("admin.voucher.code")}</TableHead>
                      <TableHead>{t("admin.voucher.type")}</TableHead>
                      <TableHead>{t("admin.voucher.value")}</TableHead>
                      <TableHead>{t("admin.voucher.usage")}</TableHead>
                      <TableHead>{t("admin.voucher.validity")}</TableHead>
                      <TableHead>{t("admin.voucher.status")}</TableHead>
                      <TableHead>{t("common.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vouchers?.map((voucher) => (
                      <TableRow key={voucher.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <code className="rounded bg-muted px-2 py-1 font-mono text-sm">
                              {voucher.code}
                            </code>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleCopyCode(voucher.code)}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {voucher.type === "fixed"
                              ? t("admin.voucher.typeFixed")
                              : t("admin.voucher.typePercentage")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {voucher.type === "fixed"
                            ? `${(voucher.value / 100).toFixed(2)} ${t("common.sar")}`
                            : `${voucher.value}%`}
                        </TableCell>
                        <TableCell>
                          {voucher.usedCount}
                          {voucher.maxUses && ` / ${voucher.maxUses}`}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-xs">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(voucher.validFrom), "PP", {
                              locale,
                            })}{" "}
                            -{" "}
                            {format(new Date(voucher.validUntil), "PP", {
                              locale,
                            })}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={voucher.isActive ? "default" : "secondary"}
                          >
                            {voucher.isActive
                              ? t("admin.voucher.active")
                              : t("admin.voucher.inactive")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            {voucher.isActive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                onClick={() =>
                                  deactivateVoucherMutation.mutate({
                                    id: voucher.id,
                                  })
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {vouchers?.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="py-8 text-center text-muted-foreground"
                        >
                          {t("admin.voucher.noVouchers")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credits" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {creditsLoading ? (
                <div className="space-y-4 p-6">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("admin.voucher.creditUser")}</TableHead>
                      <TableHead>{t("admin.voucher.creditAmount")}</TableHead>
                      <TableHead>{t("admin.voucher.creditUsed")}</TableHead>
                      <TableHead>{t("admin.voucher.creditSource")}</TableHead>
                      <TableHead>{t("admin.voucher.creditExpires")}</TableHead>
                      <TableHead>{t("admin.voucher.creditCreated")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {credits?.map((credit) => (
                      <TableRow key={credit.id}>
                        <TableCell>#{credit.userId}</TableCell>
                        <TableCell>
                          {(credit.amount / 100).toFixed(2)} {t("common.sar")}
                        </TableCell>
                        <TableCell>
                          {(credit.usedAmount / 100).toFixed(2)} {t("common.sar")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {t(`credits.source.${credit.source}`)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {credit.expiresAt
                            ? format(new Date(credit.expiresAt), "PP", {
                                locale,
                              })
                            : t("admin.voucher.noExpiry")}
                        </TableCell>
                        <TableCell>
                          {format(new Date(credit.createdAt), "PP", { locale })}
                        </TableCell>
                      </TableRow>
                    ))}
                    {credits?.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-8 text-center text-muted-foreground"
                        >
                          {t("admin.voucher.noCredits")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

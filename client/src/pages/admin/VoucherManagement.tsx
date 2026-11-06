import { useState, type FormEvent } from "react";
import type { Voucher } from "../../../../drizzle/schema";
import {
  createVoucherInputSchema,
  updateVoucherPatchSchema,
  voucherLockedFields,
} from "@shared/voucher";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

interface VoucherForm {
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

const initialFormState: VoucherForm = {
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

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState<VoucherForm>(initialFormState);
  const [activeTab, setActiveTab] = useState("vouchers");
  const [editingVoucher, setEditingVoucher] = useState<Voucher | null>(null);
  const [formError, setFormError] = useState("");

  const {
    data: vouchers,
    isLoading: vouchersLoading,
    refetch: refetchVouchers,
  } = trpc.vouchers.getAll.useQuery({ includeInactive: true });

  const { data: credits, isLoading: creditsLoading } =
    trpc.vouchers.getAllCredits.useQuery({ limit: 100, offset: 0 });

  const usageHistory = trpc.vouchers.getUsageHistory.useQuery(
    { id: editingVoucher?.id ?? 0 },
    { enabled: isDialogOpen && editingVoucher !== null }
  );
  const termsLocked =
    !!editingVoucher &&
    (editingVoucher.isActive ||
      editingVoucher.usedCount > 0 ||
      usageHistory.isFetching ||
      usageHistory.isError ||
      !usageHistory.data ||
      usageHistory.data.length > 0);

  const finishSave = (message: string) => {
    toast.success(t(message));
    setIsDialogOpen(false);
    setEditingVoucher(null);
    setFormData(initialFormState);
    setFormError("");
    void refetchVouchers();
  };
  const showMutationError = (error: { message: string }) => {
    setFormError(error.message);
    toast.error(error.message);
  };

  const createVoucherMutation = trpc.vouchers.create.useMutation({
    onSuccess: () => finishSave("admin.voucher.created"),
    onError: showMutationError,
  });
  const updateVoucherMutation = trpc.vouchers.update.useMutation({
    onSuccess: () => finishSave("admin.voucher.updated"),
    onError: showMutationError,
  });
  const deactivateVoucherMutation = trpc.vouchers.deactivate.useMutation({
    onSuccess: () => finishSave("admin.voucher.deactivated"),
    onError: showMutationError,
  });
  const isSaving =
    createVoucherMutation.isPending ||
    updateVoucherMutation.isPending ||
    deactivateVoucherMutation.isPending;

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

  const openCreate = () => {
    setEditingVoucher(null);
    setFormData(initialFormState);
    setFormError("");
    setIsDialogOpen(true);
  };
  const openEdit = (voucher: Voucher) => {
    setEditingVoucher(voucher);
    setFormData({
      code: voucher.code,
      type: voucher.type,
      value: voucher.type === "fixed" ? voucher.value / 100 : voucher.value,
      minPurchase: voucher.minPurchase / 100,
      maxDiscount:
        voucher.maxDiscount === null ? null : voucher.maxDiscount / 100,
      maxUses: voucher.maxUses,
      validFrom: new Date(voucher.validFrom).toISOString().slice(0, 10),
      validUntil: new Date(voucher.validUntil).toISOString().slice(0, 10),
      description: voucher.description ?? "",
      isActive: voucher.isActive,
    });
    setFormError("");
    setIsDialogOpen(true);
  };
  const handleSaveVoucher = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;
    setFormError("");
    const money = [
      formData.minPurchase,
      ...(formData.type === "fixed" ? [formData.value] : []),
      ...(formData.maxDiscount === null ? [] : [formData.maxDiscount]),
    ];
    if (
      money.some(
        value =>
          !Number.isFinite(value) ||
          Math.abs(value * 100 - Math.round(value * 100)) > 0.000001
      )
    ) {
      setFormError(t("admin.voucher.moneyPrecision"));
      return;
    }
    // Preserve stored timestamps when the date field was not changed.
    const dateValue = (field: "validFrom" | "validUntil") => {
      const original = editingVoucher && new Date(editingVoucher[field]);
      return original && original.toISOString().slice(0, 10) === formData[field]
        ? original
        : new Date(formData[field]);
    };
    const result = createVoucherInputSchema.safeParse({
      code: formData.code,
      type: formData.type,
      value:
        formData.type === "fixed"
          ? Math.round(formData.value * 100)
          : formData.value,
      minPurchase: Math.round(formData.minPurchase * 100),
      maxDiscount:
        formData.maxDiscount === null
          ? null
          : Math.round(formData.maxDiscount * 100),
      maxUses: formData.maxUses,
      validFrom: dateValue("validFrom"),
      validUntil: dateValue("validUntil"),
      description: formData.description || null,
      isActive: formData.isActive,
    });
    if (!result.success) {
      setFormError(t("admin.voucher.invalidFields"));
      return;
    }
    if (!editingVoucher) {
      createVoucherMutation.mutate(result.data);
      return;
    }
    const { code: _code, ...editable } = result.data;
    const patch = updateVoucherPatchSchema.parse(
      Object.fromEntries(
        Object.entries(editable).filter(([field, value]) => {
          if (
            termsLocked &&
            voucherLockedFields.includes(
              field as (typeof voucherLockedFields)[number]
            )
          )
            return false;
          const original = editingVoucher[field as keyof typeof editable];
          return value instanceof Date && original instanceof Date
            ? value.getTime() !== original.getTime()
            : value !== original;
        })
      )
    );
    updateVoucherMutation.mutate({ id: editingVoucher.id, ...patch });
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success(t("admin.voucher.codeCopied"));
  };

  const stats = {
    totalVouchers: vouchers?.length ?? 0,
    activeVouchers: vouchers?.filter(v => v.isActive).length ?? 0,
    totalUsage: vouchers?.reduce((sum, v) => sum + v.usedCount, 0) ?? 0,
    totalCredits:
      credits?.reduce((sum, c) => sum + c.amount - c.usedAmount, 0) ?? 0,
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
        <Dialog
          open={isDialogOpen}
          onOpenChange={open => {
            if (!isSaving) setIsDialogOpen(open);
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              {t("admin.voucher.create")}
            </Button>
          </DialogTrigger>
          <DialogContent
            className="max-h-[90vh] overflow-y-auto sm:max-w-[500px]"
            dir={i18n.language === "ar" ? "rtl" : "ltr"}
          >
            <form onSubmit={handleSaveVoucher} aria-busy={isSaving}>
              <DialogHeader>
                <DialogTitle>
                  {t(
                    editingVoucher
                      ? "admin.voucher.editTitle"
                      : "admin.voucher.createTitle"
                  )}
                </DialogTitle>
                <DialogDescription>
                  {t(
                    editingVoucher
                      ? "admin.voucher.editDescription"
                      : "admin.voucher.createDescription"
                  )}
                </DialogDescription>
              </DialogHeader>
              {editingVoucher && termsLocked && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t(
                    editingVoucher.usedCount > 0 ||
                      (usageHistory.data?.length ?? 0) > 0
                      ? "admin.voucher.usedTermsLocked"
                      : editingVoucher.isActive
                        ? "admin.voucher.activeTermsLocked"
                        : "admin.voucher.checkingUsage"
                  )}
                </p>
              )}
              {usageHistory.error && editingVoucher && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {t("admin.voucher.usageUnavailable")}
                </p>
              )}
              {formError && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {formError}
                </p>
              )}
              <fieldset disabled={isSaving} className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="code">{t("admin.voucher.code")}</Label>
                  <Input
                    id="code"
                    required
                    minLength={3}
                    maxLength={50}
                    disabled={!!editingVoucher}
                    value={formData.code}
                    onChange={e =>
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
                      disabled={termsLocked || isSaving}
                      onValueChange={(value: VoucherType) =>
                        setFormData({
                          ...formData,
                          type: value,
                          maxDiscount:
                            value === "fixed" ? null : formData.maxDiscount,
                        })
                      }
                    >
                      <SelectTrigger id="type">
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
                      required
                      disabled={termsLocked}
                      min={formData.type === "fixed" ? "0.01" : "1"}
                      max={
                        formData.type === "percentage" ? "100" : "21474836.47"
                      }
                      step={formData.type === "fixed" ? "0.01" : "1"}
                      value={formData.value}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          value: Number(e.target.value),
                        })
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
                      required
                      disabled={termsLocked}
                      min="0"
                      max="21474836.47"
                      step="0.01"
                      value={formData.minPurchase}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          minPurchase: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="maxUses">
                      {t("admin.voucher.maxUses")}
                    </Label>
                    <Input
                      id="maxUses"
                      type="number"
                      min={Math.max(1, editingVoucher?.usedCount ?? 0)}
                      max="2147483647"
                      step="1"
                      value={formData.maxUses ?? ""}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          maxUses: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                      placeholder={t("admin.voucher.unlimited")}
                    />
                  </div>
                </div>
                {formData.type === "percentage" && (
                  <div className="grid gap-2">
                    <Label htmlFor="maxDiscount">
                      {t("admin.voucher.maxDiscount")}
                    </Label>
                    <Input
                      id="maxDiscount"
                      type="number"
                      min="0.01"
                      max="21474836.47"
                      step="0.01"
                      disabled={termsLocked}
                      value={formData.maxDiscount ?? ""}
                      onChange={event =>
                        setFormData({
                          ...formData,
                          maxDiscount:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                      placeholder={t("admin.voucher.unlimited")}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="validFrom">
                      {t("admin.voucher.validFrom")}
                    </Label>
                    <Input
                      id="validFrom"
                      type="date"
                      required
                      disabled={termsLocked}
                      value={formData.validFrom}
                      onChange={e =>
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
                      required
                      value={formData.validUntil}
                      onChange={e =>
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
                    onChange={e =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    placeholder={t("admin.voucher.descriptionPlaceholder")}
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="isActive"
                    checked={formData.isActive}
                    onCheckedChange={checked =>
                      setFormData({ ...formData, isActive: checked })
                    }
                  />
                  <Label htmlFor="isActive">{t("admin.voucher.active")}</Label>
                </div>
              </fieldset>
              <DialogFooter className="gap-2">
                {editingVoucher?.isActive && (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={isSaving}
                    onClick={() =>
                      deactivateVoucherMutation.mutate({
                        id: editingVoucher.id,
                      })
                    }
                  >
                    {t("admin.voucher.deactivate")}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSaving}
                  onClick={() => setIsDialogOpen(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={isSaving || !formData.code}>
                  {isSaving && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {t(editingVoucher ? "common.save" : "common.create")}
                </Button>
              </DialogFooter>
            </form>
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
              {new Set(credits?.map(c => c.userId) ?? []).size}
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
                  {[1, 2, 3].map(i => (
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
                    {vouchers?.map(voucher => (
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
                              aria-label={t("admin.voucher.copyAction", {
                                code: voucher.code,
                              })}
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
                              aria-label={t("admin.voucher.editAction", {
                                code: voucher.code,
                              })}
                              disabled={isSaving}
                              onClick={() => openEdit(voucher)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            {voucher.isActive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                aria-label={t(
                                  "admin.voucher.deactivateAction",
                                  { code: voucher.code }
                                )}
                                disabled={isSaving}
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
                  {[1, 2, 3].map(i => (
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
                    {credits?.map(credit => (
                      <TableRow key={credit.id}>
                        <TableCell>#{credit.userId}</TableCell>
                        <TableCell>
                          {(credit.amount / 100).toFixed(2)} {t("common.sar")}
                        </TableCell>
                        <TableCell>
                          {(credit.usedAmount / 100).toFixed(2)}{" "}
                          {t("common.sar")}
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

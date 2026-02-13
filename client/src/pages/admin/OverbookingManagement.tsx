/**
 * Overbooking Management Admin Page
 *
 * Manage overbooking configurations, view denied boarding records,
 * and monitor inventory status for flights.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  AlertTriangle,
  Plus,
  Settings,
  Users,
  Plane,
  TrendingUp,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

export default function OverbookingManagement() {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [flightIdInput, setFlightIdInput] = useState("");

  // Form state for new config
  const [newConfig, setNewConfig] = useState({
    economyRate: "0.05",
    businessRate: "0.02",
    maxOverbooking: 10,
    historicalNoShowRate: "0.08",
    scope: "global" as "global" | "airline" | "route",
    airlineId: "",
    originId: "",
    destinationId: "",
  });

  // Queries
  const {
    data: configsData,
    isLoading: configsLoading,
    refetch: refetchConfigs,
  } = trpc.inventory.getOverbookingConfigs.useQuery();

  const flightId = parseInt(flightIdInput);
  const {
    data: deniedRecords,
    isLoading: recordsLoading,
    refetch: refetchRecords,
  } = trpc.inventory.getDeniedBoardingRecords.useQuery(
    { flightId },
    { enabled: !isNaN(flightId) && flightId > 0 }
  );

  const { data: recommendedData, isLoading: recommendedLoading } =
    trpc.inventory.getRecommendedOverbooking.useQuery(
      { flightId },
      { enabled: !isNaN(flightId) && flightId > 0 }
    );

  // Mutations
  const createConfigMutation =
    trpc.inventory.createOverbookingConfig.useMutation({
      onSuccess: () => {
        toast.success(t("overbooking.configCreated"));
        setCreateOpen(false);
        refetchConfigs();
      },
      onError: err => {
        toast.error(err.message);
      },
    });

  const updateStatusMutation =
    trpc.inventory.updateDeniedBoardingStatus.useMutation({
      onSuccess: () => {
        toast.success(t("overbooking.statusUpdated"));
        refetchRecords();
      },
      onError: err => {
        toast.error(err.message);
      },
    });

  const handleCreateConfig = () => {
    createConfigMutation.mutate({
      economyRate: newConfig.economyRate,
      businessRate: newConfig.businessRate,
      maxOverbooking: newConfig.maxOverbooking,
      historicalNoShowRate: newConfig.historicalNoShowRate,
      ...(newConfig.scope === "airline" && newConfig.airlineId
        ? { airlineId: parseInt(newConfig.airlineId) }
        : {}),
      ...(newConfig.scope === "route" &&
      newConfig.originId &&
      newConfig.destinationId
        ? {
            originId: parseInt(newConfig.originId),
            destinationId: parseInt(newConfig.destinationId),
          }
        : {}),
    });
  };

  const configs = configsData?.data ?? [];
  const records = deniedRecords?.data ?? [];

  const getScope = (cfg: (typeof configs)[0]) => {
    if (cfg.originId && cfg.destinationId) return t("overbooking.route");
    if (cfg.airlineId) return t("overbooking.airline");
    return t("overbooking.global");
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge
            variant="outline"
            className="bg-yellow-50 text-yellow-700 border-yellow-200"
          >
            {t("overbooking.pending")}
          </Badge>
        );
      case "accepted":
        return (
          <Badge
            variant="outline"
            className="bg-green-50 text-green-700 border-green-200"
          >
            {t("overbooking.accepted")}
          </Badge>
        );
      case "rejected":
        return (
          <Badge
            variant="outline"
            className="bg-red-50 text-red-700 border-red-200"
          >
            {t("overbooking.rejected")}
          </Badge>
        );
      case "completed":
        return (
          <Badge
            variant="outline"
            className="bg-blue-50 text-blue-700 border-blue-200"
          >
            {t("overbooking.completed")}
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-orange-50/30 to-slate-50 dark:from-slate-950 dark:via-orange-950/10 dark:to-slate-950">
      <SEO title={t("overbooking.title")} />

      <div className="container py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-orange-500" />
              {t("overbooking.title")}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t("overbooking.subtitle")}
            </p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700">
                <Plus className="h-4 w-4 me-2" />
                {t("overbooking.createConfig")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("overbooking.createConfig")}</DialogTitle>
                <DialogDescription>
                  {t("overbooking.subtitle")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>{t("overbooking.scope")}</Label>
                  <Select
                    value={newConfig.scope}
                    onValueChange={v =>
                      setNewConfig(prev => ({
                        ...prev,
                        scope: v as "global" | "airline" | "route",
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">
                        {t("overbooking.global")}
                      </SelectItem>
                      <SelectItem value="airline">
                        {t("overbooking.airline")}
                      </SelectItem>
                      <SelectItem value="route">
                        {t("overbooking.route")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {newConfig.scope === "airline" && (
                  <div>
                    <Label>Airline ID</Label>
                    <Input
                      type="number"
                      value={newConfig.airlineId}
                      onChange={e =>
                        setNewConfig(prev => ({
                          ...prev,
                          airlineId: e.target.value,
                        }))
                      }
                    />
                  </div>
                )}

                {newConfig.scope === "route" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Origin ID</Label>
                      <Input
                        type="number"
                        value={newConfig.originId}
                        onChange={e =>
                          setNewConfig(prev => ({
                            ...prev,
                            originId: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <Label>Destination ID</Label>
                      <Input
                        type="number"
                        value={newConfig.destinationId}
                        onChange={e =>
                          setNewConfig(prev => ({
                            ...prev,
                            destinationId: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{t("overbooking.economyRate")}</Label>
                    <Input
                      value={newConfig.economyRate}
                      onChange={e =>
                        setNewConfig(prev => ({
                          ...prev,
                          economyRate: e.target.value,
                        }))
                      }
                      placeholder="0.05"
                    />
                  </div>
                  <div>
                    <Label>{t("overbooking.businessRate")}</Label>
                    <Input
                      value={newConfig.businessRate}
                      onChange={e =>
                        setNewConfig(prev => ({
                          ...prev,
                          businessRate: e.target.value,
                        }))
                      }
                      placeholder="0.02"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{t("overbooking.maxOverbooking")}</Label>
                    <Input
                      type="number"
                      value={newConfig.maxOverbooking}
                      onChange={e =>
                        setNewConfig(prev => ({
                          ...prev,
                          maxOverbooking: parseInt(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label>{t("overbooking.noShowRate")}</Label>
                    <Input
                      value={newConfig.historicalNoShowRate}
                      onChange={e =>
                        setNewConfig(prev => ({
                          ...prev,
                          historicalNoShowRate: e.target.value,
                        }))
                      }
                      placeholder="0.08"
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleCreateConfig}
                  disabled={createConfigMutation.isPending}
                >
                  {createConfigMutation.isPending
                    ? t("common.saving")
                    : t("overbooking.createConfig")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="configs" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:inline-grid">
            <TabsTrigger value="configs" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              {t("overbooking.configs")}
            </TabsTrigger>
            <TabsTrigger value="denied" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              {t("overbooking.deniedBoarding")}
            </TabsTrigger>
            <TabsTrigger
              value="recommendations"
              className="flex items-center gap-2"
            >
              <TrendingUp className="h-4 w-4" />
              {t("overbooking.recommendations")}
            </TabsTrigger>
          </TabsList>

          {/* Configs Tab */}
          <TabsContent value="configs">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{t("overbooking.configs")}</CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => refetchConfigs()}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent>
                {configsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : configs.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">
                    {t("overbooking.noConfigs")}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("overbooking.scope")}</TableHead>
                        <TableHead>{t("overbooking.economyRate")}</TableHead>
                        <TableHead>{t("overbooking.businessRate")}</TableHead>
                        <TableHead>{t("overbooking.maxOverbooking")}</TableHead>
                        <TableHead>{t("overbooking.noShowRate")}</TableHead>
                        <TableHead>{t("overbooking.status")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {configs.map(cfg => (
                        <TableRow key={cfg.id}>
                          <TableCell className="font-medium">
                            {getScope(cfg)}
                            {cfg.originId &&
                              cfg.destinationId &&
                              ` (${cfg.originId} → ${cfg.destinationId})`}
                            {cfg.airlineId &&
                              !cfg.originId &&
                              ` (ID: ${cfg.airlineId})`}
                          </TableCell>
                          <TableCell>
                            {(Number(cfg.economyRate) * 100).toFixed(1)}%
                          </TableCell>
                          <TableCell>
                            {(Number(cfg.businessRate) * 100).toFixed(1)}%
                          </TableCell>
                          <TableCell>{cfg.maxOverbooking}</TableCell>
                          <TableCell>
                            {cfg.historicalNoShowRate
                              ? `${(Number(cfg.historicalNoShowRate) * 100).toFixed(1)}%`
                              : "-"}
                          </TableCell>
                          <TableCell>
                            {cfg.isActive ? (
                              <Badge
                                variant="outline"
                                className="bg-green-50 text-green-700 border-green-200"
                              >
                                {t("overbooking.active")}
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Inactive</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Denied Boarding Tab */}
          <TabsContent value="denied">
            <Card>
              <CardHeader>
                <CardTitle>{t("overbooking.deniedBoarding")}</CardTitle>
                <CardDescription>
                  <div className="flex items-center gap-2 mt-2">
                    <Input
                      placeholder="Flight ID"
                      value={flightIdInput}
                      onChange={e => setFlightIdInput(e.target.value)}
                      className="w-40"
                      type="number"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refetchRecords()}
                      disabled={!flightIdInput}
                    >
                      <Plane className="h-4 w-4 me-2" />
                      {t("common.search")}
                    </Button>
                  </div>
                </CardDescription>
              </CardHeader>
              <CardContent>
                {recordsLoading ? (
                  <div className="space-y-3">
                    {[1, 2].map(i => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : records.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">
                    {t("overbooking.noDeniedRecords")}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>{t("overbooking.deniedType")}</TableHead>
                        <TableHead>
                          {t("overbooking.compensationAmount")}
                        </TableHead>
                        <TableHead>
                          {t("overbooking.compensationType")}
                        </TableHead>
                        <TableHead>
                          {t("overbooking.alternativeFlight")}
                        </TableHead>
                        <TableHead>{t("overbooking.status")}</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {records.map(record => (
                        <TableRow key={record.id}>
                          <TableCell>{record.id}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                record.type === "voluntary"
                                  ? "outline"
                                  : "destructive"
                              }
                            >
                              {record.type === "voluntary"
                                ? t("overbooking.voluntary")
                                : t("overbooking.involuntary")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {(record.compensationAmount / 100).toFixed(2)} SAR
                          </TableCell>
                          <TableCell>{record.compensationType}</TableCell>
                          <TableCell>
                            {record.alternativeFlightId ?? "-"}
                          </TableCell>
                          <TableCell>{statusBadge(record.status)}</TableCell>
                          <TableCell>
                            {record.status === "pending" && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-green-600"
                                  onClick={() =>
                                    updateStatusMutation.mutate({
                                      recordId: record.id,
                                      status: "accepted",
                                    })
                                  }
                                  disabled={updateStatusMutation.isPending}
                                >
                                  {t("overbooking.accepted")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-600"
                                  onClick={() =>
                                    updateStatusMutation.mutate({
                                      recordId: record.id,
                                      status: "rejected",
                                    })
                                  }
                                  disabled={updateStatusMutation.isPending}
                                >
                                  {t("overbooking.rejected")}
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Recommendations Tab */}
          <TabsContent value="recommendations">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-blue-500" />
                  {t("overbooking.recommendations")}
                </CardTitle>
                <CardDescription>
                  <div className="flex items-center gap-2 mt-2">
                    <Input
                      placeholder="Flight ID"
                      value={flightIdInput}
                      onChange={e => setFlightIdInput(e.target.value)}
                      className="w-40"
                      type="number"
                    />
                  </div>
                </CardDescription>
              </CardHeader>
              <CardContent>
                {recommendedLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-20 w-full" />
                  </div>
                ) : recommendedData?.data ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200">
                      <CardContent className="pt-6">
                        <div className="text-center">
                          <p className="text-sm text-muted-foreground mb-1">
                            {t("overbooking.economyRate")}
                          </p>
                          <p className="text-3xl font-bold text-blue-700 dark:text-blue-300">
                            {recommendedData.data.economy}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {t("overbooking.recommendedSeats")}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-purple-50 dark:bg-purple-900/20 border-purple-200">
                      <CardContent className="pt-6">
                        <div className="text-center">
                          <p className="text-sm text-muted-foreground mb-1">
                            {t("overbooking.businessRate")}
                          </p>
                          <p className="text-3xl font-bold text-purple-700 dark:text-purple-300">
                            {recommendedData.data.business}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {t("overbooking.recommendedSeats")}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                ) : (
                  <p className="text-center py-8 text-muted-foreground">
                    {t("overbooking.enterFlightId")}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

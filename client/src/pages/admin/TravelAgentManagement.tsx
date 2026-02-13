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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Building2,
  CheckCircle2,
  XCircle,
  Key,
  RefreshCw,
  DollarSign,
  TrendingUp,
  Plane,
  Copy,
  Eye,
  EyeOff,
  Percent,
  CreditCard,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export default function TravelAgentManagement() {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === "ar" ? ar : enUS;

  // State
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [selectedAgent, setSelectedAgent] = useState<any>(null);
  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
  const [credentialsDialogOpen, setCredentialsDialogOpen] = useState(false);
  const [commissionDialogOpen, setCommissionDialogOpen] = useState(false);
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [newCredentials, setNewCredentials] = useState<{
    apiKey: string;
    apiSecret: string;
  } | null>(null);

  // Form state for registration
  const [registerForm, setRegisterForm] = useState({
    agencyName: "",
    iataNumber: "",
    contactName: "",
    email: "",
    phone: "",
    commissionRate: 5,
    dailyBookingLimit: 100,
    monthlyBookingLimit: 2000,
  });

  const [newCommissionRate, setNewCommissionRate] = useState(5);

  // Queries
  const {
    data: agentsData,
    isLoading: agentsLoading,
    refetch: refetchAgents,
  } = trpc.travelAgent.list.useQuery(
    statusFilter === "all" ? undefined : { isActive: statusFilter === "active" }
  );

  const { data: pendingCommissions, refetch: refetchCommissions } =
    trpc.travelAgent.getPendingCommissions.useQuery();

  const { data: agentStats, isLoading: statsLoading } =
    trpc.travelAgent.getAgentStats.useQuery(
      { id: selectedAgent?.id || 0 },
      { enabled: !!selectedAgent && statsDialogOpen }
    );

  // Mutations
  const registerMutation = trpc.travelAgent.register.useMutation({
    onSuccess: data => {
      toast.success(t("travelAgent.admin.registerSuccess"));
      setNewCredentials(data.credentials);
      setCredentialsDialogOpen(true);
      setRegisterDialogOpen(false);
      resetRegisterForm();
      refetchAgents();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const regenerateCredentialsMutation =
    trpc.travelAgent.regenerateCredentials.useMutation({
      onSuccess: data => {
        toast.success(t("travelAgent.admin.credentialsRegenerated"));
        setNewCredentials(data);
        setCredentialsDialogOpen(true);
      },
      onError: error => {
        toast.error(error.message);
      },
    });

  const updateStatusMutation = trpc.travelAgent.updateStatus.useMutation({
    onSuccess: () => {
      toast.success(t("travelAgent.admin.statusUpdated"));
      refetchAgents();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const updateCommissionMutation =
    trpc.travelAgent.updateCommissionRate.useMutation({
      onSuccess: () => {
        toast.success(t("travelAgent.admin.commissionUpdated"));
        setCommissionDialogOpen(false);
        refetchAgents();
      },
      onError: error => {
        toast.error(error.message);
      },
    });

  const updateCommissionStatusMutation =
    trpc.travelAgent.updateCommissionStatus.useMutation({
      onSuccess: () => {
        toast.success(t("travelAgent.admin.commissionStatusUpdated"));
        refetchCommissions();
      },
      onError: error => {
        toast.error(error.message);
      },
    });

  // Handlers
  const resetRegisterForm = () => {
    setRegisterForm({
      agencyName: "",
      iataNumber: "",
      contactName: "",
      email: "",
      phone: "",
      commissionRate: 5,
      dailyBookingLimit: 100,
      monthlyBookingLimit: 2000,
    });
  };

  const handleRegister = () => {
    if (
      !registerForm.agencyName ||
      !registerForm.iataNumber ||
      !registerForm.contactName ||
      !registerForm.email ||
      !registerForm.phone
    ) {
      toast.error(
        t("common.fillAllFields") || "Please fill all required fields"
      );
      return;
    }
    registerMutation.mutate(registerForm);
  };

  const handleToggleStatus = (agent: any) => {
    updateStatusMutation.mutate({
      id: agent.id,
      isActive: !agent.isActive,
    });
  };

  const handleRegenerateCredentials = (agent: any) => {
    if (
      confirm(
        t("travelAgent.admin.confirmRegenerate") ||
          "Are you sure? This will invalidate the current API credentials."
      )
    ) {
      regenerateCredentialsMutation.mutate({ id: agent.id });
    }
  };

  const handleUpdateCommission = () => {
    if (!selectedAgent) return;
    updateCommissionMutation.mutate({
      id: selectedAgent.id,
      commissionRate: newCommissionRate,
    });
  };

  const handleApproveCommission = (id: number) => {
    updateCommissionStatusMutation.mutate({ id, status: "approved" });
  };

  const handlePayCommission = (id: number) => {
    updateCommissionStatusMutation.mutate({ id, status: "paid" });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t("common.copied") || "Copied to clipboard");
  };

  const openCommissionDialog = (agent: any) => {
    setSelectedAgent(agent);
    setNewCommissionRate(parseFloat(agent.commissionRate));
    setCommissionDialogOpen(true);
  };

  const openStatsDialog = (agent: any) => {
    setSelectedAgent(agent);
    setStatsDialogOpen(true);
  };

  if (agentsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const agents = agentsData?.agents || [];
  const totalAgents = agentsData?.total || 0;
  const activeAgents = agents.filter((a: any) => a.isActive).length;
  const totalRevenue = agents.reduce(
    (sum: number, a: any) => sum + a.totalRevenue,
    0
  );
  const totalCommission = agents.reduce(
    (sum: number, a: any) => sum + a.totalCommission,
    0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">
            {t("travelAgent.admin.title") || "Travel Agent Management"}
          </h1>
          <p className="text-muted-foreground">
            {t("travelAgent.admin.subtitle") ||
              "Manage travel agents and their API access"}
          </p>
        </div>
        <Button onClick={() => setRegisterDialogOpen(true)}>
          <Building2 className="h-4 w-4 mr-2" />
          {t("travelAgent.admin.registerAgent") || "Register Agent"}
        </Button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("travelAgent.admin.totalAgents") || "Total Agents"}
            </p>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold">{totalAgents}</p>
          <p className="text-xs text-muted-foreground mt-2">
            {activeAgents} {t("travelAgent.admin.active") || "active"}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("travelAgent.admin.totalBookings") || "Total Bookings"}
            </p>
            <Plane className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold">
            {agents.reduce((sum: number, a: any) => sum + a.totalBookings, 0)}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("travelAgent.admin.allAgents") || "All agents"}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("travelAgent.admin.totalRevenue") || "Total Revenue"}
            </p>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </div>
          <p className="text-3xl font-bold text-green-600">
            {(totalRevenue / 100).toLocaleString()} {t("common.sar")}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("travelAgent.admin.fromAgentBookings") || "From agent bookings"}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("travelAgent.admin.totalCommission") || "Total Commission"}
            </p>
            <DollarSign className="h-4 w-4 text-blue-600" />
          </div>
          <p className="text-3xl font-bold text-blue-600">
            {(totalCommission / 100).toLocaleString()} {t("common.sar")}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("travelAgent.admin.payable") || "Payable to agents"}
          </p>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="agents">
        <TabsList>
          <TabsTrigger value="agents">
            {t("travelAgent.admin.agents") || "Agents"}
          </TabsTrigger>
          <TabsTrigger value="commissions">
            {t("travelAgent.admin.pendingCommissions") || "Pending Commissions"}
            {pendingCommissions && pendingCommissions.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {pendingCommissions.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Agents Tab */}
        <TabsContent value="agents" className="space-y-4">
          {/* Filters */}
          <Card className="p-4">
            <div className="flex items-center gap-4">
              <Label>
                {t("travelAgent.admin.filterByStatus") || "Filter by Status"}
              </Label>
              <Select
                value={statusFilter}
                onValueChange={(value: "all" | "active" | "inactive") =>
                  setStatusFilter(value)
                }
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("travelAgent.admin.allStatuses") || "All Statuses"}
                  </SelectItem>
                  <SelectItem value="active">
                    {t("travelAgent.admin.activeOnly") || "Active Only"}
                  </SelectItem>
                  <SelectItem value="inactive">
                    {t("travelAgent.admin.inactiveOnly") || "Inactive Only"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Card>

          {/* Agents Table */}
          <Card className="p-6">
            {agents.length === 0 ? (
              <div className="text-center py-12">
                <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  {t("travelAgent.admin.noAgents") || "No travel agents found"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t("travelAgent.admin.agency") || "Agency"}
                      </TableHead>
                      <TableHead>
                        {t("travelAgent.admin.iataNumber") || "IATA #"}
                      </TableHead>
                      <TableHead>
                        {t("travelAgent.admin.contact") || "Contact"}
                      </TableHead>
                      <TableHead>
                        {t("travelAgent.admin.commission") || "Commission"}
                      </TableHead>
                      <TableHead>
                        {t("travelAgent.admin.bookings") || "Bookings"}
                      </TableHead>
                      <TableHead>
                        {t("travelAgent.admin.status") || "Status"}
                      </TableHead>
                      <TableHead>
                        {t("travelAgent.admin.actions") || "Actions"}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agents.map((agent: any) => (
                      <TableRow key={agent.id}>
                        <TableCell>
                          <div className="font-medium">{agent.agencyName}</div>
                          <div className="text-xs text-muted-foreground">
                            ID: {agent.id}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{agent.iataNumber}</Badge>
                        </TableCell>
                        <TableCell>
                          <div>{agent.contactName}</div>
                          <div className="text-xs text-muted-foreground">
                            {agent.email}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-semibold">
                            {agent.commissionRate}%
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span>{agent.totalBookings}</span>
                            <span className="text-xs text-muted-foreground">
                              {(agent.totalRevenue / 100).toLocaleString()}{" "}
                              {t("common.sar")}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {agent.isActive ? (
                            <Badge className="bg-green-100 text-green-700">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              {t("travelAgent.admin.active") || "Active"}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              <XCircle className="h-3 w-3 mr-1" />
                              {t("travelAgent.admin.inactive") || "Inactive"}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openStatsDialog(agent)}
                              title={
                                t("travelAgent.admin.viewStats") || "View Stats"
                              }
                            >
                              <TrendingUp className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openCommissionDialog(agent)}
                              title={
                                t("travelAgent.admin.editCommission") ||
                                "Edit Commission"
                              }
                            >
                              <Percent className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRegenerateCredentials(agent)}
                              title={
                                t("travelAgent.admin.regenerateCredentials") ||
                                "Regenerate Credentials"
                              }
                            >
                              <Key className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant={
                                agent.isActive ? "destructive" : "default"
                              }
                              onClick={() => handleToggleStatus(agent)}
                            >
                              {agent.isActive ? (
                                <>
                                  <XCircle className="h-4 w-4 mr-1" />
                                  {t("travelAgent.admin.deactivate") ||
                                    "Deactivate"}
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="h-4 w-4 mr-1" />
                                  {t("travelAgent.admin.activate") ||
                                    "Activate"}
                                </>
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* Commissions Tab */}
        <TabsContent value="commissions">
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">
              {t("travelAgent.admin.pendingCommissions") ||
                "Pending Commissions"}
            </h2>
            {!pendingCommissions || pendingCommissions.length === 0 ? (
              <div className="text-center py-12">
                <CreditCard className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  {t("travelAgent.admin.noCommissions") ||
                    "No pending commissions"}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("travelAgent.admin.agency") || "Agency"}
                    </TableHead>
                    <TableHead>
                      {t("travelAgent.admin.bookingRef") || "Booking Ref"}
                    </TableHead>
                    <TableHead>
                      {t("travelAgent.admin.bookingAmount") || "Booking Amount"}
                    </TableHead>
                    <TableHead>
                      {t("travelAgent.admin.rate") || "Rate"}
                    </TableHead>
                    <TableHead>
                      {t("travelAgent.admin.commissionAmount") || "Commission"}
                    </TableHead>
                    <TableHead>
                      {t("travelAgent.admin.date") || "Date"}
                    </TableHead>
                    <TableHead>
                      {t("travelAgent.admin.actions") || "Actions"}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingCommissions.map((commission: any) => (
                    <TableRow key={commission.id}>
                      <TableCell className="font-medium">
                        {commission.agencyName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {commission.bookingReference}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {(commission.bookingAmount / 100).toLocaleString()}{" "}
                        {t("common.sar")}
                      </TableCell>
                      <TableCell>{commission.commissionRate}%</TableCell>
                      <TableCell className="font-semibold text-green-600">
                        {(commission.commissionAmount / 100).toLocaleString()}{" "}
                        {t("common.sar")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(commission.createdAt), "PPp", {
                          locale: currentLocale,
                        })}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-green-50 text-green-700"
                            onClick={() =>
                              handleApproveCommission(commission.id)
                            }
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            {t("travelAgent.admin.approve") || "Approve"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-blue-50 text-blue-700"
                            onClick={() => handlePayCommission(commission.id)}
                          >
                            <DollarSign className="h-4 w-4 mr-1" />
                            {t("travelAgent.admin.markPaid") || "Mark Paid"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Register Dialog */}
      <Dialog open={registerDialogOpen} onOpenChange={setRegisterDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("travelAgent.admin.registerAgent") || "Register Travel Agent"}
            </DialogTitle>
            <DialogDescription>
              {t("travelAgent.admin.registerDescription") ||
                "Register a new travel agency with API access"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>
                {t("travelAgent.admin.agencyName") || "Agency Name"} *
              </Label>
              <Input
                value={registerForm.agencyName}
                onChange={e =>
                  setRegisterForm({
                    ...registerForm,
                    agencyName: e.target.value,
                  })
                }
                placeholder="Travel Agency Name"
              />
            </div>
            <div>
              <Label>
                {t("travelAgent.admin.iataNumber") || "IATA Number"} *
              </Label>
              <Input
                value={registerForm.iataNumber}
                onChange={e =>
                  setRegisterForm({
                    ...registerForm,
                    iataNumber: e.target.value,
                  })
                }
                placeholder="12345678"
              />
            </div>
            <div>
              <Label>
                {t("travelAgent.admin.contactName") || "Contact Name"} *
              </Label>
              <Input
                value={registerForm.contactName}
                onChange={e =>
                  setRegisterForm({
                    ...registerForm,
                    contactName: e.target.value,
                  })
                }
                placeholder="John Doe"
              />
            </div>
            <div>
              <Label>{t("travelAgent.admin.email") || "Email"} *</Label>
              <Input
                type="email"
                value={registerForm.email}
                onChange={e =>
                  setRegisterForm({ ...registerForm, email: e.target.value })
                }
                placeholder="agent@agency.com"
              />
            </div>
            <div>
              <Label>{t("travelAgent.admin.phone") || "Phone"} *</Label>
              <Input
                value={registerForm.phone}
                onChange={e =>
                  setRegisterForm({ ...registerForm, phone: e.target.value })
                }
                placeholder="+966 12 345 6789"
              />
            </div>
            <div>
              <Label>
                {t("travelAgent.admin.commissionRate") || "Commission Rate (%)"}
              </Label>
              <Input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={registerForm.commissionRate}
                onChange={e =>
                  setRegisterForm({
                    ...registerForm,
                    commissionRate: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRegisterDialogOpen(false)}
            >
              {t("common.cancel") || "Cancel"}
            </Button>
            <Button
              onClick={handleRegister}
              disabled={registerMutation.isPending}
            >
              {registerMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {t("common.loading") || "Loading..."}
                </>
              ) : (
                t("travelAgent.admin.register") || "Register"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credentials Dialog */}
      <Dialog
        open={credentialsDialogOpen}
        onOpenChange={setCredentialsDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("travelAgent.admin.apiCredentials") || "API Credentials"}
            </DialogTitle>
            <DialogDescription>
              {t("travelAgent.admin.credentialsWarning") ||
                "Save these credentials securely. The API secret will not be shown again."}
            </DialogDescription>
          </DialogHeader>
          {newCredentials && (
            <div className="space-y-4">
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  {t("travelAgent.admin.saveCredentialsWarning") ||
                    "Important: Save these credentials now. The API secret cannot be retrieved later."}
                </p>
              </div>
              <div>
                <Label>{t("travelAgent.admin.apiKey") || "API Key"}</Label>
                <div className="flex gap-2">
                  <Input value={newCredentials.apiKey} readOnly />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => copyToClipboard(newCredentials.apiKey)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <Label>
                  {t("travelAgent.admin.apiSecret") || "API Secret"}
                </Label>
                <div className="flex gap-2">
                  <Input
                    type={showSecret ? "text" : "password"}
                    value={newCredentials.apiSecret}
                    readOnly
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => setShowSecret(!showSecret)}
                  >
                    {showSecret ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => copyToClipboard(newCredentials.apiSecret)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCredentialsDialogOpen(false)}>
              {t("common.close") || "Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Commission Rate Dialog */}
      <Dialog
        open={commissionDialogOpen}
        onOpenChange={setCommissionDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("travelAgent.admin.editCommissionRate") ||
                "Edit Commission Rate"}
            </DialogTitle>
            <DialogDescription>{selectedAgent?.agencyName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>
                {t("travelAgent.admin.commissionRate") || "Commission Rate (%)"}
              </Label>
              <Input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={newCommissionRate}
                onChange={e =>
                  setNewCommissionRate(parseFloat(e.target.value) || 0)
                }
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("travelAgent.admin.commissionHint") ||
                  "0-50% commission rate"}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCommissionDialogOpen(false)}
            >
              {t("common.cancel") || "Cancel"}
            </Button>
            <Button
              onClick={handleUpdateCommission}
              disabled={updateCommissionMutation.isPending}
            >
              {t("common.save") || "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stats Dialog */}
      <Dialog open={statsDialogOpen} onOpenChange={setStatsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("travelAgent.admin.agentStatistics") || "Agent Statistics"}
            </DialogTitle>
            <DialogDescription>{selectedAgent?.agencyName}</DialogDescription>
          </DialogHeader>
          {statsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map(i => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : agentStats ? (
            <div className="grid grid-cols-2 gap-4">
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                  {t("travelAgent.admin.totalBookings") || "Total Bookings"}
                </p>
                <p className="text-2xl font-bold">{agentStats.totalBookings}</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                  {t("travelAgent.admin.bookingsThisMonth") || "This Month"}
                </p>
                <p className="text-2xl font-bold">
                  {agentStats.bookingsThisMonth}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                  {t("travelAgent.admin.totalRevenue") || "Total Revenue"}
                </p>
                <p className="text-2xl font-bold text-green-600">
                  {(agentStats.totalRevenue / 100).toLocaleString()}{" "}
                  {t("common.sar")}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                  {t("travelAgent.admin.revenueThisMonth") ||
                    "This Month Revenue"}
                </p>
                <p className="text-2xl font-bold text-green-600">
                  {(agentStats.revenueThisMonth / 100).toLocaleString()}{" "}
                  {t("common.sar")}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                  {t("travelAgent.admin.pendingCommission") ||
                    "Pending Commission"}
                </p>
                <p className="text-2xl font-bold text-yellow-600">
                  {(agentStats.pendingCommission / 100).toLocaleString()}{" "}
                  {t("common.sar")}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                  {t("travelAgent.admin.paidCommission") || "Paid Commission"}
                </p>
                <p className="text-2xl font-bold text-blue-600">
                  {(agentStats.paidCommission / 100).toLocaleString()}{" "}
                  {t("common.sar")}
                </p>
              </Card>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setStatsDialogOpen(false)}>
              {t("common.close") || "Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

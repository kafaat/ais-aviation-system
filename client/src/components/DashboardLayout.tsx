import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { APP_LOGO, APP_TITLE } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bed,
  Bell,
  Brain,
  Briefcase,
  Building,
  Calculator,
  Database,
  DoorOpen,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Heart,
  Home,
  ListOrdered,
  LogOut,
  Luggage,
  Monitor,
  Package,
  PanelLeft,
  Plane,
  RefreshCcw,
  Scale,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  Star,
  Tag,
  Ticket,
  Trash2,
  User,
  UserCheck,
  Users,
  Weight,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "./ui/button";

interface MenuItem {
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
  path: string;
  adminOnly?: boolean;
  badge?: string;
}

const menuItems: MenuItem[] = [
  { icon: Home, labelKey: "nav.home", path: "/" },
  { icon: Search, labelKey: "nav.searchFlights", path: "/search" },
  { icon: Ticket, labelKey: "nav.myBookings", path: "/my-bookings" },
  { icon: Heart, labelKey: "nav.favorites", path: "/favorites" },
  { icon: Bell, labelKey: "nav.priceAlerts", path: "/price-alerts" },
  { icon: Star, labelKey: "nav.loyalty", path: "/loyalty" },
  { icon: Plane, labelKey: "nav.checkIn", path: "/check-in" },
  { icon: User, labelKey: "nav.profile", path: "/profile" },
];

const adminMenuItems: MenuItem[] = [
  // Core Admin
  { icon: Settings, labelKey: "nav.admin", path: "/admin", adminOnly: true },
  {
    icon: BarChart3,
    labelKey: "nav.analytics",
    path: "/analytics",
    adminOnly: true,
  },
  {
    icon: FileText,
    labelKey: "nav.reports",
    path: "/admin/reports",
    adminOnly: true,
  },
  {
    icon: RefreshCcw,
    labelKey: "nav.refunds",
    path: "/admin/refunds",
    adminOnly: true,
  },
  {
    icon: Users,
    labelKey: "nav.groupBookings",
    path: "/admin/group-bookings",
    adminOnly: true,
  },
  {
    icon: Luggage,
    labelKey: "nav.baggage",
    path: "/admin/baggage",
    adminOnly: true,
  },
  {
    icon: Briefcase,
    labelKey: "nav.corporate",
    path: "/admin/corporate",
    adminOnly: true,
  },
  {
    icon: UserCheck,
    labelKey: "nav.travelAgents",
    path: "/admin/travel-agents",
    adminOnly: true,
  },
  {
    icon: Brain,
    labelKey: "nav.aiPricing",
    path: "/admin/ai-pricing",
    adminOnly: true,
  },
  {
    icon: Users,
    labelKey: "nav.overbooking",
    path: "/admin/overbooking",
    adminOnly: true,
  },
  {
    icon: DoorOpen,
    labelKey: "nav.gates",
    path: "/admin/gates",
    adminOnly: true,
  },
  {
    icon: Monitor,
    labelKey: "nav.dcs",
    path: "/admin/dcs",
    adminOnly: true,
  },
  {
    icon: Tag,
    labelKey: "nav.vouchers",
    path: "/admin/vouchers",
    adminOnly: true,
  },
  {
    icon: Trash2,
    labelKey: "nav.deletedBookings",
    path: "/admin/deleted-bookings",
    adminOnly: true,
  },
  // Operations
  {
    icon: AlertTriangle,
    labelKey: "nav.irops",
    path: "/admin/irops",
    adminOnly: true,
  },
  {
    icon: Users,
    labelKey: "nav.crewAssignment",
    path: "/admin/crew-assignment",
    adminOnly: true,
  },
  {
    icon: Weight,
    labelKey: "nav.weightBalance",
    path: "/admin/weight-balance",
    adminOnly: true,
  },
  {
    icon: Package,
    labelKey: "nav.loadPlanning",
    path: "/admin/load-planning",
    adminOnly: true,
  },
  // Passenger Services
  {
    icon: FileCheck,
    labelKey: "nav.apis",
    path: "/admin/apis",
    adminOnly: true,
  },
  {
    icon: Fingerprint,
    labelKey: "nav.biometric",
    path: "/admin/biometric",
    adminOnly: true,
  },
  {
    icon: Monitor,
    labelKey: "nav.kiosk",
    path: "/admin/kiosk",
    adminOnly: true,
  },
  {
    icon: Luggage,
    labelKey: "nav.bagDrop",
    path: "/admin/bag-drop",
    adminOnly: true,
  },
  {
    icon: Bed,
    labelKey: "nav.emergencyHotel",
    path: "/admin/emergency-hotel",
    adminOnly: true,
  },
  {
    icon: ListOrdered,
    labelKey: "nav.passengerPriority",
    path: "/admin/passenger-priority",
    adminOnly: true,
  },
  {
    icon: Scale,
    labelKey: "nav.compensation",
    path: "/admin/compensation",
    adminOnly: true,
  },
  // Finance & Reporting
  {
    icon: Calculator,
    labelKey: "nav.revenueAccounting",
    path: "/admin/revenue-accounting",
    adminOnly: true,
  },
  {
    icon: FileSpreadsheet,
    labelKey: "nav.bspReporting",
    path: "/admin/bsp-reporting",
    adminOnly: true,
  },
  {
    icon: Database,
    labelKey: "nav.dataWarehouse",
    path: "/admin/data-warehouse",
    adminOnly: true,
  },
  // System
  {
    icon: Activity,
    labelKey: "nav.sla",
    path: "/admin/sla",
    adminOnly: true,
  },
  {
    icon: ShieldAlert,
    labelKey: "nav.disasterRecovery",
    path: "/admin/disaster-recovery",
    adminOnly: true,
  },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-r from-primary to-purple-500 rounded-2xl blur-xl opacity-30 group-hover:opacity-50 transition-opacity" />
              <div className="relative">
                <img
                  src={APP_LOGO}
                  alt={APP_TITLE}
                  className="h-24 w-24 rounded-2xl object-cover shadow-xl ring-4 ring-white"
                />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
                {t("common.appName")}
              </h1>
              <p className="text-muted-foreground">
                {t("common.login")} {t("nav.home")}
              </p>
            </div>
          </div>
          <Button
            onClick={() => {
              window.location.href = "/login";
            }}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90"
          >
            {t("common.login")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  // Get all menu items based on user role
  const allMenuItems = isAdmin ? [...menuItems, ...adminMenuItems] : menuItems;

  const activeMenuItem = allMenuItems.find(item => item.path === location);

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  const renderMenuItem = (item: MenuItem, _index: number) => {
    const isActive = location === item.path;
    const label = t(item.labelKey);

    return (
      <SidebarMenuItem key={item.path}>
        <SidebarMenuButton
          isActive={isActive}
          onClick={() => setLocation(item.path)}
          tooltip={label}
          aria-current={isActive ? "page" : undefined}
          className={`h-11 transition-all font-normal ${
            isActive
              ? "bg-primary/10 text-primary font-medium"
              : "hover:bg-muted/80"
          }`}
        >
          <item.icon
            className={`h-4 w-4 transition-colors ${
              isActive ? "text-primary" : "text-muted-foreground"
            }`}
            aria-hidden="true"
          />
          <span className="flex-1">{label}</span>
          {item.badge && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              {item.badge}
            </Badge>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <>
      {/* Skip to content link for keyboard users */}
      <a href="#main-content" className="skip-to-content">
        {t("accessibility.skipToContent")}
      </a>

      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0 bg-gradient-to-b from-background to-muted/20"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center border-b border-border/40">
            <div className="flex items-center gap-3 ps-2 group-data-[collapsible=icon]:px-0 transition-all w-full">
              {isCollapsed ? (
                <div className="relative h-9 w-9 shrink-0 group">
                  <img
                    src={APP_LOGO}
                    className="h-9 w-9 rounded-lg object-cover ring-2 ring-primary/20 shadow-sm"
                    alt="Logo"
                  />
                  <button
                    onClick={toggleSidebar}
                    className="absolute inset-0 flex items-center justify-center bg-accent rounded-lg ring-1 ring-border opacity-0 group-hover:opacity-100 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t("accessibility.expandSidebar")}
                  >
                    <PanelLeft
                      className="h-4 w-4 text-foreground"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={APP_LOGO}
                      className="h-9 w-9 rounded-lg object-cover ring-2 ring-primary/20 shadow-sm shrink-0"
                      alt="Logo"
                    />
                    <div className="min-w-0">
                      <span className="font-bold tracking-tight truncate block text-primary">
                        {t("common.appName").split(" ")[0]}
                      </span>
                      <span className="text-[10px] text-muted-foreground truncate block">
                        AIS
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={toggleSidebar}
                    className="ms-auto h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                    aria-label={t("accessibility.collapseSidebar")}
                  >
                    <PanelLeft
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                </>
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0 py-2">
            {/* Main Navigation */}
            <nav aria-label={t("accessibility.mainNavigation")}>
              <SidebarMenu className="px-2 py-1 space-y-0.5">
                {menuItems.map(renderMenuItem)}
              </SidebarMenu>
            </nav>

            {/* Admin Navigation */}
            {isAdmin && (
              <>
                <div className="px-4 py-3">
                  <div className="h-px bg-border/60" aria-hidden="true" />
                </div>
                <div className="px-4 mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {t("nav.admin")}
                  </span>
                </div>
                <nav aria-label={t("accessibility.adminNavigation")}>
                  <SidebarMenu className="px-2 py-1 space-y-0.5">
                    {adminMenuItems.map(renderMenuItem)}
                  </SidebarMenu>
                </nav>
              </>
            )}
          </SidebarContent>

          <SidebarFooter className="p-3 border-t border-border/40">
            <div className="flex items-center justify-between mb-2 group-data-[collapsible=icon]:justify-center">
              <ThemeToggle variant="ghost" size="sm" showLabel={!isCollapsed} />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("accessibility.userMenu")}
                >
                  <Avatar className="h-10 w-10 border-2 border-primary/20 shrink-0 shadow-sm">
                    <AvatarFallback className="text-sm font-semibold bg-gradient-to-br from-primary/20 to-purple-500/20 text-primary">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-semibold truncate leading-none">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-2">
                  <p className="text-sm font-medium">{user?.name}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setLocation("/profile")}
                  className="cursor-pointer"
                >
                  <User className="me-2 h-4 w-4" aria-hidden="true" />
                  <span>{t("nav.profile")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setLocation("/loyalty")}
                  className="cursor-pointer"
                >
                  <Star className="me-2 h-4 w-4" aria-hidden="true" />
                  <span>{t("nav.loyalty")}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="me-2 h-4 w-4" aria-hidden="true" />
                  <span>{t("common.logout")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 end-0 w-1 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset className="bg-gradient-to-br from-background via-background to-muted/10">
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40 shadow-sm">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="h-9 w-9 rounded-lg" />
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">
                  {activeMenuItem
                    ? t(activeMenuItem.labelKey)
                    : t("common.appName")}
                </span>
              </div>
            </div>
          </div>
        )}
        <main id="main-content" className="flex-1 p-4 md:p-6" role="main">
          {children}
        </main>
      </SidebarInset>
    </>
  );
}

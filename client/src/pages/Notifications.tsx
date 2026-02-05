import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from "@/components/ui/empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import {
  ChevronLeft,
  Bell,
  Plane,
  CreditCard,
  Calendar,
  Megaphone,
  Check,
  CheckCheck,
  Trash2,
  Filter,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { getLoginUrl } from "@/const";

type NotificationType = "booking" | "flight" | "payment" | "promo" | "system";

// Notification type icons and colors
const notificationConfig: Record<
  string,
  { icon: React.ElementType; bgColor: string; textColor: string; label: string }
> = {
  booking: {
    icon: Calendar,
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    textColor: "text-blue-600 dark:text-blue-400",
    label: "Booking",
  },
  flight: {
    icon: Plane,
    bgColor: "bg-indigo-100 dark:bg-indigo-900/30",
    textColor: "text-indigo-600 dark:text-indigo-400",
    label: "Flight",
  },
  payment: {
    icon: CreditCard,
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
    textColor: "text-emerald-600 dark:text-emerald-400",
    label: "Payment",
  },
  promo: {
    icon: Megaphone,
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    textColor: "text-amber-600 dark:text-amber-400",
    label: "Promotion",
  },
  system: {
    icon: Bell,
    bgColor: "bg-slate-100 dark:bg-slate-800",
    textColor: "text-slate-600 dark:text-slate-400",
    label: "System",
  },
};

export default function Notifications() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const dateLocale = isRTL ? ar : enUS;

  const { isAuthenticated, loading: authLoading } = useAuth();
  const [typeFilter, setTypeFilter] = useState<NotificationType | "all">("all");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const utils = trpc.useUtils();

  // Fetch notifications
  const {
    data: notifications,
    isLoading,
    refetch,
    isFetching,
  } = trpc.notifications.list.useQuery(
    {
      limit: 50,
      type: typeFilter === "all" ? undefined : typeFilter,
      unreadOnly: showUnreadOnly,
    },
    {
      enabled: isAuthenticated,
    }
  );

  // Get unread count
  const { data: unreadData } = trpc.notifications.unreadCount.useQuery(
    undefined,
    {
      enabled: isAuthenticated,
    }
  );

  // Mutations
  const markAsRead = trpc.notifications.markAsRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const markAllAsRead = trpc.notifications.markAllAsRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const deleteNotification = trpc.notifications.delete.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const deleteAll = trpc.notifications.deleteAll.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const unreadCount = unreadData?.count ?? 0;

  // Group notifications by date
  const groupedNotifications = useMemo(() => {
    if (!notifications) return {};

    const groups: Record<string, typeof notifications> = {};
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    for (const notification of notifications) {
      const notifDate = new Date(notification.createdAt);
      let dateKey: string;

      if (notifDate.toDateString() === today.toDateString()) {
        dateKey = t("notifications.today");
      } else if (notifDate.toDateString() === yesterday.toDateString()) {
        dateKey = t("notifications.yesterday");
      } else {
        dateKey = format(notifDate, "PPPP", { locale: dateLocale });
      }

      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(notification);
    }

    return groups;
  }, [notifications, t, dateLocale]);

  // Loading Skeleton
  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-950">
        <SEO title={t("notifications.pageTitle")} />
        <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b sticky top-0 z-50">
          <div className="container py-4">
            <div className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
          </div>
        </header>
        <div className="container py-8">
          <div className="bg-white dark:bg-slate-900 rounded-xl p-4 mb-6 shadow-sm">
            <div className="flex flex-wrap gap-4">
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-10 w-32" />
            </div>
          </div>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div
                key={i}
                className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm"
              >
                <div className="flex gap-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-1/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Not authenticated state
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-950 flex items-center justify-center p-4">
        <SEO title={t("notifications.pageTitle")} />
        <Card className="p-8 text-center max-w-md shadow-xl border-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <Bell className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-2">
            {t("notifications.loginRequired")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("notifications.loginRequiredDesc")}
          </p>
          <Button
            asChild
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md"
          >
            <a href={getLoginUrl()}>{t("common.login")}</a>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-950">
      <SEO
        title={t("notifications.pageTitle")}
        description={t("notifications.pageDescription")}
      />

      {/* Header */}
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b sticky top-0 z-50 shadow-sm">
        <div className="container py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                  {t("notifications.pageTitle")}
                </h1>
                {unreadCount > 0 && (
                  <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                    {unreadCount} {t("notifications.unread")}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {t("notifications.pageDescription")}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="container py-8">
        {/* Filters and Actions */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 md:p-6 mb-6 shadow-sm border border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-4">
            {/* Filter Icon */}
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
              <Filter className="h-5 w-5" />
              <span className="font-medium hidden sm:inline">
                {t("notifications.filters")}
              </span>
            </div>

            {/* Type Filter */}
            <Select
              value={typeFilter}
              onValueChange={value =>
                setTypeFilter(value as NotificationType | "all")
              }
            >
              <SelectTrigger className="w-[160px] rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                <SelectValue placeholder={t("notifications.filterByType")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("notifications.allTypes")}
                </SelectItem>
                <SelectItem value="booking">
                  {t("notifications.types.booking")}
                </SelectItem>
                <SelectItem value="flight">
                  {t("notifications.types.flight")}
                </SelectItem>
                <SelectItem value="payment">
                  {t("notifications.types.payment")}
                </SelectItem>
                <SelectItem value="promo">
                  {t("notifications.types.promo")}
                </SelectItem>
                <SelectItem value="system">
                  {t("notifications.types.system")}
                </SelectItem>
              </SelectContent>
            </Select>

            {/* Unread Only Toggle */}
            <Button
              variant={showUnreadOnly ? "default" : "outline"}
              size="sm"
              className={`rounded-xl ${
                showUnreadOnly
                  ? "bg-blue-600 hover:bg-blue-700"
                  : "hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
              onClick={() => setShowUnreadOnly(!showUnreadOnly)}
            >
              {t("notifications.unreadOnly")}
            </Button>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Refresh Button */}
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`}
              />
              {t("notifications.refresh")}
            </Button>

            {/* Mark All Read */}
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200 dark:text-blue-400 dark:hover:bg-blue-900/20"
                onClick={() => markAllAsRead.mutate()}
                disabled={markAllAsRead.isPending}
              >
                {markAllAsRead.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCheck className="h-4 w-4 mr-2" />
                )}
                {t("notifications.markAllRead")}
              </Button>
            )}

            {/* Delete All */}
            {notifications && notifications.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t("notifications.deleteAll")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("notifications.deleteAllConfirmTitle")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("notifications.deleteAllConfirmDesc")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700"
                      onClick={() => deleteAll.mutate()}
                    >
                      {deleteAll.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 mr-2" />
                      )}
                      {t("common.delete")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {/* Notifications List */}
        {!notifications || notifications.length === 0 ? (
          <Empty className="border-2 border-dashed border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 rounded-2xl py-16">
            <EmptyMedia>
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 flex items-center justify-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                  <Bell className="h-8 w-8 text-white" />
                </div>
              </div>
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>{t("notifications.empty")}</EmptyTitle>
              <EmptyDescription>
                {showUnreadOnly
                  ? t("notifications.noUnread")
                  : t("notifications.emptyDesc")}
              </EmptyDescription>
            </EmptyHeader>
            {showUnreadOnly && (
              <EmptyContent>
                <Button
                  variant="outline"
                  onClick={() => setShowUnreadOnly(false)}
                >
                  {t("notifications.showAll")}
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedNotifications).map(([dateKey, items]) => (
              <div key={dateKey}>
                {/* Date Header */}
                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-3 px-1">
                  {dateKey}
                </h3>

                {/* Notifications for this date */}
                <div className="space-y-3">
                  {items.map(notification => {
                    const config =
                      notificationConfig[notification.type] ||
                      notificationConfig.system;
                    const Icon = config.icon;
                    const link = notification.data?.link as string | undefined;

                    const content = (
                      <Card
                        className={`overflow-hidden border-0 shadow-sm hover:shadow-md transition-all duration-300 ${
                          !notification.isRead
                            ? "bg-gradient-to-r from-blue-50 to-white dark:from-blue-950/20 dark:to-slate-900 ring-1 ring-blue-200 dark:ring-blue-900"
                            : "bg-white dark:bg-slate-900"
                        }`}
                      >
                        <div className="p-4">
                          <div className="flex gap-4">
                            {/* Icon */}
                            <div
                              className={`flex-shrink-0 w-12 h-12 rounded-xl ${config.bgColor} flex items-center justify-center`}
                            >
                              <Icon className={`h-6 w-6 ${config.textColor}`} />
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <Badge
                                      variant="secondary"
                                      className={`text-xs ${config.bgColor} ${config.textColor} border-0`}
                                    >
                                      {t(
                                        `notifications.types.${notification.type}`
                                      )}
                                    </Badge>
                                    {!notification.isRead && (
                                      <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                                        {t("notifications.new")}
                                      </span>
                                    )}
                                  </div>
                                  <h4
                                    className={`font-semibold ${
                                      !notification.isRead
                                        ? "text-slate-900 dark:text-white"
                                        : "text-slate-700 dark:text-slate-300"
                                    }`}
                                  >
                                    {notification.title}
                                  </h4>
                                  <p className="text-sm text-muted-foreground mt-1">
                                    {notification.message}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-2">
                                    {formatDistanceToNow(
                                      new Date(notification.createdAt),
                                      {
                                        addSuffix: true,
                                        locale: dateLocale,
                                      }
                                    )}
                                  </p>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {!notification.isRead && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400"
                                      onClick={e => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        markAsRead.mutate({
                                          id: notification.id,
                                        });
                                      }}
                                      disabled={markAsRead.isPending}
                                    >
                                      <Check className="h-4 w-4" />
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                    onClick={e => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      deleteNotification.mutate({
                                        id: notification.id,
                                      });
                                    }}
                                    disabled={deleteNotification.isPending}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Card>
                    );

                    return link ? (
                      <Link
                        key={notification.id}
                        href={link}
                        onClick={() => {
                          if (!notification.isRead) {
                            markAsRead.mutate({ id: notification.id });
                          }
                        }}
                      >
                        {content}
                      </Link>
                    ) : (
                      <div key={notification.id}>{content}</div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

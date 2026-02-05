import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Plane,
  CreditCard,
  Calendar,
  Megaphone,
  Bell,
  Check,
  CheckCheck,
  Trash2,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ar, enUS } from "date-fns/locale";

interface NotificationDropdownProps {
  onClose?: () => void;
}

// Notification type icons and colors
const notificationConfig: Record<
  string,
  { icon: React.ElementType; bgColor: string; textColor: string }
> = {
  booking: {
    icon: Calendar,
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    textColor: "text-blue-600 dark:text-blue-400",
  },
  flight: {
    icon: Plane,
    bgColor: "bg-indigo-100 dark:bg-indigo-900/30",
    textColor: "text-indigo-600 dark:text-indigo-400",
  },
  payment: {
    icon: CreditCard,
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
    textColor: "text-emerald-600 dark:text-emerald-400",
  },
  promo: {
    icon: Megaphone,
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    textColor: "text-amber-600 dark:text-amber-400",
  },
  system: {
    icon: Bell,
    bgColor: "bg-slate-100 dark:bg-slate-800",
    textColor: "text-slate-600 dark:text-slate-400",
  },
};

export function NotificationDropdown({ onClose }: NotificationDropdownProps) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const dateLocale = isRTL ? ar : enUS;
  const utils = trpc.useUtils();

  // Fetch notifications
  const { data: notifications, isLoading } = trpc.notifications.list.useQuery({
    limit: 10,
    unreadOnly: false,
  });

  // Mark as read mutation
  const markAsRead = trpc.notifications.markAsRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  // Mark all as read mutation
  const markAllAsRead = trpc.notifications.markAllAsRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  // Delete notification mutation
  const deleteNotification = trpc.notifications.delete.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const handleNotificationClick = (notification: {
    id: number;
    isRead: boolean;
    data?: { link?: string } | null;
  }) => {
    if (!notification.isRead) {
      markAsRead.mutate({ id: notification.id });
    }

    if (notification.data?.link && onClose) {
      onClose();
    }
  };

  const handleMarkAllAsRead = () => {
    markAllAsRead.mutate();
  };

  const handleDelete = (e: React.MouseEvent, notificationId: number) => {
    e.stopPropagation();
    deleteNotification.mutate({ id: notificationId });
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Empty state
  if (!notifications || notifications.length === 0) {
    return (
      <div className="p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <Bell className="h-8 w-8 text-slate-400" />
        </div>
        <p className="text-sm font-medium text-slate-900 dark:text-white">
          {t("notifications.empty")}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {t("notifications.emptyDesc")}
        </p>
      </div>
    );
  }

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div className="flex flex-col max-h-[450px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-900 dark:text-white">
            {t("notifications.title")}
          </h3>
          {unreadCount > 0 && (
            <Badge
              variant="secondary"
              className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
            >
              {unreadCount} {t("notifications.new")}
            </Badge>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
            onClick={handleMarkAllAsRead}
            disabled={markAllAsRead.isPending}
          >
            {markAllAsRead.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <CheckCheck className="h-3 w-3 mr-1" />
            )}
            {t("notifications.markAllRead")}
          </Button>
        )}
      </div>

      {/* Notification List */}
      <ScrollArea className="flex-1">
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {notifications.map(notification => {
            const config =
              notificationConfig[notification.type] ||
              notificationConfig.system;
            const Icon = config.icon;
            const link = notification.data?.link as string | undefined;

            const content = (
              <div
                className={`p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer ${
                  !notification.isRead
                    ? "bg-blue-50/50 dark:bg-blue-900/10"
                    : ""
                }`}
                onClick={() => handleNotificationClick(notification)}
              >
                <div className="flex gap-3">
                  {/* Icon */}
                  <div
                    className={`flex-shrink-0 w-10 h-10 rounded-full ${config.bgColor} flex items-center justify-center`}
                  >
                    <Icon className={`h-5 w-5 ${config.textColor}`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            !notification.isRead
                              ? "text-slate-900 dark:text-white"
                              : "text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          {notification.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {notification.message}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!notification.isRead && (
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-slate-400 hover:text-red-500"
                          onClick={e => handleDelete(e, notification.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Timestamp */}
                    <p className="text-xs text-muted-foreground mt-2">
                      {formatDistanceToNow(new Date(notification.createdAt), {
                        addSuffix: true,
                        locale: dateLocale,
                      })}
                    </p>
                  </div>
                </div>
              </div>
            );

            return link ? (
              <Link key={notification.id} href={link}>
                {content}
              </Link>
            ) : (
              <div key={notification.id}>{content}</div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-3 border-t border-slate-100 dark:border-slate-800">
        <Button
          variant="ghost"
          className="w-full justify-center text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
          asChild
          onClick={onClose}
        >
          <Link href="/notifications">
            {t("notifications.viewAll")}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default NotificationDropdown;

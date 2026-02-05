import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Bell } from "lucide-react";
import { NotificationDropdown } from "./NotificationDropdown";

interface NotificationBellProps {
  className?: string;
  /**
   * Polling interval in milliseconds for real-time updates
   * Set to 0 to disable polling
   * Default: 30000 (30 seconds)
   */
  pollingInterval?: number;
}

export function NotificationBell({
  className = "",
  pollingInterval = 30000,
}: NotificationBellProps) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  // Get unread count with polling for real-time updates
  const { data: unreadData } = trpc.notifications.unreadCount.useQuery(
    undefined,
    {
      enabled: isAuthenticated,
      refetchInterval: pollingInterval > 0 ? pollingInterval : false,
      refetchIntervalInBackground: false,
      staleTime: 10000, // Consider data stale after 10 seconds
    }
  );

  const unreadCount = unreadData?.count ?? 0;

  // Don't render if not authenticated
  if (!isAuthenticated) {
    return null;
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`relative rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 ${className}`}
          aria-label={t("notifications.title")}
        >
          <Bell className="h-5 w-5" />
          {/* Badge for unread count */}
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full ring-2 ring-white dark:ring-slate-900">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[380px] p-0 shadow-xl border-slate-200 dark:border-slate-700"
        align="end"
        sideOffset={8}
      >
        <NotificationDropdown onClose={() => setIsOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

export default NotificationBell;

import { useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

export interface UseNotificationsOptions {
  /**
   * Whether to enable the hook
   * @default true
   */
  enabled?: boolean;
  /**
   * Polling interval in milliseconds for real-time updates
   * Set to 0 to disable polling
   * @default 30000 (30 seconds)
   */
  pollingInterval?: number;
  /**
   * Whether to continue polling when the page is in the background
   * @default false
   */
  pollInBackground?: boolean;
  /**
   * Maximum number of notifications to fetch
   * @default 20
   */
  limit?: number;
  /**
   * Filter to only show unread notifications
   * @default false
   */
  unreadOnly?: boolean;
  /**
   * Filter by notification type
   */
  type?: "booking" | "flight" | "payment" | "promo" | "system";
}

export interface Notification {
  id: number;
  userId: number;
  type: "booking" | "flight" | "payment" | "promo" | "system";
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: Date;
  readAt: Date | null;
}

export interface UseNotificationsResult {
  /**
   * List of notifications
   */
  notifications: Notification[];
  /**
   * Number of unread notifications
   */
  unreadCount: number;
  /**
   * Whether notifications are currently loading
   */
  isLoading: boolean;
  /**
   * Whether notifications are currently being fetched (includes refetch)
   */
  isFetching: boolean;
  /**
   * Error message if any
   */
  error: string | null;
  /**
   * Mark a specific notification as read
   */
  markAsRead: (notificationId: number) => void;
  /**
   * Mark all notifications as read
   */
  markAllAsRead: () => void;
  /**
   * Delete a specific notification
   */
  deleteNotification: (notificationId: number) => void;
  /**
   * Manually refresh notifications
   */
  refresh: () => void;
}

/**
 * Hook for managing notifications with real-time updates via polling
 *
 * @example
 * ```tsx
 * const {
 *   notifications,
 *   unreadCount,
 *   isLoading,
 *   markAsRead,
 *   markAllAsRead,
 * } = useNotifications({
 *   pollingInterval: 30000,
 *   unreadOnly: false,
 * });
 * ```
 */
export function useNotifications(
  options: UseNotificationsOptions = {}
): UseNotificationsResult {
  const {
    enabled = true,
    pollingInterval = 30000,
    pollInBackground = false,
    limit = 20,
    unreadOnly = false,
    type,
  } = options;

  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  // Query for notifications
  const {
    data: notificationsData,
    isLoading: notificationsLoading,
    isFetching: notificationsFetching,
    error: notificationsError,
    refetch: refetchNotifications,
  } = trpc.notifications.list.useQuery(
    {
      limit,
      unreadOnly,
      type,
    },
    {
      enabled: enabled && isAuthenticated,
      refetchInterval: pollingInterval > 0 ? pollingInterval : false,
      refetchIntervalInBackground: pollInBackground,
      staleTime: 10000, // Consider data stale after 10 seconds
    }
  );

  // Query for unread count (separate for efficiency)
  const {
    data: unreadData,
    isLoading: unreadLoading,
    error: unreadError,
  } = trpc.notifications.unreadCount.useQuery(undefined, {
    enabled: enabled && isAuthenticated,
    refetchInterval: pollingInterval > 0 ? pollingInterval : false,
    refetchIntervalInBackground: pollInBackground,
    staleTime: 10000,
  });

  // Mutations
  const markAsReadMutation = trpc.notifications.markAsRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const markAllAsReadMutation = trpc.notifications.markAllAsRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const deleteNotificationMutation = trpc.notifications.delete.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  // Actions
  const markAsRead = useCallback(
    (notificationId: number) => {
      markAsReadMutation.mutate({ id: notificationId });
    },
    [markAsReadMutation]
  );

  const markAllAsRead = useCallback(() => {
    markAllAsReadMutation.mutate();
  }, [markAllAsReadMutation]);

  const deleteNotification = useCallback(
    (notificationId: number) => {
      deleteNotificationMutation.mutate({ id: notificationId });
    },
    [deleteNotificationMutation]
  );

  const refresh = useCallback(() => {
    refetchNotifications();
    utils.notifications.unreadCount.invalidate();
  }, [refetchNotifications, utils]);

  // Combine errors
  const error = notificationsError?.message || unreadError?.message || null;

  return {
    notifications: (notificationsData as Notification[]) ?? [],
    unreadCount: unreadData?.count ?? 0,
    isLoading: notificationsLoading || unreadLoading,
    isFetching: notificationsFetching,
    error,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    refresh,
  };
}

export default useNotifications;

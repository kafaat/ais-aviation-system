/**
 * BookingTimeline Component
 *
 * Timeline showing booking lifecycle events:
 * - Booked
 * - Paid
 * - Checked-in
 * - Boarded
 * - Completed
 *
 * Features:
 * - Timestamps for each event
 * - Visual status indicators
 * - Animated transitions
 * - Responsive design
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Circle,
  CreditCard,
  Ticket,
  UserCheck,
  PlaneTakeoff,
  Flag,
  XCircle,
  Clock,
  AlertCircle,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export type BookingEventType =
  | "booked"
  | "paid"
  | "checked_in"
  | "boarded"
  | "completed"
  | "cancelled";

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed";
export type PaymentStatus = "pending" | "paid" | "refunded" | "failed";

export interface BookingEvent {
  type: BookingEventType;
  timestamp: Date | string;
  details?: string;
}

export interface BookingTimelineProps {
  bookingStatus: BookingStatus;
  paymentStatus: PaymentStatus;
  createdAt: Date | string;
  paidAt?: Date | string | null;
  checkedInAt?: Date | string | null;
  boardedAt?: Date | string | null;
  completedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
  /** Show as compact inline version */
  compact?: boolean;
  /** Show relative time (e.g., "2 hours ago") */
  showRelativeTime?: boolean;
  className?: string;
}

interface TimelineEvent {
  id: BookingEventType;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
  timestamp: Date | null;
  status: "completed" | "current" | "upcoming" | "cancelled";
}

export function BookingTimeline({
  bookingStatus,
  paymentStatus,
  createdAt,
  paidAt,
  checkedInAt,
  boardedAt,
  completedAt,
  cancelledAt,
  compact = false,
  showRelativeTime = true,
  className,
}: BookingTimelineProps) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const dateLocale = isRTL ? ar : enUS;

  // Build timeline events
  const events = useMemo<TimelineEvent[]>(() => {
    const isCancelled = bookingStatus === "cancelled";

    const eventList: TimelineEvent[] = [
      {
        id: "booked",
        icon: Ticket,
        labelKey: "bookingTimeline.booked",
        timestamp: new Date(createdAt),
        status: "completed",
      },
      {
        id: "paid",
        icon: CreditCard,
        labelKey: "bookingTimeline.paid",
        timestamp: paidAt ? new Date(paidAt) : null,
        status:
          paymentStatus === "paid"
            ? "completed"
            : paymentStatus === "failed"
              ? "cancelled"
              : paidAt
                ? "completed"
                : "upcoming",
      },
      {
        id: "checked_in",
        icon: UserCheck,
        labelKey: "bookingTimeline.checkedIn",
        timestamp: checkedInAt ? new Date(checkedInAt) : null,
        status: checkedInAt
          ? "completed"
          : paymentStatus !== "paid"
            ? "upcoming"
            : "current",
      },
      {
        id: "boarded",
        icon: PlaneTakeoff,
        labelKey: "bookingTimeline.boarded",
        timestamp: boardedAt ? new Date(boardedAt) : null,
        status: boardedAt ? "completed" : "upcoming",
      },
      {
        id: "completed",
        icon: Flag,
        labelKey: "bookingTimeline.completed",
        timestamp: completedAt ? new Date(completedAt) : null,
        status:
          bookingStatus === "completed"
            ? "completed"
            : completedAt
              ? "completed"
              : "upcoming",
      },
    ];

    // If cancelled, add cancelled event and mark subsequent as cancelled
    if (isCancelled) {
      const cancelledEvent: TimelineEvent = {
        id: "cancelled",
        icon: XCircle,
        labelKey: "bookingTimeline.cancelled",
        timestamp: cancelledAt ? new Date(cancelledAt) : new Date(),
        status: "cancelled",
      };

      // Find where to insert cancelled event
      const firstUpcomingIndex = eventList.findIndex(
        e => e.status === "upcoming" || e.status === "current"
      );

      if (firstUpcomingIndex !== -1) {
        // Insert cancelled event and remove subsequent events
        return [...eventList.slice(0, firstUpcomingIndex), cancelledEvent];
      }
      return [...eventList, cancelledEvent];
    }

    return eventList;
  }, [
    bookingStatus,
    paymentStatus,
    createdAt,
    paidAt,
    checkedInAt,
    boardedAt,
    completedAt,
    cancelledAt,
  ]);

  const getStatusColor = (
    status: TimelineEvent["status"]
  ): { bg: string; text: string; border: string } => {
    switch (status) {
      case "completed":
        return {
          bg: "bg-emerald-500",
          text: "text-white",
          border: "border-emerald-500",
        };
      case "current":
        return {
          bg: "bg-blue-500",
          text: "text-white",
          border: "border-blue-500",
        };
      case "cancelled":
        return {
          bg: "bg-red-500",
          text: "text-white",
          border: "border-red-500",
        };
      default:
        return {
          bg: "bg-slate-200 dark:bg-slate-700",
          text: "text-slate-500",
          border: "border-slate-300 dark:border-slate-600",
        };
    }
  };

  const getLineColor = (
    currentStatus: TimelineEvent["status"],
    nextStatus: TimelineEvent["status"]
  ): string => {
    if (currentStatus === "completed" && nextStatus === "completed") {
      return "bg-emerald-500";
    }
    if (currentStatus === "completed" && nextStatus === "current") {
      return "bg-gradient-to-b from-emerald-500 to-blue-500";
    }
    if (currentStatus === "cancelled" || nextStatus === "cancelled") {
      return "bg-red-300 dark:bg-red-800";
    }
    return "bg-slate-200 dark:bg-slate-700";
  };

  const formatTimestamp = (date: Date | null) => {
    if (!date) return null;

    if (showRelativeTime) {
      return formatDistanceToNow(date, { addSuffix: true, locale: dateLocale });
    }
    return format(date, "PPp", { locale: dateLocale });
  };

  // Compact inline version
  if (compact) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        {events.map((event, index) => {
          const colors = getStatusColor(event.status);
          const Icon = event.icon;
          const isLast = index === events.length - 1;

          return (
            <div key={event.id} className="flex items-center">
              <motion.div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center",
                  colors.bg,
                  colors.text
                )}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: index * 0.1 }}
                title={`${t(event.labelKey)}${event.timestamp ? ` - ${formatTimestamp(event.timestamp)}` : ""}`}
              >
                {event.status === "completed" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : event.status === "cancelled" ? (
                  <XCircle className="h-3 w-3" />
                ) : event.status === "current" ? (
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    <Icon className="h-3 w-3" />
                  </motion.div>
                ) : (
                  <Circle className="h-3 w-3" />
                )}
              </motion.div>
              {!isLast && (
                <div
                  className={cn(
                    "w-4 h-0.5",
                    getLineColor(
                      event.status,
                      events[index + 1]?.status || "upcoming"
                    )
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Full vertical timeline
  return (
    <div className={cn("relative", className)}>
      <div className="space-y-0">
        {events.map((event, index) => {
          const colors = getStatusColor(event.status);
          const Icon = event.icon;
          const isLast = index === events.length - 1;
          const nextEvent = events[index + 1];

          return (
            <motion.div
              key={event.id}
              className="relative flex gap-4"
              initial={{ opacity: 0, x: isRTL ? 20 : -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              {/* Timeline column */}
              <div className="flex flex-col items-center">
                {/* Icon circle */}
                <motion.div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center border-2 z-10",
                    colors.bg,
                    colors.text,
                    colors.border
                  )}
                  whileHover={{ scale: 1.1 }}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: index * 0.1, type: "spring" }}
                >
                  {event.status === "completed" ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : event.status === "cancelled" ? (
                    <XCircle className="h-5 w-5" />
                  ) : event.status === "current" ? (
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    >
                      <Icon className="h-5 w-5" />
                    </motion.div>
                  ) : (
                    <Icon className="h-5 w-5" />
                  )}
                </motion.div>

                {/* Connecting line */}
                {!isLast && (
                  <motion.div
                    className={cn(
                      "w-0.5 flex-1 min-h-[40px]",
                      getLineColor(
                        event.status,
                        nextEvent?.status || "upcoming"
                      )
                    )}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ delay: index * 0.1 + 0.2 }}
                    style={{ transformOrigin: "top" }}
                  />
                )}
              </div>

              {/* Content column */}
              <div className="flex-1 pb-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p
                      className={cn(
                        "font-medium",
                        event.status === "completed"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : event.status === "current"
                            ? "text-blue-600 dark:text-blue-400"
                            : event.status === "cancelled"
                              ? "text-red-600 dark:text-red-400"
                              : "text-muted-foreground"
                      )}
                    >
                      {t(event.labelKey)}
                    </p>
                    <AnimatePresence>
                      {event.status === "current" && (
                        <motion.div
                          className="flex items-center gap-1 text-xs text-blue-500 mt-1"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          <motion.span
                            animate={{ opacity: [1, 0.5, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                          >
                            <AlertCircle className="h-3 w-3" />
                          </motion.span>
                          <span>{t("bookingTimeline.actionRequired")}</span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {event.timestamp && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{formatTimestamp(event.timestamp)}</span>
                    </div>
                  )}
                </div>

                {/* Additional info for specific events */}
                {event.status === "completed" && event.id === "paid" && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                    {t("bookingTimeline.paymentConfirmed")}
                  </p>
                )}
                {event.status === "cancelled" && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                    {t("bookingTimeline.bookingCancelled")}
                  </p>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default BookingTimeline;

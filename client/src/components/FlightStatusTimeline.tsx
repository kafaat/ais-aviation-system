import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Plane,
} from "lucide-react";

interface FlightStatusTimelineProps {
  flightId: number;
}

const statusIcons = {
  scheduled: Plane,
  delayed: Clock,
  cancelled: XCircle,
  completed: CheckCircle2,
};

const statusColors = {
  scheduled: "bg-blue-500",
  delayed: "bg-orange-500",
  cancelled: "bg-red-500",
  completed: "bg-green-500",
};

const statusLabels = {
  scheduled: "مجدولة",
  delayed: "متأخرة",
  cancelled: "ملغاة",
  completed: "مكتملة",
};

export function FlightStatusTimeline({ flightId }: FlightStatusTimelineProps) {
  const { data, isLoading } = trpc.flights.getStatusHistory.useQuery({
    flightId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const hasHistory = data.history && data.history.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          تاريخ حالة الرحلة
        </CardTitle>
        <CardDescription>
          رقم الرحلة: {data.flightNumber} • الحالة الحالية:{" "}
          <Badge
            variant={
              data.currentStatus === "cancelled" ? "destructive" : "default"
            }
          >
            {statusLabels[data.currentStatus as keyof typeof statusLabels]}
          </Badge>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasHistory ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>لا توجد تغييرات في حالة الرحلة</p>
            <p className="text-sm mt-1">الرحلة في حالتها الأصلية</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute right-[19px] top-0 bottom-0 w-0.5 bg-border" />

            {/* Timeline items */}
            <div className="space-y-6">
              {data.history.map((item, index) => {
                const Icon =
                  statusIcons[item.newStatus as keyof typeof statusIcons];
                const isFirst = index === 0;

                return (
                  <div key={item.id} className="relative flex gap-4">
                    {/* Icon */}
                    <div
                      className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-4 border-background ${
                        statusColors[
                          item.newStatus as keyof typeof statusColors
                        ]
                      }`}
                    >
                      <Icon className="h-5 w-5 text-white" />
                    </div>

                    {/* Content */}
                    <div className={`flex-1 pb-6 ${isFirst ? "pt-1" : ""}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge
                              variant={
                                item.newStatus === "cancelled"
                                  ? "destructive"
                                  : "default"
                              }
                              className="font-semibold"
                            >
                              {
                                statusLabels[
                                  item.newStatus as keyof typeof statusLabels
                                ]
                              }
                            </Badge>
                            {item.oldStatus && (
                              <>
                                <span className="text-muted-foreground text-sm">
                                  من
                                </span>
                                <Badge variant="outline" className="text-xs">
                                  {
                                    statusLabels[
                                      item.oldStatus as keyof typeof statusLabels
                                    ]
                                  }
                                </Badge>
                              </>
                            )}
                          </div>

                          {item.reason && (
                            <p className="text-sm text-muted-foreground mt-2 flex items-start gap-2">
                              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                              <span>{item.reason}</span>
                            </p>
                          )}

                          {item.delayMinutes && (
                            <p className="text-sm text-orange-600 mt-1 flex items-center gap-1">
                              <Clock className="h-4 w-4" />
                              تأخير {item.delayMinutes} دقيقة
                            </p>
                          )}
                        </div>

                        <time className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(item.createdAt).toLocaleString("ar-SA", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

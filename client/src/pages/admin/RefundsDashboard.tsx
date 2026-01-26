import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DollarSign,
  TrendingDown,
  CheckCircle2,
  Clock,
  RefreshCw,
} from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

export default function RefundsDashboard() {
  const { data: stats, isLoading: statsLoading } =
    trpc.refunds.getStats.useQuery();
  const { data: history, isLoading: historyLoading } =
    trpc.refunds.getHistory.useQuery({ limit: 20 });
  const { data: trends, isLoading: trendsLoading } =
    trpc.refunds.getTrends.useQuery();

  if (statsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">إدارة الاستردادات</h1>
        <p className="text-muted-foreground">
          عرض وإدارة جميع عمليات استرداد الأموال
        </p>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              إجمالي الاستردادات
            </p>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold">{stats?.totalRefunds || 0}</p>
          <p className="text-xs text-muted-foreground mt-2">
            جميع عمليات الاسترداد
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              المبلغ المسترد
            </p>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold">
            {((stats?.totalRefundedAmount || 0) / 100).toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground mt-2">ريال سعودي</p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              الاستردادات المكتملة
            </p>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </div>
          <p className="text-3xl font-bold">{stats?.completedRefunds || 0}</p>
          <p className="text-xs text-muted-foreground mt-2">
            تم الاسترداد بنجاح
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              معدل الاسترداد
            </p>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold">
            {(stats?.refundRate || 0).toFixed(1)}%
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            من إجمالي الحجوزات
          </p>
        </Card>
      </div>

      {/* Refund Trends Chart */}
      {trends && trends.length > 0 && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">
            اتجاهات الاسترداد (آخر 30 يوم)
          </h2>
          <div className="space-y-2">
            {trends.slice(-10).map((trend, index) => (
              <div
                key={index}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div className="text-sm font-medium">
                    {format(new Date(trend.date), "dd MMM yyyy", {
                      locale: ar,
                    })}
                  </div>
                  <Badge variant="secondary">{trend.count} استرداد</Badge>
                </div>
                <div className="text-sm font-semibold">
                  {(trend.amount / 100).toFixed(2)} ر.س
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Refund History Table */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">سجل الاستردادات</h2>
        {historyLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : !history || history.length === 0 ? (
          <div className="text-center py-12">
            <RefreshCw className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">لا توجد عمليات استرداد</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الحجز</TableHead>
                  <TableHead>PNR</TableHead>
                  <TableHead>معرف المستخدم</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تاريخ الاسترداد</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(refund => (
                  <TableRow key={refund.id}>
                    <TableCell className="font-medium">
                      {refund.bookingReference}
                    </TableCell>
                    <TableCell>{refund.pnr}</TableCell>
                    <TableCell>{refund.userId}</TableCell>
                    <TableCell className="font-semibold">
                      {(refund.amount / 100).toFixed(2)} ر.س
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {refund.status === "refunded" ? "مسترد" : refund.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(refund.refundedAt), "PPp", {
                        locale: ar,
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

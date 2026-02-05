/**
 * TableSkeleton Component
 *
 * A reusable loading skeleton for table components
 * Can customize the number of rows and columns
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface TableSkeletonProps {
  columns?: number;
  rows?: number;
  columnWidths?: string[];
  showHeader?: boolean;
  className?: string;
}

export function TableSkeleton({
  columns = 4,
  rows = 5,
  columnWidths,
  showHeader = true,
  className,
}: TableSkeletonProps) {
  const getColumnWidth = (index: number) => {
    if (columnWidths && columnWidths[index]) {
      return columnWidths[index];
    }
    // Default varied widths for visual interest
    const defaultWidths = ["w-24", "w-20", "w-32", "w-16", "w-28", "w-20"];
    return defaultWidths[index % defaultWidths.length];
  };

  return (
    <div className={`animate-in fade-in duration-300 ${className || ""}`}>
      <Table>
        {showHeader && (
          <TableHeader>
            <TableRow className="bg-muted/50">
              {Array.from({ length: columns }).map((_, i) => (
                <TableHead key={i}>
                  <Skeleton className={`h-4 ${getColumnWidth(i)}`} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
        )}
        <TableBody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <TableRow
              key={rowIndex}
              className="animate-in fade-in slide-in-from-left-2"
              style={
                {
                  animationDelay: `${rowIndex * 50}ms`,
                  animationFillMode: "backwards",
                } as React.CSSProperties
              }
            >
              {Array.from({ length: columns }).map((_, colIndex) => (
                <TableCell key={colIndex}>
                  <Skeleton className={`h-4 ${getColumnWidth(colIndex)}`} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default TableSkeleton;

/**
 * Report Export Service Tests
 *
 * Unit tests for the report export service
 * Tests CSV, PDF, and Excel export functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ExcelJS from "exceljs";

/** Parse an .xlsx buffer back into { sheetNames, cells-per-sheet } for assertions. */
async function readWorkbook(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheetNames = workbook.worksheets.map(ws => ws.name);
  const cellText = (name: string) => {
    const ws = workbook.getWorksheet(name);
    const values: string[] = [];
    ws?.eachRow(row => {
      row.eachCell(cell => values.push(String(cell.value ?? "")));
    });
    return values.join(" ");
  };
  return { sheetNames, cellText };
}

// Mock the database
vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./booking-financial-reporting.service", () => ({
  getFinancialExport: vi.fn(async () => ({
    schemaVersion: 2,
    basis: "posted_booking_ledger",
    currency: "SAR",
    periodBasis: "ledger_transaction_date_utc",
    totals: {
      collectedAmount: 10001,
      refundedAmount: 7501,
      netAmount: 2500,
      activeBookings: 1,
      unmatchedCollectionEntries: 0,
      reviewCollectionAmount: 0,
    },
    rows: [
      {
        date: "2024-01-10",
        collectedAmount: 10001,
        refundedAmount: 7501,
        netAmount: 2500,
        activeBookings: 1,
        collectionEntries: 2,
        refundEntries: 2,
        unmatchedCollectionEntries: 0,
        reviewCollectionAmount: 0,
      },
    ],
  })),
}));

// Import after mocking
import { getDb } from "../db";
import {
  exportBookingsToCSV,
  exportRevenueToCSV,
  _exportFlightPerformanceToCSV,
  exportRefundsToCSV,
  exportBookingsToExcel,
  exportRevenueToExcel,
  exportFlightPerformanceToExcel,
  exportRefundsToExcel,
  generateBookingsPDF,
  generateRevenuePDF,
  generateRefundsPDF,
  generateFlightPerformancePDF,
  getReportFilename,
  type ReportFilters,
} from "./report-export.service";

describe("Report Export Service", () => {
  // Mock database results
  const mockBookingsData = [
    {
      bookingReference: "BK001",
      pnr: "ABC123",
      flightNumber: "SV100",
      origin: "Jeddah",
      destination: "Riyadh",
      departureTime: new Date("2024-01-15T10:00:00Z"),
      cabinClass: "economy",
      status: "confirmed",
      paymentStatus: "paid",
      totalAmount: 50000, // 500 SAR in cents
      passengers: 2,
      userEmail: "test@example.com",
      createdAt: new Date("2024-01-10T08:00:00Z"),
    },
    {
      bookingReference: "BK002",
      pnr: "DEF456",
      flightNumber: "SV101",
      origin: "Riyadh",
      destination: "Dubai",
      departureTime: new Date("2024-01-20T14:00:00Z"),
      cabinClass: "business",
      status: "pending",
      paymentStatus: "pending",
      totalAmount: 150000, // 1500 SAR in cents
      passengers: 1,
      userEmail: "user2@example.com",
      createdAt: new Date("2024-01-12T10:00:00Z"),
    },
  ];

  const mockRevenueData = [
    {
      date: "2024-01-10",
      totalBookings: 5,
      totalRevenue: 250000,
      confirmedRevenue: 200000,
      refundedAmount: 50000,
    },
    {
      date: "2024-01-11",
      totalBookings: 3,
      totalRevenue: 150000,
      confirmedRevenue: 150000,
      refundedAmount: 0,
    },
  ];

  const mockFlightsData = [
    {
      flightNumber: "SV100",
      airlineName: "Saudi Airlines",
      originCity: "Jeddah",
      destCity: "Riyadh",
      economySeats: 150,
      businessSeats: 30,
      economyAvailable: 100,
      businessAvailable: 20,
      economyPrice: 50000,
      businessPrice: 150000,
      departureTime: new Date("2024-01-15T10:00:00Z"),
      status: "scheduled",
    },
  ];

  const mockRefundsData = [
    {
      bookingReference: "BK003",
      pnr: "GHI789",
      userEmail: "refund@example.com",
      id: 101,
      bookingId: 3,
      userId: 1,
      amount: "75000",
      refundedAtEpoch: new Date("2024-01-14T12:00:00Z").getTime() / 1000,
      totalAmount: 100000,
      status: "cancelled",
      paymentStatus: "refunded",
      updatedAt: new Date("2024-01-14T12:00:00Z"),
      flightNumber: "SV102",
      origin: "Cairo",
      destination: "Jeddah",
    },
  ];

  // Mock database query builder
  const _createMockQueryBuilder = (data: unknown[]) => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue(data),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getReportFilename", () => {
    it("should generate filename with timestamp", () => {
      const filename = getReportFilename("bookings", "csv");
      expect(filename).toMatch(/^bookings-\d{4}-\d{2}-\d{2}T.*\.csv$/);
    });

    it("should generate PDF filename", () => {
      const filename = getReportFilename("revenue-report", "pdf");
      expect(filename).toMatch(/^revenue-report-.*\.pdf$/);
    });

    it("should generate Excel filename", () => {
      const filename = getReportFilename("flights", "xlsx");
      expect(filename).toMatch(/^flights-.*\.xlsx$/);
    });
  });

  describe("CSV Export Functions", () => {
    describe("exportBookingsToCSV", () => {
      it("should export bookings data to CSV format", async () => {
        const mockDb = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(mockBookingsData),
        };

        vi.mocked(getDb).mockResolvedValue(
          mockDb as unknown as ReturnType<typeof getDb>
        );

        const filters: ReportFilters = {
          startDate: new Date("2024-01-01"),
          endDate: new Date("2024-01-31"),
        };

        const csv = await exportBookingsToCSV(filters);

        // Check CSV header
        expect(csv).toContain("Booking Reference");
        expect(csv).toContain("PNR");
        expect(csv).toContain("Flight Number");
        expect(csv).toContain("Total Amount (SAR)");

        // Check data rows
        expect(csv).toContain("BK001");
        expect(csv).toContain("ABC123");
        expect(csv).toContain("SV100");
      });

      it("should handle empty results", async () => {
        const mockDb = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        };

        vi.mocked(getDb).mockResolvedValue(
          mockDb as unknown as ReturnType<typeof getDb>
        );

        const csv = await exportBookingsToCSV({});

        // Should still have headers
        expect(csv).toContain("Booking Reference");
        // Should only have header line
        const lines = csv.split("\n");
        expect(lines.length).toBe(1);
      });

      it("should throw error when database is not available", async () => {
        vi.mocked(getDb).mockResolvedValue(null);

        await expect(exportBookingsToCSV({})).rejects.toThrow(
          "Database not available"
        );
      });
    });

    describe("exportRevenueToCSV", () => {
      it("should export revenue data to CSV format", async () => {
        const mockDb = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          groupBy: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockResolvedValue(mockRevenueData),
        };

        vi.mocked(getDb).mockResolvedValue(
          mockDb as unknown as ReturnType<typeof getDb>
        );

        const csv = await exportRevenueToCSV({});

        expect(csv).toContain("Date");
        expect(csv).toContain("Active Bookings");
        expect(csv).toContain("Posted Collections (SAR)");
        expect(csv).toContain("2024-01-10");
      });
    });

    describe("exportRefundsToCSV", () => {
      it("should export refunds data to CSV format", async () => {
        const mockDb = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockResolvedValue(mockRefundsData),
        };

        vi.mocked(getDb).mockResolvedValue(
          mockDb as unknown as ReturnType<typeof getDb>
        );

        const csv = await exportRefundsToCSV({});

        expect(csv).toContain("Booking Reference");
        expect(csv).toContain("Refund Amount (SAR)");
        expect(csv).toContain("BK003");
      });
    });
  });

  describe("Excel Export Functions", () => {
    describe("exportBookingsToExcel", () => {
      it("should export bookings data to Excel buffer", async () => {
        const mockDb = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(mockBookingsData),
        };

        vi.mocked(getDb).mockResolvedValue(
          mockDb as unknown as ReturnType<typeof getDb>
        );

        const buffer = await exportBookingsToExcel({});

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0);

        // Verify it's a valid Excel file by reading it
        const workbook = await readWorkbook(buffer);
        expect(workbook.sheetNames).toContain("Summary");
        expect(workbook.sheetNames).toContain("Bookings");
      });

      it("should include summary statistics", async () => {
        const mockDb = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(mockBookingsData),
        };

        vi.mocked(getDb).mockResolvedValue(
          mockDb as unknown as ReturnType<typeof getDb>
        );

        const buffer = await exportBookingsToExcel({});
        const workbook = await readWorkbook(buffer);
        const flatData = workbook.cellText("Summary");

        expect(flatData).toContain("AIS Aviation System");
        expect(flatData).toContain("Bookings Report");
      });
    });

    describe("exportRevenueToExcel", () => {
      it("should export revenue data to Excel buffer", async () => {
        const mockDb = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          groupBy: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockResolvedValue(mockRevenueData),
        };

        vi.mocked(getDb).mockResolvedValue(
          mockDb as unknown as ReturnType<typeof getDb>
        );

        const buffer = await exportRevenueToExcel({});

        expect(buffer).toBeInstanceOf(Buffer);

        const workbook = await readWorkbook(buffer);
        expect(workbook.sheetNames).toContain("Summary");
        expect(workbook.sheetNames).toContain("Daily Settlements");
      });
    });

    describe("exportFlightPerformanceToExcel", () => {
      it("should export flight performance data to Excel buffer", async () => {
        const mockDb = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(mockFlightsData),
        };

        vi.mocked(getDb).mockResolvedValue(
          mockDb as unknown as ReturnType<typeof getDb>
        );

        const buffer = await exportFlightPerformanceToExcel({});

        expect(buffer).toBeInstanceOf(Buffer);

        const workbook = await readWorkbook(buffer);
        expect(workbook.sheetNames).toContain("Flights");
      });
    });

    describe("exportRefundsToExcel", () => {
      it("should export refunds data to Excel buffer", async () => {
        const mockDb = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockResolvedValue(mockRefundsData),
        };

        vi.mocked(getDb).mockResolvedValue(
          mockDb as unknown as ReturnType<typeof getDb>
        );

        const buffer = await exportRefundsToExcel({});

        expect(buffer).toBeInstanceOf(Buffer);

        const workbook = await readWorkbook(buffer);
        expect(workbook.sheetNames).toContain("Summary");
        expect(workbook.sheetNames).toContain("Refunds");
      });
    });
  });

  describe("PDF Export Functions", () => {
    describe("generateBookingsPDF", () => {
      it("should generate PDF buffer for bookings", async () => {
        const mockSummary = {
          totalBookings: 10,
          totalRevenue: 500000,
          confirmedBookings: 8,
          cancelledBookings: 2,
          totalPassengers: 25,
        };

        const mockDb = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([mockSummary]),
        };

        vi.mocked(getDb).mockResolvedValue(
          mockDb as unknown as ReturnType<typeof getDb>
        );

        const buffer = await generateBookingsPDF({});

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0);

        // PDF files start with %PDF
        expect(buffer.toString("utf8", 0, 4)).toBe("%PDF");
      });

      it("should throw error when database is not available", async () => {
        vi.mocked(getDb).mockResolvedValue(null);

        await expect(generateBookingsPDF({})).rejects.toThrow(
          "Database not available"
        );
      });
    });

    describe("generateRevenuePDF", () => {
      it("should generate PDF buffer for revenue", async () => {
        const mockDb = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          groupBy: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockResolvedValue(mockRevenueData),
        };

        vi.mocked(getDb).mockResolvedValue(
          mockDb as unknown as ReturnType<typeof getDb>
        );

        const buffer = await generateRevenuePDF({});

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.toString("utf8", 0, 4)).toBe("%PDF");
      });
    });

    describe("generateRefundsPDF", () => {
      it("should generate PDF buffer for refunds", async () => {
        const mockDb = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockResolvedValue(mockRefundsData),
        };

        vi.mocked(getDb).mockResolvedValue(
          mockDb as unknown as ReturnType<typeof getDb>
        );

        const buffer = await generateRefundsPDF({});

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.toString("utf8", 0, 4)).toBe("%PDF");
      });
    });

    describe("generateFlightPerformancePDF", () => {
      it("should generate PDF buffer for flight performance", async () => {
        const mockDb = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(mockFlightsData),
        };

        vi.mocked(getDb).mockResolvedValue(
          mockDb as unknown as ReturnType<typeof getDb>
        );

        const buffer = await generateFlightPerformancePDF({});

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.toString("utf8", 0, 4)).toBe("%PDF");
      });
    });
  });

  describe("Filter handling", () => {
    it("should apply date filters correctly", async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };

      vi.mocked(getDb).mockResolvedValue(
        mockDb as unknown as ReturnType<typeof getDb>
      );

      const filters: ReportFilters = {
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-01-31"),
        status: "confirmed",
      };

      await exportBookingsToCSV(filters);

      expect(mockDb.where).toHaveBeenCalled();
    });

    it("should handle missing filters gracefully", async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };

      vi.mocked(getDb).mockResolvedValue(
        mockDb as unknown as ReturnType<typeof getDb>
      );

      // Should not throw with empty filters
      await expect(exportBookingsToCSV({})).resolves.toBeDefined();
    });
  });
});

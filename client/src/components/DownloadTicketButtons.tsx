import { Button } from "@/components/ui/button";
import { Download, FileText, CalendarPlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { downloadPDFFromBase64 } from "@/lib/downloadPDF";
import { toast } from "sonner";
import { useState } from "react";

function downloadFileFromBase64(
  base64: string,
  filename: string,
  mimeType: string
) {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

interface DownloadETicketButtonProps {
  bookingId: number;
  passengerId?: number;
}

export function DownloadETicketButton({
  bookingId,
  passengerId,
}: DownloadETicketButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const generateETicket = trpc.eticket.generateETicket.useMutation();

  const handleDownload = async () => {
    if (!passengerId) {
      toast.error("لا يوجد راكب مرتبط بهذا الحجز");
      return;
    }

    setIsDownloading(true);
    try {
      const result = await generateETicket.mutateAsync({
        bookingId,
        passengerId,
      });

      downloadPDFFromBase64(result.pdf, result.filename);
      toast.success("تم تحميل التذكرة الإلكترونية بنجاح");
    } catch (error: any) {
      console.error("Error downloading e-ticket:", error);
      toast.error(error.message || "فشل تحميل التذكرة الإلكترونية");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Button
      variant="default"
      size="sm"
      onClick={handleDownload}
      disabled={isDownloading || !passengerId}
    >
      <Download className="h-3 w-3" />
    </Button>
  );
}

interface DownloadBoardingPassButtonProps {
  bookingId: number;
  passengerId?: number;
}

export function DownloadBoardingPassButton({
  bookingId,
  passengerId,
}: DownloadBoardingPassButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const generateBoardingPass = trpc.eticket.generateBoardingPass.useMutation();

  const handleDownload = async () => {
    if (!passengerId) {
      toast.error("لا يوجد راكب مرتبط بهذا الحجز");
      return;
    }

    setIsDownloading(true);
    try {
      const result = await generateBoardingPass.mutateAsync({
        bookingId,
        passengerId,
      });

      downloadPDFFromBase64(result.pdf, result.filename);
      toast.success("تم تحميل بطاقة الصعود بنجاح");
    } catch (error: any) {
      console.error("Error downloading boarding pass:", error);
      toast.error(error.message || "فشل تحميل بطاقة الصعود");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={isDownloading || !passengerId}
    >
      <FileText className="h-3 w-3" />
    </Button>
  );
}

interface AddToCalendarButtonProps {
  bookingId: number;
}

export function AddToCalendarButton({ bookingId }: AddToCalendarButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const generateCalendar = trpc.eticket.generateCalendarEvent.useMutation();

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const result = await generateCalendar.mutateAsync({ bookingId });
      downloadFileFromBase64(result.ics, result.filename, "text/calendar");
      toast.success("Calendar event downloaded");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to generate calendar";
      console.error("Error generating calendar event:", error);
      toast.error(message);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={isDownloading}
      title="Add to Calendar"
    >
      <CalendarPlus className="h-3 w-3" />
    </Button>
  );
}

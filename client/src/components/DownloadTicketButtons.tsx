import { Button } from "@/components/ui/button";
import { Download, FileText } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { downloadPDFFromBase64 } from "@/lib/downloadPDF";
import { toast } from "sonner";
import { useState } from "react";

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

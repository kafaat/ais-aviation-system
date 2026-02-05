/**
 * SavedPassengers Page
 * Manage saved passenger profiles
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SavePassengerDialog } from "@/components/SavePassengerDialog";
import {
  ChevronLeft,
  User,
  Users,
  Star,
  Pencil,
  Trash2,
  MoreVertical,
  Loader2,
  UserPlus,
  LogIn,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export default function SavedPassengers() {
  const { t, i18n } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editPassenger, setEditPassenger] = useState<{
    id: number;
    data: {
      firstName: string;
      lastName: string;
      dateOfBirth?: Date;
      nationality?: string;
      passportNumber?: string;
      passportExpiry?: Date;
      email?: string;
      phone?: string;
    };
  } | null>(null);

  const currentLocale = i18n.language === "ar" ? ar : enUS;

  const {
    data: passengers,
    isLoading,
    refetch,
  } = trpc.savedPassengers.getAll.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const utils = trpc.useUtils();

  const deletePassenger = trpc.savedPassengers.delete.useMutation({
    onSuccess: () => {
      toast.success(t("savedPassengers.deleteSuccess"));
      utils.savedPassengers.getAll.invalidate();
      setDeleteId(null);
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const setDefault = trpc.savedPassengers.setDefault.useMutation({
    onSuccess: () => {
      toast.success(t("savedPassengers.defaultUpdated"));
      utils.savedPassengers.getAll.invalidate();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
        <SEO title={t("savedPassengers.title")} />
        <div className="container py-16">
          <Card className="max-w-md mx-auto p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
              <LogIn className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-2">
              {t("myBookings.loginRequired")}
            </h2>
            <p className="text-muted-foreground mb-6">
              {t("savedPassengers.loginRequiredDesc")}
            </p>
            <Button asChild>
              <Link href="/">{t("common.login")}</Link>
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <SEO
        title={t("savedPassengers.title")}
        description={t("savedPassengers.subtitle")}
      />

      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50 shadow-sm">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/profile">
                <Button variant="ghost" size="icon" className="rounded-full">
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold">
                  {t("savedPassengers.title")}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t("savedPassengers.subtitle")}
                </p>
              </div>
            </div>
            <SavePassengerDialog onSuccess={() => refetch()} />
          </div>
        </div>
      </header>

      <div className="container py-8">
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-48 rounded-xl" />
            ))}
          </div>
        ) : passengers && passengers.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {passengers.map(passenger => (
              <Card
                key={passenger.id}
                className="p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold">
                        {passenger.firstName} {passenger.lastName}
                      </h3>
                      {passenger.isDefault && (
                        <Badge
                          variant="secondary"
                          className="text-xs bg-amber-100 text-amber-700"
                        >
                          <Star className="h-3 w-3 mr-1 fill-current" />
                          {t("savedPassengers.default")}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() =>
                          setEditPassenger({
                            id: passenger.id,
                            data: {
                              firstName: passenger.firstName,
                              lastName: passenger.lastName,
                              dateOfBirth: passenger.dateOfBirth || undefined,
                              nationality: passenger.nationality || undefined,
                              passportNumber:
                                passenger.passportNumber || undefined,
                              passportExpiry:
                                passenger.passportExpiry || undefined,
                              email: passenger.email || undefined,
                              phone: passenger.phone || undefined,
                            },
                          })
                        }
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        {t("common.edit")}
                      </DropdownMenuItem>
                      {!passenger.isDefault && (
                        <DropdownMenuItem
                          onClick={() =>
                            setDefault.mutate({ id: passenger.id })
                          }
                        >
                          <Star className="h-4 w-4 mr-2" />
                          {t("savedPassengers.setAsDefault")}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setDeleteId(passenger.id)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {t("common.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="space-y-2 text-sm">
                  {passenger.nationality && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("booking.nationality")}
                      </span>
                      <span>{passenger.nationality}</span>
                    </div>
                  )}
                  {passenger.passportNumber && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("profile.personal.passportNumber")}
                      </span>
                      <span className="font-mono">
                        {passenger.passportNumber}
                      </span>
                    </div>
                  )}
                  {passenger.passportExpiry && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("profile.personal.passportExpiry")}
                      </span>
                      <span>
                        {format(
                          new Date(passenger.passportExpiry),
                          "dd MMM yyyy",
                          { locale: currentLocale }
                        )}
                      </span>
                    </div>
                  )}
                  {passenger.dateOfBirth && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("savedPassengers.dateOfBirth")}
                      </span>
                      <span>
                        {format(
                          new Date(passenger.dateOfBirth),
                          "dd MMM yyyy",
                          { locale: currentLocale }
                        )}
                      </span>
                    </div>
                  )}
                  {passenger.email && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("savedPassengers.email")}
                      </span>
                      <span className="truncate max-w-[150px]">
                        {passenger.email}
                      </span>
                    </div>
                  )}
                  {passenger.phone && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("profile.personal.phone")}
                      </span>
                      <span>{passenger.phone}</span>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="max-w-md mx-auto p-12 text-center border-dashed">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-6">
              <Users className="h-10 w-10 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-2">
              {t("savedPassengers.noPassengers")}
            </h2>
            <p className="text-muted-foreground mb-6">
              {t("savedPassengers.noPassengersHint")}
            </p>
            <SavePassengerDialog
              onSuccess={() => refetch()}
              triggerButton={
                <Button>
                  <UserPlus className="h-4 w-4 mr-2" />
                  {t("savedPassengers.addFirst")}
                </Button>
              }
            />
          </Card>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={deleteId !== null}
        onOpenChange={() => setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("savedPassengers.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("savedPassengers.deleteConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteId && deletePassenger.mutate({ id: deleteId })
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletePassenger.isPending}
            >
              {deletePassenger.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit dialog */}
      {editPassenger && (
        <SavePassengerDialog
          mode="edit"
          passengerId={editPassenger.id}
          initialData={editPassenger.data}
          onSuccess={() => {
            setEditPassenger(null);
            refetch();
          }}
          triggerButton={<span className="hidden" />}
        />
      )}
    </div>
  );
}

import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Menu } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { NotificationBell } from "./NotificationBell";

const travelLinks = [
  ["/search", "nav.searchFlights"],
  ["/manage-booking", "ibe.manageBooking"],
  ["/check-in", "nav.checkIn"],
  ["/track-flight", "liveTracking.title"],
  ["/baggage", "baggage.title"],
  ["/ai-chat", "aiChat.title"],
] as const;

const accountLinks = [
  ["/my-bookings", "nav.myBookings"],
  ["/saved-passengers", "savedPassengers.title"],
  ["/notifications", "notifications.title"],
  ["/my-groups", "groupBooking.myAllocations"],
  ["/my-waitlist", "waitlist.myWaitlist"],
  ["/payment-history", "paymentHistory.title"],
  ["/profile", "nav.profile"],
] as const;

function CorporateNavigationItem() {
  const { t } = useTranslation();
  const account = trpc.corporate.getMyAccount.useQuery(undefined, {
    retry: false,
  });
  const invitations = trpc.corporate.myInvitations.useQuery(undefined, {
    enabled: !account.data,
    retry: false,
  });
  const hasAccount = !account.error && Boolean(account.data);
  const hasInvitation = !invitations.error && Boolean(invitations.data?.length);

  if (!hasAccount && !hasInvitation) return null;

  return (
    <DropdownMenuItem asChild>
      <Link href="/corporate">{t("corporate.title")}</Link>
    </DropdownMenuItem>
  );
}

/** Shared entry points for public travel services and the signed-in account. */
export function ServiceNavigation() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  return (
    <div className="flex shrink-0 items-center gap-1">
      <DropdownMenu dir={i18n.language.startsWith("ar") ? "rtl" : "ltr"}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label={t("footer.services")}>
            <Menu className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("footer.services")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>{t("footer.services")}</DropdownMenuLabel>
          {travelLinks.map(([href, label]) => (
            <DropdownMenuItem key={href} asChild>
              <Link href={href}>{t(label)}</Link>
            </DropdownMenuItem>
          ))}
          {user && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {t("accessibility.userMenu")}
              </DropdownMenuLabel>
              {accountLinks.map(([href, label]) => (
                <DropdownMenuItem key={href} asChild>
                  <Link href={href}>{t(label)}</Link>
                </DropdownMenuItem>
              ))}
              <CorporateNavigationItem key={user.id} />
              {[
                "admin",
                "super_admin",
                "airline_admin",
                "ops",
                "finance",
              ].includes(user.role) && (
                <DropdownMenuItem asChild>
                  <Link href="/airline">
                    {i18n.language.startsWith("ar")
                      ? "لوحة شركة الطيران"
                      : "Airline console"}
                  </Link>
                </DropdownMenuItem>
              )}
              {["admin", "super_admin", "airline_admin", "ops"].includes(
                user.role
              ) && (
                <DropdownMenuItem asChild>
                  <Link href="/airline/dcs">
                    {i18n.language.startsWith("ar")
                      ? "مكتب المغادرة"
                      : "Departure desk"}
                  </Link>
                </DropdownMenuItem>
              )}
              {(user.role === "admin" || user.role === "super_admin") && (
                <DropdownMenuItem asChild>
                  <Link href="/admin">{t("nav.admin")}</Link>
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {user && <NotificationBell key={user.id} />}
    </div>
  );
}

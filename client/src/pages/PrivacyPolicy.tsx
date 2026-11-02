import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { ArrowLeft, Plane, ShieldCheck } from "lucide-react";
import { SEO } from "@/components/SEO";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SiteFooter } from "@/components/SiteFooter";
import { CookieSettingsButton } from "@/components/CookieConsent";
import { Card } from "@/components/ui/card";
import { APP_TITLE } from "@/const";
import {
  BIOMETRIC_ENROLLMENT_VALIDITY_DAYS,
  DELETED_BOOKING_RETENTION_DAYS,
} from "@shared/const";

/**
 * ISO date of the last substantive change to the policy text.
 * Update it whenever the `privacy` i18n namespace changes meaning.
 */
export const PRIVACY_POLICY_LAST_UPDATED = "2026-11-02";

/**
 * PLACEHOLDERS -- the operator must replace these before go-live.
 *
 * This repository is a product, not a legal entity, so it does not know who
 * operates a given deployment. The legal name of the data controller and its
 * contact channel (e-mail / postal address / DPO) are deliberately rendered as
 * bracketed placeholders, and the page shows a visible notice while they are
 * still present. See docs/GO_LIVE_RUNBOOK.md, section 1.6.
 */
const OPERATOR_LEGAL_NAME_PLACEHOLDER = "[operator legal name]";
const OPERATOR_CONTACT_PLACEHOLDER = "[operator contact]";

const PLACEHOLDER_PATTERN = /^\[.*\]$/;
const hasUnfilledPlaceholders = [
  OPERATOR_LEGAL_NAME_PLACEHOLDER,
  OPERATOR_CONTACT_PLACEHOLDER,
].some(value => PLACEHOLDER_PATTERN.test(value));

interface SectionProps {
  id: string;
  title: string;
  children: React.ReactNode;
}

function Section({ id, title, children }: SectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="space-y-3">
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPolicy() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? ar : enUS;
  const lastUpdated = format(parseISO(PRIVACY_POLICY_LAST_UPDATED), "PPP", {
    locale,
  });

  const vars = {
    appName: APP_TITLE,
    operator: OPERATOR_LEGAL_NAME_PLACEHOLDER,
    contact: OPERATOR_CONTACT_PLACEHOLDER,
    days: BIOMETRIC_ENROLLMENT_VALIDITY_DAYS,
    deletedBookingDays: DELETED_BOOKING_RETENTION_DAYS,
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-blue-50 via-white to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <a href="#main-content" className="skip-to-content">
        {t("accessibility.skipToContent")}
      </a>

      <SEO
        title={t("privacy.title")}
        description={t("privacy.metaDescription", vars)}
      />

      <header
        className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b sticky top-0 z-50 shadow-sm"
        role="banner"
      >
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <Link href="/">
              <div className="flex items-center gap-3 cursor-pointer">
                <Plane className="h-8 w-8 text-primary" />
                <div>
                  <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
                    {t("common.appName")}
                  </h1>
                  <p className="text-xs text-muted-foreground">AIS</p>
                </div>
              </div>
            </Link>

            <nav
              className="hidden md:flex items-center gap-6"
              role="navigation"
              aria-label={t("accessibility.mainNavigation")}
            >
              <Link href="/">
                <a className="text-sm font-medium hover:text-primary transition-colors">
                  {t("nav.home")}
                </a>
              </Link>
              <Link href="/my-bookings">
                <a className="text-sm font-medium hover:text-primary transition-colors">
                  {t("nav.myBookings")}
                </a>
              </Link>
              <Link href="/check-in">
                <a className="text-sm font-medium hover:text-primary transition-colors">
                  {t("nav.checkIn")}
                </a>
              </Link>
            </nav>

            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      </header>

      <main id="main-content" role="main" className="flex-1">
        <div className="container py-12">
          <div className="mx-auto max-w-3xl space-y-8">
            <div className="space-y-3">
              <Link href="/">
                <a className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors">
                  <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                  {t("privacy.backHome")}
                </a>
              </Link>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight">
                  {t("privacy.title")}
                </h1>
              </div>
              <p className="text-sm text-muted-foreground">
                <time dateTime={PRIVACY_POLICY_LAST_UPDATED}>
                  {t("privacy.lastUpdated", { date: lastUpdated })}
                </time>
              </p>
            </div>

            {hasUnfilledPlaceholders && (
              <div
                role="note"
                className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
              >
                {t("privacy.operatorPlaceholderNotice")}
              </div>
            )}

            <Card className="p-6 sm:p-8 space-y-10">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t("privacy.intro", vars)}
              </p>

              <Section id="account" title={t("privacy.sections.account.title")}>
                <p>{t("privacy.sections.account.body")}</p>
              </Section>

              <Section id="booking" title={t("privacy.sections.booking.title")}>
                <p>{t("privacy.sections.booking.body")}</p>
              </Section>

              <Section id="payment" title={t("privacy.sections.payment.title")}>
                <p>{t("privacy.sections.payment.body")}</p>
              </Section>

              <Section
                id="preferences"
                title={t("privacy.sections.preferences.title")}
              >
                <p>{t("privacy.sections.preferences.body")}</p>
              </Section>

              <Section id="cookies" title={t("privacy.sections.cookies.title")}>
                <p>{t("privacy.sections.cookies.intro")}</p>
                <ul className="list-disc space-y-2 ps-5">
                  <li>{t("privacy.sections.cookies.essential")}</li>
                  <li>{t("privacy.sections.cookies.analytics")}</li>
                  <li>{t("privacy.sections.cookies.marketing")}</li>
                  <li>{t("privacy.sections.cookies.preferences")}</li>
                </ul>
                <p>{t("privacy.sections.cookies.consent")}</p>
                <CookieSettingsButton />
              </Section>

              <Section
                id="biometric"
                title={t("privacy.sections.biometric.title")}
              >
                <p>{t("privacy.sections.biometric.body", vars)}</p>
              </Section>

              <Section id="sharing" title={t("privacy.sections.sharing.title")}>
                <p>{t("privacy.sections.sharing.intro")}</p>
                <ul className="list-disc space-y-2 ps-5">
                  <li>{t("privacy.sections.sharing.airlines")}</li>
                  <li>{t("privacy.sections.sharing.payments")}</li>
                  <li>{t("privacy.sections.sharing.regulators")}</li>
                  <li>{t("privacy.sections.sharing.providers")}</li>
                  <li>{t("privacy.sections.sharing.corporate")}</li>
                </ul>
                <p className="font-medium text-foreground">
                  {t("privacy.sections.sharing.noSale")}
                </p>
              </Section>

              <Section
                id="retention"
                title={t("privacy.sections.retention.title")}
              >
                <p>{t("privacy.sections.retention.body", vars)}</p>
              </Section>

              <Section id="rights" title={t("privacy.sections.rights.title")}>
                <p>{t("privacy.sections.rights.intro")}</p>
                <ul className="list-disc space-y-2 ps-5">
                  <li>{t("privacy.sections.rights.access")}</li>
                  <li>{t("privacy.sections.rights.correction")}</li>
                  <li>{t("privacy.sections.rights.deletion")}</li>
                  <li>{t("privacy.sections.rights.withdraw")}</li>
                  <li>{t("privacy.sections.rights.object")}</li>
                </ul>
                <p>{t("privacy.sections.rights.howTo")}</p>
              </Section>

              <Section
                id="security"
                title={t("privacy.sections.security.title")}
              >
                <p>{t("privacy.sections.security.body")}</p>
              </Section>

              <Section id="changes" title={t("privacy.sections.changes.title")}>
                <p>{t("privacy.sections.changes.body")}</p>
              </Section>

              <Section id="contact" title={t("privacy.sections.contact.title")}>
                <p>{t("privacy.sections.contact.body", vars)}</p>
              </Section>
            </Card>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

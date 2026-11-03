import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { airlineSupportUrl } from "@/lib/airline-support";

export default function AccessibilityStatement() {
  const { t } = useTranslation();
  const support = airlineSupportUrl();
  return (
    <>
      <SEO
        title={t("accessibility.statement.title")}
        description={t("accessibility.statement.scope")}
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-3xl space-y-5 px-4 py-12"
      >
        <Link href="/" className="underline">
          {t("nav.home")}
        </Link>
        <h1 className="text-3xl font-bold">
          {t("accessibility.statement.title")}
        </h1>
        <p>{t("accessibility.statement.scope")}</p>
        <h2 className="text-xl font-semibold">
          {t("accessibility.statement.helpTitle")}
        </h2>
        <p>{t("accessibility.statement.help")}</p>
        {support && (
          <a
            href={support.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {t("aiChat.contactSupport")}
          </a>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

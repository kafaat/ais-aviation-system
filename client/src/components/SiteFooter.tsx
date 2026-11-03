import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { BrandIdentity } from "./BrandIdentity";

/**
 * Site-wide footer shared by the public pages (home, privacy policy, ...).
 * Extracted from the Home page so legal links stay in one place.
 */
export function SiteFooter() {
  const { t } = useTranslation();

  return (
    <footer className="bg-slate-900 text-white py-12" role="contentinfo">
      <div className="container">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <h3 className="font-bold text-lg">
                <BrandIdentity />
              </h3>
            </div>
            <p className="text-sm text-gray-400">{t("footer.description")}</p>
          </div>

          <div>
            <h4 className="font-semibold mb-4">{t("footer.quickLinks")}</h4>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>
                <Link href="/" className="hover:text-white transition-colors">
                  {t("footer.about")}
                </Link>
              </li>
              <li>
                <Link href="/" className="hover:text-white transition-colors">
                  {t("footer.contact")}
                </Link>
              </li>
              <li>
                <Link href="/" className="hover:text-white transition-colors">
                  {t("footer.terms")}
                </Link>
              </li>
              <li>
                <Link
                  href="/privacy-policy"
                  className="hover:text-white transition-colors"
                >
                  {t("footer.privacy")}
                </Link>
              </li>
              <li>
                <Link
                  href="/accessibility"
                  className="hover:text-white transition-colors"
                >
                  {t("accessibility.statement.title")}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4">{t("footer.services")}</h4>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>
                <Link
                  href="/search"
                  className="hover:text-white transition-colors"
                >
                  {t("footer.bookTickets")}
                </Link>
              </li>
              <li>
                <Link
                  href="/codeshare-flights"
                  className="hover:text-white transition-colors"
                >
                  {t("codeshare.codeshareFlights")}
                </Link>
              </li>
              <li>
                <Link
                  href="/manage-booking"
                  className="hover:text-white transition-colors"
                >
                  {t("footer.manageBookings")}
                </Link>
              </li>
              <li>
                <Link
                  href="/my-bookings"
                  className="hover:text-white transition-colors"
                >
                  {t("nav.myBookings")}
                </Link>
              </li>
              <li>
                <Link
                  href="/agent"
                  className="hover:text-white transition-colors"
                >
                  {t("ibe.agentPortal")}
                </Link>
              </li>
              <li>
                <Link
                  href="/kiosk"
                  className="hover:text-white transition-colors"
                >
                  {t("kioskBagTag.title")}
                </Link>
              </li>
              <li>
                <Link
                  href="/check-in"
                  className="hover:text-white transition-colors"
                >
                  {t("footer.checkIn")}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4">{t("footer.contactUs")}</h4>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>{t("footer.email")}: info@ais.com</li>
              <li>{t("footer.phone")}: +966 11 234 5678</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
          © 2026 AIS - {t("footer.rights")}
        </div>
      </div>
    </footer>
  );
}

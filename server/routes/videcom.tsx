import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "express";
import {
  publicIbeConfiguration,
  videcomBaseUrl,
} from "../services/ibe-public-config.service";

const labels = {
  en: {
    booking: "Book a flight",
    manage: "Manage a booking",
    agent: "Travel agent sign-in",
    title: "Airline reservations",
  },
  ar: {
    booking: "احجز رحلة",
    manage: "إدارة الحجز",
    agent: "دخول وكيل السفر",
    title: "حجوزات الطيران",
  },
};

const paths = ["/videcom", "/videcom/brand/header", "/videcom/brand/footer"];

export function createVidecomRouter(env = process.env) {
  const router = Router({ caseSensitive: true, strict: true });
  const base = videcomBaseUrl(env.VIDECOM_IBE_BASE_URL);
  if (!base) {
    router.all(paths, (_req, res) =>
      res.status(404).set("Cache-Control", "no-store").end()
    );
    return router;
  }
  const { brandName, logoPath } = publicIbeConfiguration(env);
  const color = env.VIDECOM_BRAND_COLOR || "#18466b";
  if (!/^#[\da-f]{6}$/i.test(color) || color.length !== 7)
    throw new Error("VIDECOM_BRAND_COLOR requires a six-digit hex color");
  const panels = new URL("VARS/Public/CustomerPanels/", base);
  const manage = new URL("MMBLoginbs.aspx", panels).href;
  const agent = new URL("AgentLoginBS.aspx", panels).href;
  router.get(paths, (req, res) => {
    const portal = req.path === "/videcom";
    const header = req.path.endsWith("/header");
    const lang =
      req.query.lang === "ar" || req.query.lang === "en"
        ? req.query.lang
        : req.acceptsLanguages("ar", "en") === "en"
          ? "en"
          : "ar";
    const copy = labels[lang];
    const search = new URL("requirementsBS.aspx", panels);
    // Videcom owns the supported markets. Native AIS display choices do not
    // constrain a provider booking (for example, Yemen and the Yemeni rial).
    const { country, currency } = req.query;
    if (
      typeof country === "string" &&
      country.length === 2 &&
      /^[a-z]{2}$/i.test(country)
    )
      search.searchParams.set("country", country.toLowerCase());
    if (
      typeof currency === "string" &&
      currency.length === 3 &&
      /^[a-z]{3}$/i.test(currency)
    )
      search.searchParams.set("currency", currency.toUpperCase());

    // These standalone documents contain no app router, session, scripts or AIS forms.
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": [
        "default-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "style-src 'unsafe-inline'",
        "img-src 'self'",
        portal
          ? "frame-ancestors 'none'"
          : `frame-ancestors 'self' ${base.origin}`,
        portal ? `frame-src ${base.origin}` : "frame-src 'none'",
      ].join("; "),
    });
    if (!portal) res.removeHeader("X-Frame-Options");
    const identity = (
      <strong>
        {logoPath && <img src={logoPath} alt="" />} {brandName}
      </strong>
    );
    const sandbox =
      "allow-forms allow-scripts allow-same-origin allow-top-navigation-by-user-activation";
    const html = (
      <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="referrer" content="no-referrer" />
          <title>{`${brandName} · ${copy.title}`}</title>
          <style>{`
            body { font: 1rem/1.5 system-ui, sans-serif; margin: 0; color: #172c40; background: white; }
            main, header, footer {
              max-width: 64rem;
              margin: auto;
              padding: 1rem;
              border-block-start: 4px solid ${color};
            }
            img { max-width: 9rem; max-height: 2.5rem; vertical-align: middle; }
            iframe { width: 100%; height: 20rem; border: 0; }
            a { color: #164e83; }
            nav { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; }
            nav a { display: inline-block; padding: 0.65rem 0.35rem; }
            section { margin: 1.5rem 0; }
          `}</style>
        </head>
        <body>
          {portal ? (
            <main>
              {identity}
              <h1>{copy.title}</h1>
              <nav aria-label={copy.title}>
                {[
                  [copy.booking, search.href],
                  [copy.manage, manage],
                  [copy.agent, agent],
                ].map(([title, url]) => (
                  <a key={url} href={url} target="_top" rel="noreferrer">
                    {title}
                  </a>
                ))}
              </nav>
              {[
                [copy.booking, search.href],
                [copy.manage, manage],
              ].map(([title, url]) => (
                <section key={url}>
                  <h2>{title}</h2>
                  <iframe
                    title={title}
                    src={url}
                    sandbox={sandbox}
                    referrerPolicy="no-referrer"
                  />
                </section>
              ))}
            </main>
          ) : header ? (
            <header>{identity}</header>
          ) : (
            <footer>
              {brandName} · {copy.title}
            </footer>
          )}
        </body>
      </html>
    );
    res.type("html").send("<!doctype html>" + renderToStaticMarkup(html));
  });
  router.all(paths, (_req, res) =>
    res.set("Allow", "GET, HEAD").sendStatus(405)
  );
  return router;
}

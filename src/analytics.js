// Google Analytics 4 (gtag.js, G-NJ43DW0SFV) with Consent Mode v2: the
// set-up Google's snippet does in an inline <script>, which the site's
// policy refuses. The library itself is `meta.scripts`; where it sends data
// is `meta.connect`; the banner that asks is `ConsentBanner`.
//
// Nothing is stored until the reader allows it: every consent type starts
// `denied`, so Analytics sets no cookies and sends only cookieless pings.
// Only the live site reports, so `wf serve`, `wf verify` and Lighthouse
// runs on localhost are not counted as visits.

const CONSENT_KEY = "mo:analytics-consent";

window.dataLayer = window.dataLayer || [];
function gtag() {
  // gtag.js reads the `arguments` object itself, not an array.
  window.dataLayer.push(arguments);
}

/**
 * The reader's answer, or "" when they have not been asked.
 * @returns {string} "granted", "denied" or ""
 */
function consentChoice() {
  try {
    return window.localStorage.getItem(CONSENT_KEY) || "";
  } catch (e) {
    return "";
  }
}

/**
 * Record the reader's answer and tell Analytics. The site runs no ads, so
 * the advertising signals stay denied either way.
 * @param {boolean} granted
 */
function setConsent(granted) {
  const value = granted ? "granted" : "denied";
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
  } catch (e) {
    // Without storage the answer holds for this page only.
  }
  gtag("consent", "update", { analytics_storage: value });
}

gtag("consent", "default", {
  analytics_storage: consentChoice() === "granted" ? "granted" : "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  wait_for_update: 500,
});

if (location.hostname === "monzeromer.dev") {
  gtag("js", new Date());
  gtag("config", "G-NJ43DW0SFV");
}

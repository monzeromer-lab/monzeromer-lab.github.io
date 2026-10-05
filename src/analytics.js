// Google Analytics 4 (gtag.js, G-NJ43DW0SFV): the set-up Google's snippet
// does in an inline <script>, which the site's policy refuses. The library
// itself is `meta.scripts`; where it sends data is `meta.connect`.
//
// Only the live site reports, so `wf serve`, `wf verify` and Lighthouse
// runs on localhost are not counted as visits.
window.dataLayer = window.dataLayer || [];
function gtag() {
  // gtag.js reads the `arguments` object itself, not an array.
  window.dataLayer.push(arguments);
}
if (location.hostname === "monzeromer.dev") {
  gtag("js", new Date());
  gtag("config", "G-NJ43DW0SFV");
}

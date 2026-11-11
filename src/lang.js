// The document's language follows the page. The site is Arabic at the root
// and English under /en, but the build writes one <html lang dir> for every
// page (`meta.lang`), so an English page fixes it here as soon as it is drawn,
// and again on every route a reader follows.
function syncDocumentLanguage() {
  var english = location.pathname === "/en" || location.pathname.indexOf("/en/") === 0;
  document.documentElement.lang = english ? "en" : "ar";
  document.documentElement.dir = english ? "ltr" : "rtl";
}
syncDocumentLanguage();
document.addEventListener("wf:render", syncDocumentLanguage);

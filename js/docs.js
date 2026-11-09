// How it works: static text from the strings file, plus the data links and the contact address.
import { CITIES, CONTACT, t, dataUrl, start, footer } from "./app.js";

start(() => {
  document.title = t("title.docs");
  document.getElementById("datalinks").innerHTML = Object.keys(CITIES).map(c => `<a href="${dataUrl(c)}">${c}.json</a>`).join(" · ");
  document.getElementById("contact").innerHTML = t("docs.contact", { mail: `<a href="mailto:${CONTACT}">${CONTACT}</a>` });
  footer(null);
}, false);

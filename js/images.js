// Freely licensed image candidates from iNaturalist and Wikimedia Commons.

import { t } from "./i18n.js?v=7";

// iNaturalist license codes we accept (no "all rights reserved", no -nd)
const INAT_LICENSES = {
  "cc0": "CC0",
  "cc-by": "CC BY",
  "cc-by-sa": "CC BY-SA",
  "cc-by-nc": "CC BY-NC",
  "cc-by-nc-sa": "CC BY-NC-SA",
  "pd": "Public Domain",
};
const INAT_LICENSE_URLS = {
  "cc0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "cc-by": "https://creativecommons.org/licenses/by/4.0/",
  "cc-by-sa": "https://creativecommons.org/licenses/by-sa/4.0/",
  "cc-by-nc": "https://creativecommons.org/licenses/by-nc/4.0/",
  "cc-by-nc-sa": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  "pd": "https://creativecommons.org/publicdomain/mark/1.0/",
};

export const ALLOWED_IMAGE_HOSTS = ["wikimedia.org", "inaturalist.org", "inaturalist-open-data.s3.amazonaws.com"];

const stripHtml = (s) => {
  const el = document.createElement("div");
  el.innerHTML = s || "";
  return (el.textContent || "").replace(/\s+/g, " ").trim();
};

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${new URL(url).hostname}: ${r.status}`);
  return r.json();
}

export async function inaturalist(name, limit = 8) {
  const search = await json(`https://api.inaturalist.org/v1/taxa?${new URLSearchParams({ q: name, per_page: 5 })}`);
  const hit = search.results.find((t) => t.name.toLowerCase() === name.toLowerCase()) || search.results[0];
  if (!hit) return [];
  const taxon = (await json(`https://api.inaturalist.org/v1/taxa/${hit.id}`)).results[0];
  const out = [];
  for (const { photo: p } of taxon.taxon_photos || []) {
    const license = INAT_LICENSES[p.license_code || ""];
    if (!license || !p.medium_url) continue;
    out.push({
      source: "inaturalist",
      thumb: p.medium_url.replace("/medium.", "/small."),
      url: p.medium_url.replace("/medium.", "/large."),
      license,
      license_url: INAT_LICENSE_URLS[p.license_code],
      credit: p.attribution || "",
      page_url: `https://www.inaturalist.org/photos/${p.id}`,
      title: taxon.name,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function commons(name, limit = 8) {
  const d = await json(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
    action: "query", format: "json", origin: "*", generator: "search",
    gsrsearch: `filetype:bitmap "${name}"`, gsrnamespace: 6, gsrlimit: limit,
    prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: 1280,
  })}`);
  const pages = Object.values(d.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const out = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0] || {};
    const meta = ii.extmetadata || {};
    if (!["image/jpeg", "image/png", "image/webp"].includes(ii.mime) || !ii.thumburl) continue;
    out.push({
      source: "commons",
      // Commons only serves thumbnails in standard widths (330, 500, 960, 1280, ...)
      thumb: ii.thumburl.replace(/\/\d+px-/, "/330px-"),
      url: ii.thumburl,
      license: stripHtml(meta.LicenseShortName?.value) || t("seeSource"),
      license_url: meta.LicenseUrl?.value || null,
      credit: stripHtml(meta.Artist?.value) || "Wikimedia Commons",
      page_url: ii.descriptionurl,
      title: p.title.replace(/^File:/, ""),
    });
  }
  return out;
}

export async function candidates(name) {
  const results = await Promise.allSettled([inaturalist(name), commons(name)]);
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

export async function fetchImage(url) {
  const host = new URL(url).hostname;
  if (!ALLOWED_IMAGE_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
    throw new Error(t("err.imageHost"));
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(t("err.download", r.status));
  return r.blob();
}

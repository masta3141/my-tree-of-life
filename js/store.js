// Browser-side data layer: IndexedDB storage + the logic the Python backend used to do.

import * as gbif from "./gbif.js?v=12";
import * as gemini from "./gemini.js?v=12";
import * as images from "./images.js?v=12";
import { buildTree } from "./tree.js?v=12";
import { tryDownscale, PHOTO_MAX, THUMB_MAX } from "./resize.js?v=12";
import { t as tr, lang, labelOf, taxonInfo } from "./i18n.js?v=12";

const DOMAIN_NAMES = {
  Eukaryota: { de: "Eukaryoten", en: "Eukaryotes" },
  Bacteria: { de: "Bakterien", en: "Bacteria" },
  Archaea: { de: "Archaeen", en: "Archaea" },
  Viruses: { de: "Viren", en: "Viruses" },
};
const otherLang = () => (lang === "en" ? "de" : "en");

// ---------- IndexedDB plumbing ----------

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("tree-of-life", 1); // keep name, renaming would orphan stored data
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("taxa", { keyPath: "key" });
      d.createObjectStore("organisms", { keyPath: "id", autoIncrement: true });
      d.createObjectStore("images", { keyPath: "id", autoIncrement: true }).createIndex("organism_id", "organism_id");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

// Run fn(stores) inside one transaction; resolves with fn's result once the transaction commits.
// fn must only await IndexedDB requests (no fetch!) or the transaction auto-commits.
async function tx(names, mode, fn) {
  const t = (await db()).transaction(names, mode);
  const done = new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = t.onabort = () => reject(t.error); });
  const stores = Object.fromEntries([names].flat().map((n) => [n, t.objectStore(n)]));
  let result;
  try { result = await fn(stores); }
  catch (e) { try { t.abort(); } catch {} done.catch(() => {}); throw e; }
  await done;
  return result;
}

const getAll = (store, ...a) => req(store.getAll(...a));

export async function requestPersistence() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}

// ---------- helpers ----------

async function taxaMap() {
  return new Map((await tx("taxa", "readonly", (s) => getAll(s.taxa))).map((t) => [t.key, t]));
}

function lineageOf(taxa, key) {
  const out = [];
  for (let t = taxa.get(key); t; t = t.parent_key ? taxa.get(t.parent_key) : null) {
    out.unshift({ key: t.key, name: t.name, rank: t.rank, name_de: t.name_de ?? null, name_en: t.name_en ?? null });
  }
  return out;
}

const urlCache = new Map(); // image id (thumbnails: "t" + id) -> object URL
function imageUrl(img) {
  if (!img) return null;
  if (!urlCache.has(img.id)) urlCache.set(img.id, URL.createObjectURL(img.blob));
  return urlCache.get(img.id);
}
// small version for list, tree and gallery tiles; falls back to the photo until the thumbnail exists
function thumbUrl(img) {
  if (!img?.thumb) return imageUrl(img);
  const k = "t" + img.id;
  if (!urlCache.has(k)) urlCache.set(k, URL.createObjectURL(img.thumb));
  return urlCache.get(k);
}
function forgetUrl(id) {
  for (const k of [id, "t" + id]) {
    const u = urlCache.get(k);
    if (u) URL.revokeObjectURL(u);
    urlCache.delete(k);
  }
}

// Downscale a new photo and make its thumbnail (before the transaction: no awaiting non-IndexedDB work inside one).
async function preparePhoto(blob) {
  const photo = await tryDownscale(blob, PHOTO_MAX);
  return { blob: photo, thumb: await tryDownscale(photo, THUMB_MAX, null) };
}

// Images stored before thumbnails existed (or imported) get one on first use; one job per image.
const thumbJobs = new Map();
function ensureThumbs(imgs) {
  return Promise.all(imgs.filter((i) => !i.thumb).map((i) => {
    if (!thumbJobs.has(i.id)) thumbJobs.set(i.id, (async () => {
      const thumb = await tryDownscale(i.blob, THUMB_MAX, null);
      if (!thumb) return null;
      await tx("images", "readwrite", async (s) => {
        const cur = await req(s.images.get(i.id));
        if (cur && !cur.thumb) s.images.put({ ...cur, thumb });
      });
      return thumb;
    })());
    return thumbJobs.get(i.id).then((thumb) => { if (thumb) i.thumb = thumb; });
  }));
}

// cover image of an organism: the chosen one, else the oldest
const coverOf = (imgs) => imgs.find((i) => i.is_cover) || [...imgs].sort((a, b) => a.id - b.id)[0] || null;

function imagesByOrganism(all) {
  const m = new Map();
  for (const i of all) (m.get(i.organism_id) || m.set(i.organism_id, []).get(i.organism_id)).push(i);
  return m;
}

const imageOut = (i) => ({
  id: i.id, url: imageUrl(i), thumb: thumbUrl(i), source: i.source, is_cover: !!i.is_cover,
  license: i.license, license_url: i.license_url, credit: i.credit, source_url: i.source_url,
});

// ---------- identification ----------

async function resolveLineage(name, fallback) {
  const m = await gbif.match(name);
  if (m) return { lineage: m.lineage, source: "gbif", match_type: m.match_type };
  // anchor Gemini's lineage at its deepest GBIF-known ancestor
  for (let i = fallback.length - 1; i >= 0; i--) {
    const anchor = await gbif.match(fallback[i].name);
    if (anchor && anchor.lineage[anchor.lineage.length - 1].name === fallback[i].name) {
      const rest = fallback.slice(i + 1).map((r) => ({ key: `gem:${r.rank}:${r.name}`, name: r.name, rank: r.rank, name_de: null, name_en: null }));
      return { lineage: [...anchor.lineage, ...rest], source: "gemini", match_type: null };
    }
  }
  throw new Error(tr("err.noTaxonomy", name));
}

// names: { common_name_de, common_name_en }
async function proposal(name, names, { lineage, source, match_type }, ident = null) {
  const leaf = lineage[lineage.length - 1];
  const orgs = await tx("organisms", "readonly", (s) => getAll(s.organisms));
  return {
    scientific_name: source === "gbif" ? leaf.name : name,
    common_name_de: names.common_name_de || "",
    common_name_en: names.common_name_en || "",
    rank: leaf.rank,
    lineage,
    source,
    gbif_match_type: match_type,
    confidence: ident?.confidence ?? null,
    reasoning: ident?.reasoning ?? null,
    alternatives: ident?.alternatives ?? [],
    gemini: ident,
    duplicates: orgs.filter((o) => o.taxon_key === leaf.key).map((o) => ({ id: o.id, label: labelOf(o) })),
  };
}

export async function identify(text, imageBlob, onStep = () => {}) {
  if (!text && !imageBlob) throw new Error(tr("needInput"));
  onStep("gemini");
  const ident = await gemini.identify(text || null, imageBlob || null);
  onStep("gbif");
  const resolved = await resolveLineage(ident.scientific_name, ident.fallback_lineage || []);
  return proposal(ident.scientific_name, ident, resolved, ident);
}

// GBIF-only lookup, used when picking an alternative or correcting the name
export async function lookup(name, names = {}) {
  const resolved = await resolveLineage(name, []);
  const sci = resolved.lineage[resolved.lineage.length - 1].name;
  return proposal(name, { common_name_de: names.common_name_de || sci, common_name_en: names.common_name_en || sci }, resolved);
}

// ---------- organisms ----------

export async function createOrganism({ proposal: p, inputText, label, imageBlob }) {
  const lineage = p.lineage.map((t) => ({ ...t }));
  const photo = imageBlob ? await preparePhoto(imageBlob) : null;
  // label in both languages: Gemini's common names, unless the user typed their own one
  // (then the other language stays empty until "translate collection" fills it in)
  const labels = { de: p.common_name_de || null, en: p.common_name_en || null };
  label = (label || "").trim();
  if (label && label !== labels[lang]) { labels[lang] = label; labels[otherLang()] = null; }
  labels[lang] ||= lineage[lineage.length - 1].name;

  // common names for taxa that are new or still lack one ("" = looked up, there is none)
  const known = await taxaMap();
  const missing = lineage.filter((t) => !t.key.startsWith("dom:") && (known.get(t.key)?.name_de == null || known.get(t.key)?.name_en == null));
  let names = null;
  try { names = await gemini.commonNames(missing.map((t) => [t.rank, t.name])); }
  catch (e) { console.warn("Common names lookup failed", e); }
  const nameFor = (t, l) => t.key.startsWith("dom:") ? DOMAIN_NAMES[t.name]?.[l] ?? null
    : names ? names[t.name]?.[l] ?? "" : null;

  return tx(["taxa", "organisms", "images"], "readwrite", async (s) => {
    let parent = null;
    for (const t of lineage) {
      const old = await req(s.taxa.get(t.key));
      s.taxa.put({
        description: null, features: null, description_en: null, features_en: null, ...old,
        key: t.key, name: t.name, rank: t.rank, parent_key: parent,
        name_de: old?.name_de || nameFor(t, "de") || (old?.name_de ?? null),
        name_en: old?.name_en || nameFor(t, "en") || (old?.name_en ?? null),
        source: t.key.startsWith("dom:") ? "domain" : old?.source || p.source,
      });
      parent = t.key;
    }
    const id = await req(s.organisms.add({
      input_text: inputText || null,
      taxon_key: lineage[lineage.length - 1].key,
      label_de: labels.de,
      label_en: labels.en,
      notes: null,
      gemini: p.gemini || null,
      created_at: new Date().toISOString(),
    }));
    if (photo) s.images.add(newImage(id, photo, { source: "upload", is_cover: 1 }));
    return id;
  });
}

const newImage = (organism_id, { blob, thumb }, meta) => ({
  organism_id, blob, thumb, source: meta.source, is_cover: meta.is_cover ? 1 : 0,
  license: meta.license ?? null, license_url: meta.license_url ?? null,
  credit: meta.credit ?? null, source_url: meta.source_url ?? null,
  created_at: new Date().toISOString(),
});

export async function listOrganisms() {
  const [orgs, taxa, imgs] = await Promise.all([
    tx("organisms", "readonly", (s) => getAll(s.organisms)),
    taxaMap(),
    tx("images", "readonly", (s) => getAll(s.images)),
  ]);
  const byOrg = imagesByOrganism(imgs);
  const covers = new Map(orgs.map((o) => [o.id, coverOf(byOrg.get(o.id) || [])]));
  await ensureThumbs([...covers.values()].filter(Boolean));
  return orgs
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .map((o) => {
      const t = taxa.get(o.taxon_key);
      return {
        id: o.id, label: labelOf(o), scientific_name: t?.name, rank: t?.rank,
        image: thumbUrl(covers.get(o.id)), created_at: o.created_at,
        lineage: lineageOf(taxa, o.taxon_key),
      };
    });
}

export async function getOrganism(id) {
  const [o, imgs, taxa] = await Promise.all([
    tx("organisms", "readonly", (s) => req(s.organisms.get(id))),
    tx("images", "readonly", (s) => req(s.images.index("organism_id").getAll(id))),
    taxaMap(),
  ]);
  if (!o) throw new Error(tr("err.notFound"));
  const t = taxa.get(o.taxon_key);
  imgs.sort((a, b) => b.is_cover - a.is_cover || a.id - b.id);
  await ensureThumbs(imgs);
  return {
    id: o.id, label: labelOf(o), scientific_name: t?.name, rank: t?.rank, taxon_key: o.taxon_key,
    image: imageUrl(coverOf(imgs)), images: imgs.map(imageOut),
    input_text: o.input_text, notes: o.notes, created_at: o.created_at, gemini: o.gemini,
    lineage: lineageOf(taxa, o.taxon_key),
  };
}

export async function updateOrganism(id, patch) {
  await tx("organisms", "readwrite", async (s) => {
    const o = await req(s.organisms.get(id));
    if (!o) return;
    if ("label" in patch) o[lang === "en" ? "label_en" : "label_de"] = patch.label;
    if ("notes" in patch) o.notes = patch.notes;
    s.organisms.put(o);
  });
}

export async function deleteOrganism(id) {
  await tx(["organisms", "images"], "readwrite", async (s) => {
    const keys = await req(s.images.index("organism_id").getAllKeys(id));
    for (const k of keys) { s.images.delete(k); forgetUrl(k); }
    s.organisms.delete(id);
  });
}

// ---------- images ----------

async function addImage(organismId, blob, meta) {
  const photo = await preparePhoto(blob);
  return tx("images", "readwrite", async (s) => {
    const existing = await req(s.images.index("organism_id").getAll(organismId));
    return req(s.images.add(newImage(organismId, photo, { ...meta, is_cover: !existing.some((i) => i.is_cover) })));
  });
}

export async function addImages(organismId, files) {
  for (const f of files) await addImage(organismId, f, { source: "upload" });
}

export async function deleteImage(id) {
  await tx("images", "readwrite", async (s) => {
    const img = await req(s.images.get(id));
    if (!img) return;
    s.images.delete(id);
    forgetUrl(id);
    if (img.is_cover) { // promote the next one
      const rest = (await req(s.images.index("organism_id").getAll(img.organism_id))).filter((i) => i.id !== id);
      rest.sort((a, b) => a.id - b.id);
      if (rest[0]) s.images.put({ ...rest[0], is_cover: 1 });
    }
  });
}

export async function setCover(id) {
  await tx("images", "readwrite", async (s) => {
    const img = await req(s.images.get(id));
    if (!img) return;
    for (const i of await req(s.images.index("organism_id").getAll(img.organism_id))) {
      s.images.put({ ...i, is_cover: i.id === id ? 1 : 0 });
    }
  });
}

// Freely licensed photos from iNaturalist + Commons, judged by Gemini (best first).
export async function imageCandidates(organismId) {
  const o = await getOrganism(organismId);
  const have = new Set(o.images.map((i) => i.source_url));
  let cands = (await images.candidates(o.scientific_name)).filter((c) => !have.has(c.page_url));
  if (!cands.length) return { candidates: [], ranked: false };

  const thumbs = await Promise.all(cands.map((c) => images.fetchImage(c.thumb).catch(() => null)));
  cands = cands.filter((_, i) => thumbs[i]);
  const blobs = thumbs.filter(Boolean);
  let verdicts;
  try { verdicts = new Map((await gemini.rankImages(o.scientific_name, o.label, blobs)).map((v) => [v.index, v])); }
  catch (e) { console.warn("Gemini image ranking failed", e); return { candidates: cands, ranked: false }; }

  cands.forEach((c, i) => {
    const v = verdicts.get(i);
    Object.assign(c, { fits: v ? v.shows_organism : null, quality: v?.quality ?? null, note: v?.note ?? null });
  });
  const good = cands.filter((c) => c.fits).sort((a, b) => (b.quality || 0) - (a.quality || 0));
  if (good[0]) good[0].recommended = true;
  return { candidates: [...good, ...cands.filter((c) => !c.fits)], ranked: true };
}

export async function addRemoteImage(organismId, c) {
  const blob = await images.fetchImage(c.url);
  return addImage(organismId, blob, { source: c.source, license: c.license, license_url: c.license_url, credit: c.credit, source_url: c.page_url });
}

// ---------- taxa & tree ----------

// German description keeps the old field names (description, features), English sits next to it
const withInfo = (t, l, d) => l === "en"
  ? { ...t, description_en: d.description, features_en: d.features }
  : { ...t, description: d.description, features: d.features };

// Taxon details; the description is generated by Gemini on first request (in both languages) and cached.
// If only the other language is there, it is translated.
export async function getTaxon(key) {
  let taxa = await taxaMap();
  let t = taxa.get(key);
  if (!t) throw new Error(tr("err.notFound"));
  if (taxonInfo(t).description == null) {
    const other = otherLang();
    const there = other === "en"
      ? { description: t.description_en, features: t.features_en } : { description: t.description, features: t.features };
    if (there.description) {
      const [d] = await gemini.translateDescriptions([{ name: t.name, ...there }], other, lang);
      t = withInfo(t, lang, { description: d.description, features: d.features || [] });
    } else {
      const info = await gemini.describeTaxon(t.rank, t.name, lineageOf(taxa, key).map((x) => x.name));
      t = withInfo(withInfo(t, "de", { description: info.description_de, features: info.features_de }),
        "en", { description: info.description_en, features: info.features_en });
      t.name_de ||= info.name_de || t.name_de || null;
      t.name_en ||= info.name_en || t.name_en || null;
    }
    const fresh = t;
    await tx("taxa", "readwrite", async (s) => {
      // write only the generated fields, the taxon may have changed meanwhile
      const cur = await req(s.taxa.get(key));
      if (cur) s.taxa.put({ ...cur, name_de: cur.name_de || fresh.name_de, name_en: cur.name_en || fresh.name_en,
        description: cur.description ?? fresh.description ?? null, features: cur.features ?? fresh.features ?? null,
        description_en: cur.description_en ?? fresh.description_en ?? null, features_en: cur.features_en ?? fresh.features_en ?? null });
    });
    taxa.set(key, t);
  }
  const orgs = await listOrganisms();
  const info = taxonInfo(t);
  return {
    key: t.key, name: t.name, rank: t.rank, name_de: t.name_de, name_en: t.name_en ?? null,
    description: info.description, features: info.features || [], source: t.source,
    lineage: lineageOf(taxa, key).slice(0, -1),
    organisms: orgs.filter((o) => o.lineage.some((x) => x.key === key)).map((o) => ({ id: o.id, label: o.label, image: o.image })),
  };
}

export async function getTree() {
  const orgs = await listOrganisms();
  return buildTree(orgs.map((o) => ({ id: o.id, label: o.label, lineage: o.lineage, image: o.image })));
}

// ---------- export / import ----------

const FORMAT = "tree-of-life"; // internal id, kept so older exports still import

export async function exportData() {
  const [taxa, organisms, imgs] = await tx(["taxa", "organisms", "images"], "readonly", (s) =>
    Promise.all([getAll(s.taxa), getAll(s.organisms), getAll(s.images)]));
  const imagesOut = [];
  for (const i of imgs) {
    const { blob, thumb: _t, ...meta } = i; // thumbnails are rebuilt after import
    imagesOut.push({ ...meta, mime: blob.type || "image/jpeg", data: await gemini.blobToBase64(blob) });
  }
  const json = JSON.stringify({ format: FORMAT, version: 1, exported_at: new Date().toISOString(), taxa, organisms, images: imagesOut });
  return new Blob([json], { type: "application/json" });
}

const base64ToBlob = (b64, mime) => {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

// fill an empty value from another source; "" (= known to be empty) loses against a real value, wins against null
const fill = (a, b) => a || b || (a ?? b ?? null);

// the same organism in another copy of the collection: same creation time and taxon, else same taxon and label
function findSame(existing, o) {
  return existing.find((e) => e.created_at === o.created_at && e.taxon_key === o.taxon_key)
    || existing.find((e) => e.taxon_key === o.taxon_key && e.label_de && e.label_de === o.label_de);
}

// copy missing labels and Gemini texts (e.g. translations) from an imported organism onto a stored one
function mergeOrganism(old, o) {
  const g = old.gemini, h = o.gemini;
  return {
    ...old,
    label_de: fill(old.label_de, o.label_de),
    label_en: fill(old.label_en, o.label_en),
    notes: old.notes || o.notes || null,
    gemini: g && h ? {
      ...g,
      reasoning: fill(g.reasoning, h.reasoning),
      reasoning_en: fill(g.reasoning_en, h.reasoning_en),
      common_name_en: fill(g.common_name_en, h.common_name_en),
      alternatives: (g.alternatives || []).map((a) => {
        const b = (h.alternatives || []).find((x) => x.scientific_name === a.scientific_name) || {};
        return { ...a, common_name_de: fill(a.common_name_de, b.common_name_de), common_name_en: fill(a.common_name_en, b.common_name_en) };
      }),
    } : g || h || null,
  };
}

// Merge an export into the current collection: taxa are shared, organisms already there get missing
// fields filled in, new organisms are added with their images.
// A translations file (kind: "translations") only fills in fields of taxa and organisms that already exist.
export async function importData(data) {
  if (data?.format !== FORMAT) throw new Error(tr("err.notExport"));
  const onlyUpdate = data.kind === "translations";
  const imgBlobs = (data.images || []).map((i) => base64ToBlob(i.data, i.mime));
  return tx(["taxa", "organisms", "images"], "readwrite", async (s) => {
    for (const t of data.taxa || []) {
      const old = await req(s.taxa.get(t.key));
      if (!old && onlyUpdate) continue;
      s.taxa.put(old ? {
        ...old,
        name_de: fill(old.name_de, t.name_de),
        name_en: fill(old.name_en, t.name_en),
        description: old.description ?? t.description ?? null,
        features: old.features ?? t.features ?? null,
        description_en: old.description_en ?? t.description_en ?? null,
        features_en: old.features_en ?? t.features_en ?? null,
      } : t);
    }
    const existing = await getAll(s.organisms);
    const idMap = new Map();
    let updated = 0;
    for (const o of data.organisms || []) {
      const { id, ...rest } = o;
      const same = findSame(existing, rest);
      if (same) { s.organisms.put(mergeOrganism(same, rest)); updated++; }
      else if (!onlyUpdate) idMap.set(id, await req(s.organisms.add(rest)));
    }
    let n = 0;
    for (const [k, i] of (data.images || []).entries()) {
      const oid = idMap.get(i.organism_id);
      if (oid == null) continue;
      const { id, data: _d, mime: _m, ...meta } = i;
      s.images.add({ ...meta, organism_id: oid, blob: imgBlobs[k] });
      n++;
    }
    return { organisms: idMap.size, images: n, updated, taxa: (data.taxa || []).length };
  });
}

// ---------- translation ----------

const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// Fill in missing names, labels and (optionally) descriptions in both languages with Gemini.
// onStep(text) reports progress.
export async function translateCollection({ descriptions = true, onStep = () => {} } = {}) {
  let names = 0, texts = 0;
  const patchTaxa = (patches) => tx("taxa", "readwrite", async (s) => {
    for (const [key, p] of patches) {
      const cur = await req(s.taxa.get(key));
      if (cur) s.taxa.put({ ...cur, ...p(cur) });
    }
  });

  // common names of taxa
  const taxa = [...(await taxaMap()).values()];
  const noName = taxa.filter((t) => t.name_de == null || t.name_en == null);
  for (const batch of chunks(noName.filter((t) => !t.key.startsWith("dom:")), 40)) {
    onStep(tr("translating", tr("tr.names")));
    const got = await gemini.commonNames(batch.map((t) => [t.rank, t.name]));
    await patchTaxa(batch.map((t) => [t.key, (cur) => ({
      name_de: fill(cur.name_de, got[t.name]?.de ?? ""), name_en: fill(cur.name_en, got[t.name]?.en ?? ""),
    })]));
    names += batch.length;
  }
  await patchTaxa(noName.filter((t) => t.key.startsWith("dom:")).map((t) => [t.key, (cur) => ({
    name_de: fill(cur.name_de, DOMAIN_NAMES[t.name]?.de), name_en: fill(cur.name_en, DOMAIN_NAMES[t.name]?.en),
  })]));

  // descriptions that exist in one language only
  if (descriptions) {
    for (const [from, to] of [["de", "en"], ["en", "de"]]) {
      const src = (t) => (from === "en" ? { description: t.description_en, features: t.features_en } : { description: t.description, features: t.features });
      const todo = taxa.filter((t) => src(t).description && taxonInfoIn(t, to).description == null);
      for (const batch of chunks(todo, 6)) {
        onStep(tr("translating", tr("tr.descriptions", `${texts + 1}–${texts + batch.length}`)));
        const got = await gemini.translateDescriptions(batch.map((t) => ({ name: t.name, ...src(t) })), from, to);
        await patchTaxa(batch.map((t) => [t.key, (cur) => {
          const d = got.find((x) => x.name === t.name);
          return d && taxonInfoIn(cur, to).description == null ? withInfo({}, to, { description: d.description, features: d.features || [] }) : {};
        }]));
        texts += batch.length;
      }
    }
  }

  // organism labels, Gemini's reasoning and alternative names
  const orgs = await tx("organisms", "readonly", (s) => getAll(s.organisms));
  for (const [from, to] of [["de", "en"], ["en", "de"]]) {
    const label = (o, l) => o[`label_${l}`];
    const reason = (g, l) => (l === "de" ? g?.reasoning : g?.reasoning_en);
    const todo = orgs.filter((o) => label(o, from) && (!label(o, to) || (reason(o.gemini, from) && !reason(o.gemini, to))));
    for (const batch of chunks(todo, 20)) {
      onStep(tr("translating", tr("tr.labels")));
      const sci = await taxaMap();
      const got = await gemini.translateOrganisms(batch.map((o) => ({
        id: o.id, scientific_name: sci.get(o.taxon_key)?.name || "", label: label(o, from),
        reasoning: reason(o.gemini, from) || "",
        alternatives: (o.gemini?.alternatives || []).map((a) => a[`common_name_${from}`] || ""),
      })), from, to);
      await tx("organisms", "readwrite", async (s) => {
        for (const r of got) {
          const cur = await req(s.organisms.get(r.id));
          if (!cur) continue;
          cur[`label_${to}`] ||= r.label || null;
          if (cur.gemini) {
            const key = to === "de" ? "reasoning" : "reasoning_en";
            cur.gemini[key] ||= r.reasoning || null;
            (cur.gemini.alternatives || []).forEach((a, i) => { a[`common_name_${to}`] ||= r.alternatives?.[i] || ""; });
          }
          s.organisms.put(cur);
          names++;
        }
      });
    }
  }
  return { names, descriptions: texts };
}

const taxonInfoIn = (t, l) => (l === "en" ? { description: t.description_en ?? null } : { description: t.description ?? null });

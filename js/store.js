// Browser-side data layer: IndexedDB storage + the logic the Python backend used to do.

import * as gbif from "./gbif.js";
import * as gemini from "./gemini.js";
import * as images from "./images.js";
import { buildTree } from "./tree.js";

const DOMAIN_DE = { Eukaryota: "Eukaryoten", Bacteria: "Bakterien", Archaea: "Archaeen", Viruses: "Viren" };

// ---------- IndexedDB plumbing ----------

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("tree-of-life", 1);
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
    out.unshift({ key: t.key, name: t.name, rank: t.rank, name_de: t.name_de ?? null });
  }
  return out;
}

const urlCache = new Map(); // image id -> object URL
function imageUrl(img) {
  if (!img) return null;
  if (!urlCache.has(img.id)) urlCache.set(img.id, URL.createObjectURL(img.blob));
  return urlCache.get(img.id);
}
function forgetUrl(id) {
  const u = urlCache.get(id);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(id);
}

// cover image of an organism: the chosen one, else the oldest
const coverOf = (imgs) => imgs.find((i) => i.is_cover) || [...imgs].sort((a, b) => a.id - b.id)[0] || null;

function imagesByOrganism(all) {
  const m = new Map();
  for (const i of all) (m.get(i.organism_id) || m.set(i.organism_id, []).get(i.organism_id)).push(i);
  return m;
}

const imageOut = (i) => ({
  id: i.id, url: imageUrl(i), source: i.source, is_cover: !!i.is_cover,
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
      const rest = fallback.slice(i + 1).map((r) => ({ key: `gem:${r.rank}:${r.name}`, name: r.name, rank: r.rank, name_de: null }));
      return { lineage: [...anchor.lineage, ...rest], source: "gemini", match_type: null };
    }
  }
  throw new Error(`Keine Taxonomie für „${name}“ gefunden`);
}

async function proposal(name, commonDe, { lineage, source, match_type }, ident = null) {
  const leaf = lineage[lineage.length - 1];
  const orgs = await tx("organisms", "readonly", (s) => getAll(s.organisms));
  return {
    scientific_name: source === "gbif" ? leaf.name : name,
    common_name_de: commonDe,
    rank: leaf.rank,
    lineage,
    source,
    gbif_match_type: match_type,
    confidence: ident?.confidence ?? null,
    reasoning: ident?.reasoning ?? null,
    alternatives: ident?.alternatives ?? [],
    gemini: ident,
    duplicates: orgs.filter((o) => o.taxon_key === leaf.key).map((o) => ({ id: o.id, label: o.label_de })),
  };
}

export async function identify(text, imageBlob) {
  if (!text && !imageBlob) throw new Error("Text oder Bild angeben");
  const ident = await gemini.identify(text || null, imageBlob || null);
  const resolved = await resolveLineage(ident.scientific_name, ident.fallback_lineage || []);
  return proposal(ident.scientific_name, ident.common_name_de, resolved, ident);
}

// GBIF-only lookup, used when picking an alternative or correcting the name
export async function lookup(name, commonDe = "") {
  const resolved = await resolveLineage(name, []);
  return proposal(name, commonDe || resolved.lineage[resolved.lineage.length - 1].name, resolved);
}

// ---------- organisms ----------

export async function createOrganism({ proposal: p, inputText, label, imageBlob }) {
  const lineage = p.lineage.map((t) => ({ ...t }));
  label = (label || "").trim() || p.common_name_de || lineage[lineage.length - 1].name;

  // German names for taxa that are new or still lack one
  const known = await taxaMap();
  const missing = lineage.filter((t) => !t.key.startsWith("dom:") && !known.get(t.key)?.name_de);
  let names = {};
  try { names = await gemini.germanNames(missing.map((t) => [t.rank, t.name])); }
  catch (e) { console.warn("German names lookup failed", e); }

  return tx(["taxa", "organisms", "images"], "readwrite", async (s) => {
    let parent = null;
    for (const t of lineage) {
      const old = await req(s.taxa.get(t.key));
      const name_de = old?.name_de || (t.key.startsWith("dom:") ? DOMAIN_DE[t.name] : names[t.name]) || null;
      s.taxa.put({
        description: null, features: null, ...old,
        key: t.key, name: t.name, rank: t.rank, parent_key: parent, name_de,
        source: t.key.startsWith("dom:") ? "domain" : old?.source || p.source,
      });
      parent = t.key;
    }
    const id = await req(s.organisms.add({
      input_text: inputText || null,
      taxon_key: lineage[lineage.length - 1].key,
      label_de: label,
      notes: null,
      gemini: p.gemini || null,
      created_at: new Date().toISOString(),
    }));
    if (imageBlob) s.images.add(newImage(id, imageBlob, { source: "upload", is_cover: 1 }));
    return id;
  });
}

const newImage = (organism_id, blob, meta) => ({
  organism_id, blob, source: meta.source, is_cover: meta.is_cover ? 1 : 0,
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
  return orgs
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .map((o) => {
      const t = taxa.get(o.taxon_key);
      return {
        id: o.id, label: o.label_de, scientific_name: t?.name, rank: t?.rank,
        image: imageUrl(coverOf(byOrg.get(o.id) || [])), created_at: o.created_at,
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
  if (!o) throw new Error("Nicht gefunden");
  const t = taxa.get(o.taxon_key);
  imgs.sort((a, b) => b.is_cover - a.is_cover || a.id - b.id);
  return {
    id: o.id, label: o.label_de, scientific_name: t?.name, rank: t?.rank, taxon_key: o.taxon_key,
    image: imageUrl(coverOf(imgs)), images: imgs.map(imageOut),
    input_text: o.input_text, notes: o.notes, created_at: o.created_at, gemini: o.gemini,
    lineage: lineageOf(taxa, o.taxon_key),
  };
}

export async function updateOrganism(id, patch) {
  await tx("organisms", "readwrite", async (s) => {
    const o = await req(s.organisms.get(id));
    if (!o) return;
    if ("label" in patch) o.label_de = patch.label;
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
  return tx("images", "readwrite", async (s) => {
    const existing = await req(s.images.index("organism_id").getAll(organismId));
    return req(s.images.add(newImage(organismId, blob, { ...meta, is_cover: !existing.some((i) => i.is_cover) })));
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

// Taxon details; the description is generated by Gemini on first request and cached.
export async function getTaxon(key) {
  let taxa = await taxaMap();
  let t = taxa.get(key);
  if (!t) throw new Error("Nicht gefunden");
  if (t.description == null) {
    const info = await gemini.describeTaxon(t.rank, t.name, lineageOf(taxa, key).map((x) => x.name));
    t = { ...t, name_de: t.name_de || info.name_de || null, description: info.description, features: info.features };
    await tx("taxa", "readwrite", (s) => { s.taxa.put(t); });
    taxa.set(key, t);
  }
  const orgs = await listOrganisms();
  return {
    key: t.key, name: t.name, rank: t.rank, name_de: t.name_de, description: t.description,
    features: t.features || [], source: t.source,
    lineage: lineageOf(taxa, key).slice(0, -1),
    organisms: orgs.filter((o) => o.lineage.some((x) => x.key === key)).map((o) => ({ id: o.id, label: o.label, image: o.image })),
  };
}

export async function getTree() {
  const orgs = await listOrganisms();
  return buildTree(orgs.map((o) => ({ id: o.id, label: o.label, lineage: o.lineage, image: o.image })));
}

// ---------- export / import ----------

const FORMAT = "tree-of-life";

export async function exportData() {
  const [taxa, organisms, imgs] = await tx(["taxa", "organisms", "images"], "readonly", (s) =>
    Promise.all([getAll(s.taxa), getAll(s.organisms), getAll(s.images)]));
  const imagesOut = [];
  for (const i of imgs) {
    const { blob, ...meta } = i;
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

// Merge an export into the current collection (taxa are shared, organisms/images are added).
export async function importData(data) {
  if (data?.format !== FORMAT) throw new Error("Keine Tree-of-Life-Exportdatei");
  const imgBlobs = (data.images || []).map((i) => base64ToBlob(i.data, i.mime));
  return tx(["taxa", "organisms", "images"], "readwrite", async (s) => {
    for (const t of data.taxa || []) {
      const old = await req(s.taxa.get(t.key));
      s.taxa.put(old ? {
        ...old,
        name_de: old.name_de || t.name_de || null,
        description: old.description ?? t.description ?? null,
        features: old.features ?? t.features ?? null,
      } : t);
    }
    const idMap = new Map();
    for (const o of data.organisms || []) {
      const { id, ...rest } = o;
      idMap.set(id, await req(s.organisms.add(rest)));
    }
    let n = 0;
    for (const [k, i] of (data.images || []).entries()) {
      const oid = idMap.get(i.organism_id);
      if (oid == null) continue;
      const { id, data: _d, mime: _m, ...meta } = i;
      s.images.add({ ...meta, organism_id: oid, blob: imgBlobs[k] });
      n++;
    }
    return { organisms: idMap.size, images: n, taxa: (data.taxa || []).length };
  });
}

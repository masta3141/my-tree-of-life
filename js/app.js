import * as store from "./store.js?v=7";
import { settings, saveSettings, DEFAULT_MODEL } from "./settings.js?v=7";
import { t, lang, setLang, rankName, taxonName, reasoningOf, commonNameOf } from "./i18n.js?v=7";

const $ = (id) => document.getElementById(id);
let imageFile = null;
let current = null; // current proposal

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function busy(btn, on, label) {
  btn.disabled = on;
  if (label) btn.innerHTML = on ? '<span class="spinner"></span>' : esc(label);
}

// spinner + text; slow requests also show elapsed seconds (see ticker below)
const loadingHtml = (text) =>
  `<div class="status"><span class="spinner"></span><span>${esc(text)}</span><span class="sec" data-t0="${Date.now()}"></span></div>`;
setInterval(() => document.querySelectorAll(".sec[data-t0]").forEach((el) => {
  const sec = Math.floor((Date.now() - el.dataset.t0) / 1000);
  el.textContent = sec >= 2 ? `${sec} s` : "";
}), 1000);

// progress line under the input
function status(text) {
  $("status").hidden = !text;
  $("status").innerHTML = text ? loadingHtml(text) : "";
  $("drop").classList.toggle("busy", !!text);
}

// ---------- language ----------
const FLAGS = {
  de: `<svg viewBox="0 0 5 3"><rect width="5" height="1" fill="#000"/><rect y="1" width="5" height="1" fill="#d00"/><rect y="2" width="5" height="1" fill="#ffce00"/></svg>`,
  en: `<svg viewBox="0 0 60 30"><clipPath id="ukT"><path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z"/></clipPath>
    <rect width="60" height="30" fill="#012169"/><path d="M0,0L60,30M60,0L0,30" stroke="#fff" stroke-width="6"/>
    <path d="M0,0L60,30M60,0L0,30" clip-path="url(#ukT)" stroke="#c8102e" stroke-width="4"/>
    <path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10"/><path d="M30,0v30M0,15h60" stroke="#c8102e" stroke-width="6"/></svg>`,
};
const otherLang = () => (lang === "de" ? "en" : "de");

// static texts in index.html carry data-i18n (text), data-i18n-html, data-i18n-title, data-i18n-placeholder
function applyStatic() {
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-html]").forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  document.querySelectorAll("[data-i18n-title]").forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
  document.querySelector('meta[name="description"]').content = t("meta.description");
  // the flag shows the language you switch to
  $("btnLang").innerHTML = FLAGS[otherLang()];
  $("btnLang").title = t("lang.switch");
}

$("btnLang").onclick = async () => {
  setLang(otherLang());
  applyStatic();
  if (current) showProposal(current);
  const open = detailOf;
  await refresh();
  if (open?.startsWith("o")) showOrganism(+open.slice(1));
  else if (open?.startsWith("t")) showTaxon(open.slice(1));
  // fill in missing names quietly in the background (descriptions follow when opened)
  if (settings().apiKey) {
    store.translateCollection({ descriptions: false })
      .then((r) => { if (r.names) refresh(); })
      .catch((e) => console.warn("Background translation failed", e));
  }
};

// ---------- settings ----------
function renderSettingsState() {
  $("noKey").hidden = !!settings().apiKey;
}
$("btnSettings").onclick = () => {
  const s = settings();
  $("setKey").value = s.apiKey;
  $("setModel").value = s.model;
  $("settings").hidden = !$("settings").hidden;
};
$("btnCloseSettings").onclick = () => ($("settings").hidden = true);
$("btnSaveSettings").onclick = () => {
  saveSettings({ apiKey: $("setKey").value.trim(), model: $("setModel").value.trim() || DEFAULT_MODEL });
  $("settings").hidden = true;
  renderSettingsState();
};

$("btnTranslate").onclick = async () => {
  const btn = $("btnTranslate");
  btn.disabled = true;
  try {
    const r = await store.translateCollection({ onStep: (m) => ($("trState").innerHTML = loadingHtml(m)) });
    $("trState").textContent = r.names || r.descriptions ? t("translated", r.names, r.descriptions) : t("nothingToTranslate");
    refresh();
  } catch (e) { $("trState").textContent = t("error", e.message); }
  finally { btn.disabled = false; }
};

// ---------- input ----------
const drop = $("drop");
function setImage(f) {
  imageFile = f;
  $("thumb").hidden = !f;
  if (f) $("thumbImg").src = URL.createObjectURL(f);
  else $("file").value = "";
}
$("btnClearImg").onclick = () => setImage(null);
$("file").addEventListener("change", (e) => setImage(e.target.files[0] || null));
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault(); drop.classList.remove("over");
  const f = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
  if (f) setImage(f);
});
document.addEventListener("paste", (e) => {
  const f = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
  if (f) setImage(f);
});
const autoGrow = () => { const t = $("text"); t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; };
$("text").addEventListener("input", autoGrow);
$("text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); identify(); }
});

async function identify() {
  if ($("btnIdentify").disabled) return;
  $("error").textContent = "";
  const text = $("text").value.trim();
  if (!text && !imageFile) { $("error").textContent = t("needInput"); return; }
  busy($("btnIdentify"), true, "➜");
  try { showProposal(await store.identify(text, imageFile, (k) => status(t("step." + k)))); }
  catch (e) { $("error").textContent = e.message; }
  finally { busy($("btnIdentify"), false, "➜"); status(null); }
}
$("btnIdentify").onclick = identify;

async function lookup(name, names) {
  $("error").textContent = "";
  status(t("step.gbif"));
  try {
    const p = await store.lookup(name, names);
    p.gemini = current?.gemini; // keep original identification for the record
    p.alternatives = current?.alternatives || [];
    showProposal(p);
  } catch (e) { $("error").textContent = e.message; }
  finally { status(null); }
}

function showProposal(p) {
  current = p;
  const conf = p.confidence != null ? `${Math.round(p.confidence * 100)} %` : "";
  const lin = p.lineage.map((t) => esc(t.name)).join(" › ");
  const alts = (p.alternatives || []).filter((a) => a.scientific_name !== p.scientific_name);
  const reasoning = reasoningOf(p.gemini);
  // keep what the user typed into the label when re-rendering (language switch)
  const typed = $("label")?.value;
  $("proposal").innerHTML = `
    <div class="card">
      <div class="small muted">${t("proposal")} ${conf ? "· " + conf : ""} · ${esc(rankName(p.rank))} · ${t("source")}: ${p.source === "gbif" ? "GBIF" : t("source.gemini")}</div>
      <input type="text" id="label" value="${esc(commonNameOf(p))}" style="margin-top:6px;font-weight:600">
      <div class="sci" style="margin-top:4px">${esc(p.scientific_name)}</div>
      ${reasoning ? `<div class="small muted" style="margin-top:4px">${esc(reasoning)}</div>` : ""}
      <div class="lineage">${lin}</div>
      ${p.duplicates.length ? `<div class="small warn" style="margin-top:6px">${esc(t("already", p.duplicates.map((d) => d.label).join(", ")))}</div>` : ""}
      ${alts.length ? `<div class="small muted" style="margin-top:10px">${t("orMaybe")}</div>
        <div class="row alts">${alts.map((a, i) => `<button data-alt="${i}">${esc(commonNameOf(a))} <i>${esc(a.scientific_name)}</i></button>`).join("")}</div>` : ""}
      <div class="row" style="margin-top:8px">
        <input type="text" id="correct" placeholder="${esc(t("otherName"))}" style="flex:1">
        <button id="btnCorrect">${t("check")}</button>
      </div>
      <div class="row"><button class="primary" id="btnSave">${t("save")}</button><button id="btnDiscard">${t("discard")}</button></div>
    </div>`;
  if (typed && ![p.common_name_de, p.common_name_en].includes(typed)) $("label").value = typed;
  $("proposal").querySelectorAll("[data-alt]").forEach((b) => {
    b.onclick = () => { const a = alts[+b.dataset.alt]; lookup(a.scientific_name, a); };
  });
  $("btnCorrect").onclick = () => { const v = $("correct").value.trim(); if (v) lookup(v); };
  $("btnDiscard").onclick = () => { $("proposal").innerHTML = ""; current = null; };
  $("btnSave").onclick = save;
}

async function save() {
  busy($("btnSave"), true, t("save"));
  status(t("step.save"));
  try {
    await store.createOrganism({
      proposal: current, inputText: $("text").value.trim(), label: $("label").value.trim(), imageBlob: imageFile,
    });
    $("proposal").innerHTML = ""; current = null;
    $("text").value = ""; autoGrow(); setImage(null);
    store.requestPersistence();
    await refresh();
  } catch (e) { $("error").textContent = e.message; busy($("btnSave"), false, t("save")); }
  finally { status(null); }
}

// ---------- list ----------
async function refreshList() {
  const items = await store.listOrganisms();
  $("count").textContent = items.length ? `(${items.length})` : "";
  $("list").innerHTML = items.map((o) => `
    <li class="clickable" data-open="${o.id}">
      ${o.image ? `<img src="${esc(o.image)}" alt="">` : `<span class="ph"></span>`}
      <div class="t"><div>${esc(o.label)}</div><div class="small muted"><i>${esc(o.scientific_name)}</i> · ${esc(rankName(o.rank))}</div></div>
      <button title="${t("delete")}" data-del="${o.id}">✕</button>
    </li>`).join("");
  $("list").querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(t("confirmDelete"))) return;
      await store.deleteOrganism(+b.dataset.del);
      if (detailOf === "o" + b.dataset.del) closeDetail();
      refresh();
    };
  });
  $("list").querySelectorAll("[data-open]").forEach((li) => (li.onclick = () => showOrganism(+li.dataset.open)));
}

// ---------- detail panel ----------
const detail = $("detail");
let detailOf = null; // "o<id>" or "t<key>" – guards against late responses

function closeDetail() { detail.hidden = true; detailOf = null; }
function openDetail(id, html) {
  detailOf = id;
  detail.innerHTML = `<button class="close" title="${t("close")}">✕</button>` + html;
  detail.hidden = false;
  detail.scrollTop = 0;
  detail.querySelector(".close").onclick = closeDetail;
  wireChips(detail);
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!detail.hidden) closeDetail(); else leaveFs(false);
});

function wireChips(root) {
  root.querySelectorAll("[data-taxon]").forEach((c) => (c.onclick = () => showTaxon(c.dataset.taxon)));
  root.querySelectorAll("[data-org]").forEach((c) => (c.onclick = () => showOrganism(+c.dataset.org)));
}

const lineageChips = (lin) => `<div class="chips">${lin.map((x) =>
  `<span class="chip" data-taxon="${esc(x.key)}">${esc(taxonName(x) || x.name)}<span class="r">${esc(rankName(x.rank))}</span></span>`).join("")}</div>`;

function taxonInfoHtml(x) {
  return `${x.description ? `<p>${esc(x.description)}</p>` : `<p class="muted">${t("noDescription")}</p>`}
    ${x.features?.length ? `<h4>${t("features")}</h4><ul>${x.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}`;
}

async function loadTaxonInfo(key, slot, guard) {
  slot.innerHTML = loadingHtml(t("loadingDescription"));
  try {
    const x = await store.getTaxon(key);
    if (detailOf !== guard) return null;
    slot.innerHTML = taxonInfoHtml(x);
    return x;
  } catch (e) {
    if (detailOf === guard) slot.innerHTML = `<p class="err small">${esc(e.message)}</p>`;
    return null;
  }
}

async function showTaxon(key) {
  const id = "t" + key;
  openDetail(id, `<div id="dInfo"></div>`);
  const x = await loadTaxonInfo(key, $("dInfo"), id);
  if (!x) return;
  const common = taxonName(x);
  openDetail(id, `
    <div class="small muted">${esc(rankName(x.rank))}${x.source === "gemini" ? " · " + t("geminiOnly") : ""}</div>
    <h3>${esc(common || x.name)}</h3>
    ${common ? `<div class="sci muted"><i>${esc(x.name)}</i></div>` : ""}
    <h4>${t("description")}</h4>${taxonInfoHtml(x)}
    ${x.lineage.length ? `<h4>${t("lineage")}</h4>${lineageChips(x.lineage)}` : ""}
    <h4>${t("yourOrganisms", x.organisms.length)}</h4>
    <div class="chips">${x.organisms.map((o) => `<span class="chip" data-org="${o.id}">${esc(o.label)}</span>`).join("")}</div>`);
}

async function showOrganism(oid) {
  const id = "o" + oid;
  let o;
  try { o = await store.getOrganism(oid); } catch (e) { $("error").textContent = e.message; return; }
  const g = o.gemini || {};
  const conf = g.confidence != null ? `${Math.round(g.confidence * 100)} %` : null;
  const alts = (g.alternatives || []).filter((a) => a.scientific_name !== o.scientific_name);
  const taxon = o.lineage[o.lineage.length - 1];
  const common = taxon && taxonName(taxon);
  const reasoning = reasoningOf(g);
  const quote = (s) => (lang === "en" ? `“${s}”` : `„${s}“`);
  openDetail(id, `
    <div class="small muted">${esc(rankName(o.rank))} · ${esc(t("recordedOn", o.created_at.slice(0, 10)))}</div>
    <h3>${esc(o.label)}</h3>
    <div class="muted"><i>${esc(o.scientific_name)}</i>${common && common !== o.label ? " · " + esc(common) : ""}</div>
    <div id="dGallery"></div>
    <div class="row"><button id="dFind">${t("findImage")}</button></div>
    <div id="dCands"></div>
    <h4>${t("description")}</h4><div id="dInfo"></div>
    <h4>${t("identification")}</h4>
    ${o.input_text ? `<p><span class="muted">${t("input")}</span> ${esc(quote(o.input_text))}</p>` : `<p class="muted">${t("inputImageOnly")}</p>`}
    ${reasoning ? `<p>${esc(reasoning)}</p>` : ""}
    ${conf ? `<p class="small muted">${t("confidence", conf)}${g.scientific_name && g.scientific_name !== o.scientific_name ? " · " + t("geminiSuggested", `<i>${esc(g.scientific_name)}</i>`) : ""}</p>` : ""}
    ${alts.length ? `<p class="small muted">${t("alternatives", alts.map((a) => `${esc(commonNameOf(a))} (<i>${esc(a.scientific_name)}</i>)`).join(", "))}</p>` : ""}
    <h4>${t("lineage")}</h4>${lineageChips(o.lineage.slice(0, -1))}
    <h4>${t("notes")}</h4>
    <textarea id="dNotes" placeholder="${esc(t("notesPlaceholder"))}">${esc(o.notes || "")}</textarea>
    <div class="small muted" id="dNotesState"></div>`);
  $("dNotes").addEventListener("change", async (e) => {
    await store.updateOrganism(oid, { notes: e.target.value });
    $("dNotesState").textContent = t("saved");
  });
  renderGallery(o);
  $("dFind").onclick = () => findImages(o.id);
  if (taxon) loadTaxonInfo(taxon.key, $("dInfo"), id);
}

// ---------- images of an organism ----------
const creditHtml = (im) => im.source === "upload" ? "" :
  `<div class="credit">${esc(im.credit || "")}${im.license ? " · " + (im.license_url
    ? `<a href="${esc(im.license_url)}" target="_blank" rel="noopener">${esc(im.license)}</a>` : esc(im.license)) : ""}${im.source_url
    ? ` · <a href="${esc(im.source_url)}" target="_blank" rel="noopener">${im.source === "commons" ? "Wikimedia Commons" : "iNaturalist"}</a>` : ""}</div>`;

async function reloadGallery(oid) {
  const o = await store.getOrganism(oid);
  if (detailOf === "o" + oid) renderGallery(o);
  refreshList(); refreshTree();
}

function renderGallery(o) {
  const box = $("dGallery");
  const cover = o.images.find((i) => i.is_cover) || o.images[0];
  box.innerHTML = `
    ${cover ? `<img class="hero" id="dHero" src="${esc(cover.url)}" alt=""><div id="dCredit">${creditHtml(cover)}</div>` : ""}
    <h4>${t("images", o.images.length)}</h4>
    <div class="gallery">
      ${o.images.map((im) => `
        <div class="ph ${im.is_cover ? "cover" : ""}" data-img="${im.id}" title="${im.is_cover ? t("cover") : t("view")}">
          <img src="${esc(im.url)}" alt="" loading="lazy">
          <div class="acts">
            <button data-cover="${im.id}" title="${t("asCover")}">★</button>
            <button data-delimg="${im.id}" title="${t("delete")}">✕</button>
          </div>
        </div>`).join("")}
      <label class="add" id="dAdd" title="${t("addImages")}">+
        <input type="file" id="dFiles" accept="image/*" multiple hidden>
      </label>
    </div>`;

  box.querySelectorAll("[data-img]").forEach((el) => (el.onclick = () => {
    const im = o.images.find((i) => i.id === +el.dataset.img);
    $("dHero").src = im.url;
    $("dCredit").innerHTML = creditHtml(im);
  }));
  box.querySelectorAll("[data-cover]").forEach((b) => (b.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    await store.setCover(+b.dataset.cover);
    reloadGallery(o.id);
  }));
  box.querySelectorAll("[data-delimg]").forEach((b) => (b.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm(t("confirmDeleteImage"))) return;
    await store.deleteImage(+b.dataset.delimg);
    reloadGallery(o.id);
  }));

  const upload = async (files) => {
    files = [...files].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    $("dAdd").firstChild.replaceWith(Object.assign(document.createElement("span"), { className: "spinner" }));
    try { await store.addImages(o.id, files); }
    catch (e) { alert(e.message); }
    reloadGallery(o.id);
  };
  const add = $("dAdd");
  $("dFiles").onchange = (e) => upload(e.target.files);
  add.ondragover = (e) => { e.preventDefault(); add.classList.add("over"); };
  add.ondragleave = () => add.classList.remove("over");
  add.ondrop = (e) => { e.preventDefault(); add.classList.remove("over"); upload(e.dataTransfer.files); };
}

async function findImages(oid) {
  const box = $("dCands"), guard = detailOf, btn = $("dFind");
  btn.disabled = true;
  box.innerHTML = loadingHtml(t("searchingImages"));
  let res;
  try { res = await store.imageCandidates(oid); }
  catch (e) { box.innerHTML = `<p class="err small">${esc(e.message)}</p>`; return; }
  finally { btn.disabled = false; }
  if (detailOf !== guard) return;
  if (!res.candidates.length) { box.innerHTML = `<p class="small muted">${t("noImages")}</p>`; return; }
  box.innerHTML = `
    ${res.ranked ? "" : `<p class="small warn">${t("unranked")}</p>`}
    <div class="cands">${res.candidates.map((c, i) => `
      <div class="cand ${c.recommended ? "rec" : ""} ${c.fits === false ? "bad" : ""}">
        <a href="${esc(c.page_url)}" target="_blank" rel="noopener"><img src="${esc(c.thumb)}" alt="" loading="lazy"></a>
        <div class="meta">
          ${c.recommended ? `<span class="badge">${t("recommended")}</span> ` : ""}${c.quality ? "★".repeat(c.quality) : ""}
          ${c.note ? `<div title="${esc(c.note)}">${esc(c.note)}</div>` : ""}
          <div title="${esc(c.credit)}">${esc(c.credit)}</div>
          <div class="muted">${esc(c.license)} · ${c.source === "commons" ? "Commons" : "iNaturalist"}</div>
          <button data-take="${i}">${t("take")}</button>
        </div>
      </div>`).join("")}</div>`;
  box.querySelectorAll("[data-take]").forEach((b) => (b.onclick = async () => {
    busy(b, true, t("take"));
    try {
      await store.addRemoteImage(oid, res.candidates[+b.dataset.take]);
      b.textContent = t("taken");
      reloadGallery(oid);
    } catch (e) { b.disabled = false; b.textContent = t("take"); alert(e.message); }
  }));
}

// ---------- export / import ----------
$("btnExport").onclick = async () => {
  $("ioState").textContent = t("exporting");
  try {
    const blob = await store.exportData();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `my-tree-of-life-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    $("ioState").textContent = t("exported", (blob.size / 1e6).toFixed(1));
  } catch (e) { $("ioState").textContent = t("error", e.message); }
};
$("btnImport").onclick = () => $("importFile").click();
$("importFile").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  $("ioState").textContent = t("importing");
  try {
    const r = await store.importData(JSON.parse(await f.text()));
    $("ioState").textContent = r.updated ? t("importedMerged", r.organisms, r.images, r.updated) : t("imported", r.organisms, r.images);
    store.requestPersistence();
    refresh();
  } catch (err) { $("ioState").textContent = t("error", err.message); }
};

// ---------- tree ----------
const svg = d3.select("#svg");
const g = svg.append("g");
const zoom = d3.zoom().scaleExtent([0.2, 3]).on("zoom", (e) => g.attr("transform", e.transform));
svg.call(zoom);
const tip = $("tip");
let firstRender = true;
let fitTree = () => {};

// folded (eingeklappte) taxon keys, remembered per browser
const FOLD_KEY = "tol.folded";
const folded = new Set((() => { try { return JSON.parse(localStorage.getItem(FOLD_KEY)) || []; } catch { return []; } })());
let foldLevel = (() => { try { return JSON.parse(localStorage.getItem(FOLD_KEY + "Level")); } catch { return null; } })();
const saveFolded = () => {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify([...folded]));
    localStorage.setItem(FOLD_KEY + "Level", JSON.stringify(foldLevel));
  } catch {}
};
const countOrgs = (n) => n.type === "organism" ? 1 : n.children.reduce((s, c) => s + countOrgs(c), 0);
let lastRoot = null, lastData = null;

function toggleFold(key) {
  // keep the toggled node at the same spot on screen
  const before = lastRoot?.descendants().find((d) => d.data.taxon.key === key);
  folded.has(key) ? folded.delete(key) : folded.add(key);
  foldLevel = null;
  saveFolded();
  refreshTree().then(() => {
    const after = lastRoot?.descendants().find((d) => d.data.taxon.key === key);
    if (before && after) svg.call(zoom.translateBy, before.y - after.y, before.x - after.x);
  });
}

// Column header click: show everything up to this rank (replaces all single folds); same header again unfolds all.
function foldToRank(r) {
  folded.clear();
  if (r == null || foldLevel === r) foldLevel = null;
  else {
    foldLevel = r;
    d3.hierarchy(lastData).each((d) => {
      if (d.data.type !== "taxon" || d.data.taxon.key === "life" || !d.children) return;
      const rc = rankOf(d);
      // fold the nodes of this column, and earlier nodes whose children all lie beyond it
      if (rc === r || (rc < r && d.children.every((c) => c.data.type === "organism" || rankOf(c) > r)))
        folded.add(d.data.taxon.key);
    });
  }
  saveFolded();
  hideTip();
  refreshTree().then(() => fitTree());
}

function showTip(evt, html) {
  tip.innerHTML = html; tip.style.display = "block";
  const box = document.querySelector("main").getBoundingClientRect();
  tip.style.left = Math.min(evt.clientX - box.left + 12, box.width - 290) + "px";
  tip.style.top = evt.clientY - box.top + 12 + "px";
}
const hideTip = () => (tip.style.display = "none");
const taxLine = (x) => `${esc(taxonName(x) ? taxonName(x) + " – " : "")}<i>${esc(x.name)}</i> <span class="muted">(${esc(rankName(x.rank))})</span>`;

const RANKS = ["domain", "kingdom", "subkingdom", "phylum", "subphylum", "class", "subclass", "order", "suborder",
  "family", "subfamily", "tribe", "genus", "subgenus", "species", "subspecies", "variety", "form"];

const rankOf = (d) => {
  const i = RANKS.indexOf(d.data.taxon.rank);
  return i >= 0 ? i : (d.parent ? rankOf(d.parent) + 0.5 : 0); // unknown rank: just right of parent
};

// Horizontal position by taxonomic rank: all taxa of one rank share a column, organisms get the last one.
function placeByRank(root, dy) {
  const isLife = (d) => d.data.taxon.key === "life";
  const inner = root.descendants().filter((d) => d.data.type === "taxon" && !isLife(d));
  const used = [...new Set(inner.map(rankOf))].sort((a, b) => a - b);
  const col = new Map(used.map((r, i) => [r, i]));
  root.each((d) => {
    if (isLife(d)) d.y = -dy;
    else if (d.data.type === "organism") d.y = used.length * dy;
    else d.y = col.get(rankOf(d)) * dy;
  });
  return [
    ...(isLife(root) ? [{ y: -dy, label: "" }] : []),
    ...used.map((r, i) => ({ y: i * dy, r, label: rankName(RANKS[r]) })),
    { y: used.length * dy, r: null, label: t("organisms") },
  ];
}

async function refreshTree() {
  const data = await store.getTree();
  g.selectAll("*").remove();
  $("empty").hidden = !!data;
  if (!data) return;
  lastData = data;

  const isFolded = (n) => n.type === "taxon" && folded.has(n.taxon.key);
  const root = d3.hierarchy(data, (n) => (isFolded(n) ? null : n.children));
  lastRoot = root;
  const dx = 56, dy = 200;
  d3.cluster().nodeSize([dx, dy]).separation((a, b) => (a.parent === b.parent ? 1 : 1.25))(root);
  const cols = placeByRank(root, dy);

  // column headers (rank names) above the tree
  const top = d3.min(root.descendants(), (d) => d.x) - 44;
  // tap a header: fold everything up to this column; "Organismen" or the active header again: unfold all
  const heads = g.append("g").selectAll("g").data(cols.filter((c) => c.label)).join("g")
    .attr("class", (c) => "rank-head-g" + (c.r != null && c.r === foldLevel ? " active" : ""))
    .attr("transform", (c) => `translate(${c.y},${top})`)
    .on("click", (e, c) => { e.stopPropagation(); foldToRank(c.r); });
  heads.append("title").text((c) => c.r == null || c.r === foldLevel ? t("unfoldAll") : t("foldTo", c.label));
  heads.append("rect").attr("x", -60).attr("y", -20).attr("width", 120).attr("height", 30).attr("fill", "transparent");
  heads.append("text").attr("class", "rank-head").attr("text-anchor", "middle")
    .text((c) => (c.r != null && c.r === foldLevel ? "▸ " : "") + c.label);

  const defs = g.append("defs");
  defs.append("clipPath").attr("id", "clip").append("circle").attr("r", 18);

  const linkPath = d3.linkHorizontal().x((d) => d.y).y((d) => d.x);
  const links = g.append("g").selectAll("g").data(root.links()).join("g");
  // organism identified only down to its parent's rank: dashed link with a hint
  const coarse = (l) => l.target.data.type === "organism" && l.target.data.taxon.key === l.source.data.taxon.key;
  links.append("path").attr("class", (l) => "link" + (coarse(l) ? " coarse" : "")).attr("d", linkPath);
  links.filter(coarse).append("text").attr("class", "n-sub halo")
    .attr("x", (l) => (l.source.y + l.target.y) / 2).attr("y", (l) => (l.source.x + l.target.x) / 2 - 5)
    .attr("text-anchor", "middle").style("pointer-events", "none")
    .text((l) => t("onlyTo", rankName(l.source.data.taxon.rank)));
  links.filter((l) => l.target.data.collapsed.length)
    .append("path").attr("class", "link-hit").attr("d", linkPath)
    .on("mousemove", (e, l) => showTip(e, `<div class="small muted" style="margin-bottom:4px">${t("skipped")}</div>` +
      l.target.data.collapsed.map(taxLine).join("<br>")))
    .on("mouseleave", hideTip);
  links.filter((l) => l.target.data.collapsed.length)
    .append("text").attr("class", "skip halo")
    .attr("x", (l) => (l.source.y + l.target.y) / 2).attr("y", (l) => (l.source.x + l.target.x) / 2 - 4)
    .attr("text-anchor", "middle")
    .text((l) => `+${l.target.data.collapsed.length}`)
    .style("pointer-events", "none");

  const node = g.append("g").selectAll("g").data(root.descendants()).join("g")
    .attr("transform", (d) => `translate(${d.y},${d.x})`);

  const isLeaf = (d) => d.data.type === "organism";
  const isLife = (d) => d.data.taxon.key === "life";

  // common root above several domains (not a stored taxon, so not clickable)
  const life = node.filter(isLife);
  life.append("circle").attr("r", 6).attr("fill", "var(--node)");
  life.append("text").attr("class", "n-name halo").attr("x", -12).attr("y", 4).attr("text-anchor", "end").text(t("life"));

  // internal nodes
  const inner = node.filter((d) => !isLeaf(d) && !isLife(d))
    .attr("class", "clickable node-hit").on("click", (e, d) => showTaxon(d.data.taxon.key));
  inner.append("circle").attr("r", 5).attr("fill", "var(--node)");
  inner.append("text").attr("class", "n-name halo").attr("x", -10).attr("y", -6).attr("text-anchor", "end")
    .text((d) => taxonName(d.data.taxon) || d.data.taxon.name);
  inner.append("text").attr("class", "n-sub halo").attr("x", -10).attr("y", 9).attr("text-anchor", "end")
    .text((d) => (taxonName(d.data.taxon) ? d.data.taxon.name + " · " : "") + rankName(d.data.taxon.rank));

  // fold toggle (−/+) on every node that has children
  const foldable = node.filter((d) => d.data.type === "taxon" && d.data.children.length);
  const tog = foldable.append("g").attr("class", "fold").attr("transform", "translate(14,-14)")
    .on("click", (e, d) => { e.stopPropagation(); hideTip(); toggleFold(d.data.taxon.key); });
  tog.append("circle").attr("r", 16).attr("fill", "transparent"); // bigger touch target
  tog.append("circle").attr("class", "fold-btn").attr("r", 8);
  tog.append("text").attr("class", "fold-sign").attr("text-anchor", "middle").attr("y", 4)
    .text((d) => (isFolded(d.data) ? "+" : "−"));
  foldable.filter((d) => isFolded(d.data)).append("text").attr("class", "n-sub halo").attr("x", 12).attr("y", 4)
    .text((d) => { const n = countOrgs(d.data); return n === 1 ? t("oneOrganism") : t("nOrganisms", n); });

  // organisms
  const leaf = node.filter(isLeaf).attr("class", "clickable node-hit")
    .on("click", (e, d) => { hideTip(); showOrganism(d.data.id); })
    .on("mousemove", (e, d) => showTip(e, `<b>${esc(d.data.label)}</b><br>${taxLine(d.data.taxon)}`))
    .on("mouseleave", hideTip);
  leaf.append("circle").attr("r", 19).attr("fill", "var(--leaf)");
  leaf.filter((d) => d.data.image).append("image")
    .attr("href", (d) => d.data.image).attr("x", -18).attr("y", -18).attr("width", 36).attr("height", 36)
    .attr("preserveAspectRatio", "xMidYMid slice").attr("clip-path", "url(#clip)");
  leaf.append("text").attr("class", "n-name halo").attr("x", 26).attr("y", -2).text((d) => d.data.label);
  leaf.append("text").attr("class", "n-sci halo").attr("x", 26).attr("y", 13).text((d) => d.data.taxon.name);

  const [x0, x1] = d3.extent(root.descendants(), (d) => d.x);
  const [y0, y1] = d3.extent(root.descendants(), (d) => d.y);
  fitTree = () => {
    const box = $("svg").getBoundingClientRect();
    // fit the whole tree (plus label space on both sides) into the view, never zoom in beyond 1
    const left = Math.min(120, box.width * 0.2), labelRight = 190; // px left of the root, tree units for leaf labels
    // fit, but stay readable (small screens pan/pinch instead)
    const k = Math.max(0.45, Math.min(1, (box.width - left - 16) / (y1 - y0 + labelRight), box.height / (x1 - x0 + 160)));
    svg.call(zoom.transform, d3.zoomIdentity.translate(left - k * y0, box.height / 2 - k * (x0 + x1) / 2).scale(k));
  };
  if (firstRender) { fitTree(); firstRender = false; }
}

// ---------- fullscreen tree ----------
const mainEl = document.querySelector("main");
// phones count as mobile in landscape too
const isMobile = () => matchMedia("(max-width: 760px), (pointer: coarse) and (max-height: 500px)").matches;
const refitSoon = () => setTimeout(() => fitTree(), 250); // after layout/rotation settled

async function enterFs() {
  if (mainEl.classList.contains("fs")) return;
  mainEl.classList.add("fs");
  history.pushState({ fs: true }, ""); // hardware back button leaves fullscreen
  try {
    await mainEl.requestFullscreen?.({ navigationUI: "hide" });
    await screen.orientation?.lock?.("landscape");
  } catch { /* not supported (e.g. iPhone): stays as full-window overlay */ }
  refitSoon();
}
function leaveFs(fromHistory) {
  if (!mainEl.classList.contains("fs")) return;
  mainEl.classList.remove("fs");
  hideTip();
  try { screen.orientation?.unlock?.(); } catch {}
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (!fromHistory && history.state?.fs) history.back();
  refitSoon();
}
$("btnFs").onclick = enterFs;
$("btnFsBack").onclick = () => leaveFs(false);
window.addEventListener("popstate", () => leaveFs(true));
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) leaveFs(false); });
window.addEventListener("orientationchange", refitSoon);
// on phones a tap on empty tree space opens fullscreen
$("svg").addEventListener("click", (e) => {
  if (isMobile() && !mainEl.classList.contains("fs") && !e.target.closest(".clickable, .link-hit")) enterFs();
});

async function refresh() {
  try { await Promise.all([refreshList(), refreshTree()]); }
  catch (e) { $("error").textContent = e.message; }
}

if (isMobile()) $("listBox").open = false;
applyStatic();
renderSettingsState();
refresh();

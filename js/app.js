import * as store from "./store.js";
import { settings, saveSettings, DEFAULT_MODEL } from "./settings.js";

const $ = (id) => document.getElementById(id);
let imageFile = null;
let current = null; // current proposal

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function busy(btn, on, label) {
  btn.disabled = on;
  if (label) btn.textContent = on ? "…" : label;
}

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

// ---------- input ----------
const drop = $("drop");
function setImage(f) {
  imageFile = f;
  if (!f) { $("dropText").textContent = "Bild hierher ziehen oder klicken (optional)"; return; }
  const url = URL.createObjectURL(f);
  $("dropText").innerHTML = `<img src="${url}" alt=""><span class="small muted">${esc(f.name)} · klicken zum Ändern</span>`;
}
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
$("text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) identify();
});

async function identify() {
  $("error").textContent = "";
  const text = $("text").value.trim();
  if (!text && !imageFile) { $("error").textContent = "Text oder Bild angeben."; return; }
  busy($("btnIdentify"), true, "Bestimmen");
  try { showProposal(await store.identify(text, imageFile)); }
  catch (e) { $("error").textContent = e.message; }
  finally { busy($("btnIdentify"), false, "Bestimmen"); }
}
$("btnIdentify").onclick = identify;

async function lookup(name, de) {
  $("error").textContent = "";
  try {
    const p = await store.lookup(name, de);
    p.gemini = current?.gemini; // keep original identification for the record
    p.alternatives = current?.alternatives || [];
    p.reasoning = current?.reasoning;
    showProposal(p);
  } catch (e) { $("error").textContent = e.message; }
}

function showProposal(p) {
  current = p;
  const conf = p.confidence != null ? `${Math.round(p.confidence * 100)} %` : "";
  const lin = p.lineage.map((t) => esc(t.name)).join(" › ");
  const alts = (p.alternatives || []).filter((a) => a.scientific_name !== p.scientific_name);
  $("proposal").innerHTML = `
    <div class="card">
      <div class="small muted">Vorschlag ${conf ? "· " + conf : ""} · ${esc(p.rank)} · Quelle: ${p.source === "gbif" ? "GBIF" : "Gemini (nicht in GBIF)"}</div>
      <input type="text" id="label" value="${esc(p.common_name_de)}" style="margin-top:6px;font-weight:600">
      <div class="sci" style="margin-top:4px">${esc(p.scientific_name)}</div>
      ${p.reasoning ? `<div class="small muted" style="margin-top:4px">${esc(p.reasoning)}</div>` : ""}
      <div class="lineage">${lin}</div>
      ${p.duplicates.length ? `<div class="small warn" style="margin-top:6px">Schon erfasst als: ${p.duplicates.map((d) => esc(d.label)).join(", ")}</div>` : ""}
      ${alts.length ? `<div class="small muted" style="margin-top:10px">Oder doch:</div>
        <div class="row alts">${alts.map((a, i) => `<button data-alt="${i}">${esc(a.common_name_de)} <i>${esc(a.scientific_name)}</i></button>`).join("")}</div>` : ""}
      <div class="row" style="margin-top:8px">
        <input type="text" id="correct" placeholder="Anderer wiss. Name …" style="flex:1">
        <button id="btnCorrect">Prüfen</button>
      </div>
      <div class="row"><button class="primary" id="btnSave">Speichern</button><button id="btnDiscard">Verwerfen</button></div>
    </div>`;
  $("proposal").querySelectorAll("[data-alt]").forEach((b) => {
    b.onclick = () => { const a = alts[+b.dataset.alt]; lookup(a.scientific_name, a.common_name_de); };
  });
  $("btnCorrect").onclick = () => { const v = $("correct").value.trim(); if (v) lookup(v, ""); };
  $("btnDiscard").onclick = () => { $("proposal").innerHTML = ""; current = null; };
  $("btnSave").onclick = save;
}

async function save() {
  busy($("btnSave"), true, "Speichern");
  try {
    await store.createOrganism({
      proposal: current, inputText: $("text").value.trim(), label: $("label").value.trim(), imageBlob: imageFile,
    });
    $("proposal").innerHTML = ""; current = null;
    $("text").value = ""; setImage(null); $("file").value = "";
    store.requestPersistence();
    await refresh();
  } catch (e) { $("error").textContent = e.message; busy($("btnSave"), false, "Speichern"); }
}

// ---------- list ----------
async function refreshList() {
  const items = await store.listOrganisms();
  $("count").textContent = items.length ? `(${items.length})` : "";
  $("list").innerHTML = items.map((o) => `
    <li class="clickable" data-open="${o.id}">
      ${o.image ? `<img src="${esc(o.image)}" alt="">` : `<span class="ph"></span>`}
      <div class="t"><div>${esc(o.label)}</div><div class="small muted"><i>${esc(o.scientific_name)}</i> · ${esc(o.rank)}</div></div>
      <button title="Löschen" data-del="${o.id}">✕</button>
    </li>`).join("");
  $("list").querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Wirklich löschen?")) return;
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
  detail.innerHTML = `<button class="close" title="Schließen">✕</button>` + html;
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

const lineageChips = (lin) => `<div class="chips">${lin.map((t) =>
  `<span class="chip" data-taxon="${esc(t.key)}">${esc(t.name_de || t.name)}<span class="r">${esc(t.rank)}</span></span>`).join("")}</div>`;

function taxonInfoHtml(t) {
  return `${t.description ? `<p>${esc(t.description)}</p>` : `<p class="muted">Keine Beschreibung.</p>`}
    ${t.features?.length ? `<h4>Merkmale</h4><ul>${t.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}`;
}

async function loadTaxonInfo(key, slot, guard) {
  slot.innerHTML = `<p class="muted small">Beschreibung wird geladen …</p>`;
  try {
    const t = await store.getTaxon(key);
    if (detailOf !== guard) return null;
    slot.innerHTML = taxonInfoHtml(t);
    return t;
  } catch (e) {
    if (detailOf === guard) slot.innerHTML = `<p class="err small">${esc(e.message)}</p>`;
    return null;
  }
}

async function showTaxon(key) {
  const id = "t" + key;
  openDetail(id, `<div class="small muted">lädt …</div><div id="dInfo"></div>`);
  const t = await loadTaxonInfo(key, $("dInfo"), id);
  if (!t) return;
  openDetail(id, `
    <div class="small muted">${esc(t.rank)}${t.source === "gemini" ? " · nur Gemini (nicht in GBIF)" : ""}</div>
    <h3>${esc(t.name_de || t.name)}</h3>
    ${t.name_de ? `<div class="sci muted"><i>${esc(t.name)}</i></div>` : ""}
    <h4>Beschreibung</h4>${taxonInfoHtml(t)}
    ${t.lineage.length ? `<h4>Linie</h4>${lineageChips(t.lineage)}` : ""}
    <h4>Deine Organismen in dieser Gruppe (${t.organisms.length})</h4>
    <div class="chips">${t.organisms.map((o) => `<span class="chip" data-org="${o.id}">${esc(o.label)}</span>`).join("")}</div>`);
}

async function showOrganism(oid) {
  const id = "o" + oid;
  let o;
  try { o = await store.getOrganism(oid); } catch (e) { $("error").textContent = e.message; return; }
  const g = o.gemini || {};
  const conf = g.confidence != null ? `${Math.round(g.confidence * 100)} %` : null;
  const alts = (g.alternatives || []).filter((a) => a.scientific_name !== o.scientific_name);
  const taxon = o.lineage[o.lineage.length - 1];
  openDetail(id, `
    <div class="small muted">${esc(o.rank)} · erfasst ${esc(o.created_at.slice(0, 10))}</div>
    <h3>${esc(o.label)}</h3>
    <div class="muted"><i>${esc(o.scientific_name)}</i>${taxon?.name_de && taxon.name_de !== o.label ? " · " + esc(taxon.name_de) : ""}</div>
    <div id="dGallery"></div>
    <div class="row"><button id="dFind">🔎 Freies Bild suchen</button></div>
    <div id="dCands"></div>
    <h4>Beschreibung</h4><div id="dInfo"></div>
    <h4>Bestimmung</h4>
    ${o.input_text ? `<p><span class="muted">Eingabe:</span> „${esc(o.input_text)}“</p>` : `<p class="muted">Eingabe: nur Bild</p>`}
    ${g.reasoning ? `<p>${esc(g.reasoning)}</p>` : ""}
    ${conf ? `<p class="small muted">Sicherheit: ${conf}${g.scientific_name && g.scientific_name !== o.scientific_name ? ` · Gemini schlug <i>${esc(g.scientific_name)}</i> vor` : ""}</p>` : ""}
    ${alts.length ? `<p class="small muted">Alternativen: ${alts.map((a) => `${esc(a.common_name_de)} (<i>${esc(a.scientific_name)}</i>)`).join(", ")}</p>` : ""}
    <h4>Linie</h4>${lineageChips(o.lineage.slice(0, -1))}
    <h4>Notizen</h4>
    <textarea id="dNotes" placeholder="Eigene Notizen …">${esc(o.notes || "")}</textarea>
    <div class="small muted" id="dNotesState"></div>`);
  $("dNotes").addEventListener("change", async (e) => {
    await store.updateOrganism(oid, { notes: e.target.value });
    $("dNotesState").textContent = "gespeichert";
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
    <h4>Bilder (${o.images.length})</h4>
    <div class="gallery">
      ${o.images.map((im) => `
        <div class="ph ${im.is_cover ? "cover" : ""}" data-img="${im.id}" title="${im.is_cover ? "Titelbild" : "Ansehen"}">
          <img src="${esc(im.url)}" alt="" loading="lazy">
          <div class="acts">
            <button data-cover="${im.id}" title="Als Titelbild">★</button>
            <button data-delimg="${im.id}" title="Löschen">✕</button>
          </div>
        </div>`).join("")}
      <label class="add" id="dAdd" title="Eigene Bilder hinzufügen (auch per Drag & Drop)">+
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
    if (!confirm("Bild löschen?")) return;
    await store.deleteImage(+b.dataset.delimg);
    reloadGallery(o.id);
  }));

  const upload = async (files) => {
    files = [...files].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    $("dAdd").firstChild.textContent = "…";
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
  box.innerHTML = `<p class="small muted">Suche bei iNaturalist und Wikimedia Commons, Gemini prüft die Treffer …</p>`;
  let res;
  try { res = await store.imageCandidates(oid); }
  catch (e) { box.innerHTML = `<p class="err small">${esc(e.message)}</p>`; return; }
  finally { btn.disabled = false; }
  if (detailOf !== guard) return;
  if (!res.candidates.length) { box.innerHTML = `<p class="small muted">Keine frei lizenzierten Bilder gefunden.</p>`; return; }
  box.innerHTML = `
    ${res.ranked ? "" : `<p class="small warn">Gemini-Bewertung nicht verfügbar – ungeprüfte Treffer.</p>`}
    <div class="cands">${res.candidates.map((c, i) => `
      <div class="cand ${c.recommended ? "rec" : ""} ${c.fits === false ? "bad" : ""}">
        <a href="${esc(c.page_url)}" target="_blank" rel="noopener"><img src="${esc(c.thumb)}" alt="" loading="lazy"></a>
        <div class="meta">
          ${c.recommended ? `<span class="badge">Empfehlung</span> ` : ""}${c.quality ? "★".repeat(c.quality) : ""}
          ${c.note ? `<div title="${esc(c.note)}">${esc(c.note)}</div>` : ""}
          <div title="${esc(c.credit)}">${esc(c.credit)}</div>
          <div class="muted">${esc(c.license)} · ${c.source === "commons" ? "Commons" : "iNaturalist"}</div>
          <button data-take="${i}">Übernehmen</button>
        </div>
      </div>`).join("")}</div>`;
  box.querySelectorAll("[data-take]").forEach((b) => (b.onclick = async () => {
    b.disabled = true; b.textContent = "…";
    try {
      await store.addRemoteImage(oid, res.candidates[+b.dataset.take]);
      b.textContent = "✓ übernommen";
      reloadGallery(oid);
    } catch (e) { b.disabled = false; b.textContent = "Übernehmen"; alert(e.message); }
  }));
}

// ---------- export / import ----------
$("btnExport").onclick = async () => {
  $("ioState").textContent = "exportiere …";
  try {
    const blob = await store.exportData();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tree-of-life-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    $("ioState").textContent = `exportiert (${(blob.size / 1e6).toFixed(1)} MB)`;
  } catch (e) { $("ioState").textContent = "Fehler: " + e.message; }
};
$("btnImport").onclick = () => $("importFile").click();
$("importFile").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  $("ioState").textContent = "importiere …";
  try {
    const r = await store.importData(JSON.parse(await f.text()));
    $("ioState").textContent = `importiert: ${r.organisms} Organismen, ${r.images} Bilder`;
    store.requestPersistence();
    refresh();
  } catch (err) { $("ioState").textContent = "Fehler: " + err.message; }
};

// ---------- tree ----------
const svg = d3.select("#svg");
const g = svg.append("g");
const zoom = d3.zoom().scaleExtent([0.2, 3]).on("zoom", (e) => g.attr("transform", e.transform));
svg.call(zoom);
const tip = $("tip");
let firstRender = true;
let fitTree = () => {};

function showTip(evt, html) {
  tip.innerHTML = html; tip.style.display = "block";
  const box = document.querySelector("main").getBoundingClientRect();
  tip.style.left = Math.min(evt.clientX - box.left + 12, box.width - 290) + "px";
  tip.style.top = evt.clientY - box.top + 12 + "px";
}
const hideTip = () => (tip.style.display = "none");
const taxLine = (t) => `${esc(t.name_de ? t.name_de + " – " : "")}<i>${esc(t.name)}</i> <span class="muted">(${esc(t.rank)})</span>`;

const RANKS = ["domain", "kingdom", "subkingdom", "phylum", "subphylum", "class", "subclass", "order", "suborder",
  "family", "subfamily", "tribe", "genus", "subgenus", "species", "subspecies", "variety", "form"];
const RANK_DE = { domain: "Domäne", kingdom: "Reich", phylum: "Stamm", class: "Klasse", order: "Ordnung",
  family: "Familie", genus: "Gattung", species: "Art" };

// Horizontal position by taxonomic rank: all taxa of one rank share a column, organisms get the last one.
function placeByRank(root, dy) {
  const rankOf = (d) => {
    const i = RANKS.indexOf(d.data.taxon.rank);
    return i >= 0 ? i : (d.parent ? rankOf(d.parent) + 0.5 : 0); // unknown rank: just right of parent
  };
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
    ...used.map((r, i) => ({ y: i * dy, label: RANK_DE[RANKS[r]] || RANKS[r] || "" })),
    { y: used.length * dy, label: "Organismen" },
  ];
}

async function refreshTree() {
  const data = await store.getTree();
  g.selectAll("*").remove();
  $("empty").hidden = !!data;
  if (!data) return;

  const root = d3.hierarchy(data);
  const dx = 56, dy = 200;
  d3.cluster().nodeSize([dx, dy]).separation((a, b) => (a.parent === b.parent ? 1 : 1.25))(root);
  const cols = placeByRank(root, dy);

  // column headers (rank names) above the tree
  const top = d3.min(root.descendants(), (d) => d.x) - 44;
  g.append("g").selectAll("text").data(cols).join("text")
    .attr("class", "rank-head").attr("x", (c) => c.y).attr("y", top).attr("text-anchor", "middle")
    .text((c) => c.label);

  const defs = g.append("defs");
  defs.append("clipPath").attr("id", "clip").append("circle").attr("r", 18);

  const linkPath = d3.linkHorizontal().x((d) => d.y).y((d) => d.x);
  const links = g.append("g").selectAll("g").data(root.links()).join("g");
  links.append("path").attr("class", "link").attr("d", linkPath);
  links.filter((l) => l.target.data.collapsed.length)
    .append("path").attr("class", "link-hit").attr("d", linkPath)
    .on("mousemove", (e, l) => showTip(e, `<div class="small muted" style="margin-bottom:4px">Übersprungen:</div>` +
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
  life.append("text").attr("class", "n-name halo").attr("x", -12).attr("y", 4).attr("text-anchor", "end").text("Leben");

  // internal nodes
  const inner = node.filter((d) => !isLeaf(d) && !isLife(d))
    .attr("class", "clickable node-hit").on("click", (e, d) => showTaxon(d.data.taxon.key));
  inner.append("circle").attr("r", 5).attr("fill", "var(--node)");
  inner.append("text").attr("class", "n-name halo").attr("x", -10).attr("y", -6).attr("text-anchor", "end")
    .text((d) => d.data.taxon.name_de || d.data.taxon.name);
  inner.append("text").attr("class", "n-sub halo").attr("x", -10).attr("y", 9).attr("text-anchor", "end")
    .text((d) => (d.data.taxon.name_de ? d.data.taxon.name + " · " : "") + d.data.taxon.rank);

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
const isMobile = () => matchMedia("(max-width: 760px)").matches;
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
renderSettingsState();
refresh();

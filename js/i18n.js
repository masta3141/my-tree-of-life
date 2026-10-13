// UI language (de/en): string tables, the current language, and helpers for bilingual data fields.
//
// Stored data keeps its German fields as they were (taxon: name_de, description, features;
// organism: label_de) and adds English ones next to them (name_en, description_en, features_en, label_en).

const KEY = "tol.lang";
export const LANGS = ["de", "en"];

export let lang = (() => {
  try { const l = localStorage.getItem(KEY); if (LANGS.includes(l)) return l; } catch {}
  return (navigator.language || "").toLowerCase().startsWith("de") ? "de" : "en";
})();

export function setLang(l) {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch {}
  document.documentElement.lang = l;
}
document.documentElement.lang = lang;

const STR = {
  de: {
    "meta.description": "Persönlicher Stammbaum: Organismen erfassen, von Gemini bestimmen lassen und als minimalen Baum ansehen.",
    "settings": "Einstellungen",
    "language": "Sprache",
    "noKey": 'Für die Bestimmung brauchst du einen eigenen, kostenlosen <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Gemini-API-Key</a>. Trag ihn unter ⚙ ein.',
    "set.key": "Gemini-API-Key",
    "set.model": "Modell",
    "set.privacy": 'Key und Sammlung bleiben in diesem Browser. Der Key wird nur an Google gesendet. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Key erstellen</a>',
    "save": "Speichern",
    "addPhotoTo": "Foto zu „{0}“ hinzufügen",
    "openExisting": "„{0}“ öffnen",
    "close": "Schließen",
    "set.backup": "Sammlung sichern",
    "set.backupHint": "Deine Sammlung liegt nur in diesem Browser. Sichere sie ab und zu.",
    "export": "⬇ Exportieren",
    "import": "⬆ Importieren",
    "removeImage": "Bild entfernen",
    "input.placeholder": "Organismus, z.B. „Marienkäfer“",
    "addImage": "Bild hinzufügen",
    "identify": "Bestimmen",
    "recorded": "Erfasst",
    "empty": "Noch nichts erfasst. Fang links an.",
    "fullscreen": "Vollbild",
    "back": "← Zurück",
    "error": "Fehler: {0}",

    "needInput": "Text oder Bild angeben.",
    "step.gemini": "Gemini bestimmt den Organismus …",
    "step.gbif": "Stammbaum bei GBIF nachschlagen …",
    "step.save": "Speichern, Namen von Gemini holen …",
    "proposal": "Vorschlag",
    "source": "Quelle",
    "source.gemini": "Gemini (nicht in GBIF)",
    "already": "Schon erfasst als: {0}",
    "orMaybe": "Oder doch:",
    "otherName": "Anderer wiss. Name …",
    "check": "Prüfen",
    "discard": "Verwerfen",
    "delete": "Löschen",
    "confirmDelete": "Wirklich löschen?",

    "noDescription": "Keine Beschreibung.",
    "features": "Merkmale",
    "description": "Beschreibung",
    "loadingDescription": "Beschreibung wird geladen, ggf. fragt Gemini nach …",
    "geminiOnly": "nur Gemini (nicht in GBIF)",
    "lineage": "Linie",
    "yourOrganisms": "Deine Organismen in dieser Gruppe ({0})",
    "recordedOn": "erfasst {0}",
    "findImage": "🔎 Freies Bild suchen",
    "identification": "Bestimmung",
    "input": "Eingabe:",
    "inputImageOnly": "Eingabe: nur Bild",
    "confidence": "Sicherheit: {0}",
    "geminiSuggested": "Gemini schlug {0} vor",
    "alternatives": "Alternativen: {0}",
    "notes": "Notizen",
    "notesPlaceholder": "Eigene Notizen …",
    "saved": "gespeichert",

    "images": "Bilder ({0})",
    "cover": "Titelbild",
    "view": "Ansehen",
    "asCover": "Als Titelbild",
    "addImages": "Eigene Bilder hinzufügen (auch per Drag & Drop)",
    "confirmDeleteImage": "Bild löschen?",
    "searchingImages": "Suche bei iNaturalist und Wikimedia Commons, Gemini prüft die Treffer …",
    "noImages": "Keine frei lizenzierten Bilder gefunden.",
    "unranked": "Gemini-Bewertung nicht verfügbar – ungeprüfte Treffer.",
    "recommended": "Empfehlung",
    "take": "Übernehmen",
    "taken": "✓ übernommen",

    "exporting": "exportiere …",
    "exported": "exportiert ({0} MB)",
    "importing": "importiere …",
    "imported": "importiert: {0} Organismen, {1} Bilder",
    "importedMerged": "importiert: {0} neue Organismen, {1} Bilder, {2} vorhandene aktualisiert",
    "translating": "übersetze {0} …",
    "tr.names": "Namen",
    "tr.labels": "Organismen",
    "tr.descriptions": "Beschreibungen ({0})",

    "unfoldAll": "Alles ausklappen",
    "foldTo": "Bis {0} einklappen",
    "organisms": "Organismen",
    "nOrganisms": "{0} Organismen",
    "oneOrganism": "1 Organismus",
    "onlyTo": "nur bis {0} bestimmt",
    "skipped": "Übersprungen:",
    "life": "Leben",

    "err.noKey": "Kein Gemini-API-Key eingetragen (⚙ Einstellungen).",
    "err.empty": "Gemini: leere Antwort",
    "err.noTaxonomy": "Keine Taxonomie für „{0}“ gefunden",
    "err.notFound": "Nicht gefunden",
    "err.notExport": "Keine My-Tree-of-Life-Exportdatei",
    "err.imageHost": "Nur Bilder von iNaturalist oder Wikimedia Commons",
    "err.download": "Download fehlgeschlagen: {0}",
    "seeSource": "siehe Quelle",
  },
  en: {
    "meta.description": "Personal tree of life: record organisms, let Gemini identify them and see them as a minimal tree.",
    "settings": "Settings",
    "language": "Language",
    "noKey": 'To identify organisms you need your own free <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Gemini API key</a>. Enter it under ⚙.',
    "set.key": "Gemini API key",
    "set.model": "Model",
    "set.privacy": 'Key and collection stay in this browser. The key is only sent to Google. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Create a key</a>',
    "save": "Save",
    "addPhotoTo": "Add photo to “{0}”",
    "openExisting": "Open “{0}”",
    "close": "Close",
    "set.backup": "Back up collection",
    "set.backupHint": "Your collection lives only in this browser. Back it up now and then.",
    "export": "⬇ Export",
    "import": "⬆ Import",
    "removeImage": "Remove image",
    "input.placeholder": "Organism, e.g. “ladybird”",
    "addImage": "Add image",
    "identify": "Identify",
    "recorded": "Recorded",
    "empty": "Nothing recorded yet. Start on the left.",
    "fullscreen": "Fullscreen",
    "back": "← Back",
    "error": "Error: {0}",

    "needInput": "Enter text or an image.",
    "step.gemini": "Gemini is identifying the organism …",
    "step.gbif": "Looking up the lineage at GBIF …",
    "step.save": "Saving, fetching names from Gemini …",
    "proposal": "Suggestion",
    "source": "Source",
    "source.gemini": "Gemini (not in GBIF)",
    "already": "Already recorded as: {0}",
    "orMaybe": "Or maybe:",
    "otherName": "Other scientific name …",
    "check": "Check",
    "discard": "Discard",
    "delete": "Delete",
    "confirmDelete": "Really delete?",

    "noDescription": "No description.",
    "features": "Features",
    "description": "Description",
    "loadingDescription": "Loading description, may ask Gemini …",
    "geminiOnly": "Gemini only (not in GBIF)",
    "lineage": "Lineage",
    "yourOrganisms": "Your organisms in this group ({0})",
    "recordedOn": "recorded {0}",
    "findImage": "🔎 Find a free image",
    "identification": "Identification",
    "input": "Input:",
    "inputImageOnly": "Input: image only",
    "confidence": "Confidence: {0}",
    "geminiSuggested": "Gemini suggested {0}",
    "alternatives": "Alternatives: {0}",
    "notes": "Notes",
    "notesPlaceholder": "Your notes …",
    "saved": "saved",

    "images": "Images ({0})",
    "cover": "Cover image",
    "view": "View",
    "asCover": "Use as cover",
    "addImages": "Add your own images (drag & drop works too)",
    "confirmDeleteImage": "Delete image?",
    "searchingImages": "Searching iNaturalist and Wikimedia Commons, Gemini checks the results …",
    "noImages": "No freely licensed images found.",
    "unranked": "Gemini rating unavailable – unchecked results.",
    "recommended": "Recommended",
    "take": "Use",
    "taken": "✓ added",

    "exporting": "exporting …",
    "exported": "exported ({0} MB)",
    "importing": "importing …",
    "imported": "imported: {0} organisms, {1} images",
    "importedMerged": "imported: {0} new organisms, {1} images, {2} existing updated",
    "translating": "translating {0} …",
    "tr.names": "names",
    "tr.labels": "organisms",
    "tr.descriptions": "descriptions ({0})",

    "unfoldAll": "Unfold all",
    "foldTo": "Fold up to {0}",
    "organisms": "Organisms",
    "nOrganisms": "{0} organisms",
    "oneOrganism": "1 organism",
    "onlyTo": "identified only to {0}",
    "skipped": "Skipped:",
    "life": "Life",

    "err.noKey": "No Gemini API key entered (⚙ Settings).",
    "err.empty": "Gemini: empty response",
    "err.noTaxonomy": "No taxonomy found for “{0}”",
    "err.notFound": "Not found",
    "err.notExport": "Not a My Tree of Life export file",
    "err.imageHost": "Only images from iNaturalist or Wikimedia Commons",
    "err.download": "Download failed: {0}",
    "seeSource": "see source",
  },
};

// t("key", a, b) fills {0}, {1}, ...
export function t(key, ...args) {
  const s = STR[lang][key] ?? STR.de[key] ?? key;
  return s.replace(/\{(\d)\}/g, (_, i) => args[+i] ?? "");
}

const RANK = {
  de: { domain: "Domäne", kingdom: "Reich", subkingdom: "Unterreich", phylum: "Stamm", subphylum: "Unterstamm",
    class: "Klasse", subclass: "Unterklasse", order: "Ordnung", suborder: "Unterordnung", family: "Familie",
    subfamily: "Unterfamilie", tribe: "Tribus", genus: "Gattung", subgenus: "Untergattung", species: "Art",
    subspecies: "Unterart", variety: "Varietät", form: "Form" },
  en: { domain: "Domain", kingdom: "Kingdom", subkingdom: "Subkingdom", phylum: "Phylum", subphylum: "Subphylum",
    class: "Class", subclass: "Subclass", order: "Order", suborder: "Suborder", family: "Family",
    subfamily: "Subfamily", tribe: "Tribe", genus: "Genus", subgenus: "Subgenus", species: "Species",
    subspecies: "Subspecies", variety: "Variety", form: "Form" },
};
export const rankName = (r) => RANK[lang][r] || r || "";

// ---------- bilingual data fields ----------

// common name of a taxon in the current language (null if there is none)
export const taxonName = (tx) => (lang === "en" ? tx.name_en : tx.name_de) ?? null;

// description/features of a stored taxon in the current language (null if not yet generated)
export const taxonInfo = (tx) => lang === "en"
  ? { description: tx.description_en ?? null, features: tx.features_en ?? null }
  : { description: tx.description ?? null, features: tx.features ?? null };

// organism label in the current language, falling back to the other one
export const labelOf = (o) => (lang === "en" ? o.label_en || o.label_de : o.label_de || o.label_en) || "";

// Gemini's identification record: reasoning and alternative names in the current language
export const reasoningOf = (g) => (lang === "en" ? g?.reasoning_en || g?.reasoning : g?.reasoning || g?.reasoning_en) ?? null;
export const commonNameOf = (a) => (lang === "en" ? a?.common_name_en || a?.common_name_de : a?.common_name_de || a?.common_name_en) ?? "";

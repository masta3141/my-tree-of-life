// Gemini REST client (runs in the browser with the user's own API key).

import { settings } from "./settings.js?v=10";
import { t, lang } from "./i18n.js?v=10";
import { tryDownscale, GEMINI_MAX } from "./resize.js?v=10";

const API = "https://generativelanguage.googleapis.com/v1beta/models";

// tiny schema helpers (Gemini's OpenAPI-style response schema)
const S = { type: "STRING" };
const N = { type: "NUMBER" };
const I = { type: "INTEGER" };
const B = { type: "BOOLEAN" };
const arr = (items) => ({ type: "ARRAY", items });
const obj = (properties) => ({ type: "OBJECT", properties, required: Object.keys(properties) });

export class GeminiError extends Error {}

async function generateJSON(parts, schema, temperature) {
  const { apiKey, model } = settings();
  if (!apiKey) throw new GeminiError(t("err.noKey"));
  const r = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature },
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new GeminiError(`Gemini: ${body.error?.message || r.status}`);
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
  if (!text) throw new GeminiError(t("err.empty"));
  return JSON.parse(text);
}

export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

// photos are sent downscaled: faster upload, no worse identification
const imagePart = async (blob) => {
  const small = await tryDownscale(blob, GEMINI_MAX);
  return { inline_data: { mime_type: small.type || "image/jpeg", data: await blobToBase64(small) } };
};

const IDENTIFY_PROMPT = `You are a taxonomist. Identify the described and/or pictured organism.
The input may be in German or English.

Rules:
- scientific_name: valid scientific name (without author), as deep as you are sure of – ideally species.
  If only a general group is meant (e.g. "spider", "Baum"), choose the taxon that fits the description best
  (e.g. "Araneae"). For "tree" without an image take the most likely typical Central European species
  and name alternatives.
- rank: rank in lowercase English (species, genus, family, order, class, phylum, kingdom, subspecies ...).
- common_name_de / common_name_en: common German / English name (English with an initial capital, e.g. "Red squirrel").
- confidence: 0..1.
- reasoning_de / reasoning_en: one short sentence, in German / English (same content).
- alternatives: up to 3 plausible alternatives (empty if unambiguous).
- fallback_lineage: complete lineage from kingdom via phylum, class, order, family, genus down to the taxon itself,
  standard ranks only, lowercase English rank names.
`;

const NAMES = { common_name_de: S, common_name_en: S };

export async function identify(text, imageBlob) {
  const parts = [];
  if (imageBlob) parts.push(await imagePart(imageBlob));
  parts.push({ text: IDENTIFY_PROMPT + (text ? `\nInput: ${text}` : "\nInput: (image only)") });
  const r = await generateJSON(parts, obj({
    scientific_name: S,
    rank: S,
    ...NAMES,
    confidence: N,
    reasoning_de: S,
    reasoning_en: S,
    alternatives: arr(obj({ scientific_name: S, ...NAMES })),
    fallback_lineage: arr(obj({ rank: S, name: S })),
  }), 0.2);
  // German reasoning keeps its old field name, so older records read the same way
  const { reasoning_de, ...rest } = r;
  return { ...rest, reasoning: reasoning_de };
}

// [[rank, name]] -> { name: { de, en } } with "" where a language has no common name
export async function commonNames(taxa) {
  if (!taxa.length) return {};
  const listing = taxa.map(([rank, name]) => `- ${rank}: ${name}`).join("\n");
  const res = await generateJSON([{ text:
    "For each taxon give the common German and English name (e.g. Mammalia -> Säugetiere / Mammals, " +
    "Artiodactyla -> Paarhufer / Even-toed ungulates, Sciurus vulgaris -> Eichhörnchen / Red squirrel). " +
    "English names start with a capital letter. If a language has no " +
    "common name, return an empty string for it. One entry per taxon, name = scientific name.\n" + listing }],
    arr(obj({ name: S, name_de: S, name_en: S })), 0);
  return Object.fromEntries(res.map((g) => [g.name, { de: g.name_de || "", en: g.name_en || "" }]));
}

export async function describeTaxon(rank, name, lineage) {
  return generateJSON([{ text:
    `Describe the taxon ${name} (rank: ${rank}; lineage: ${lineage.join(" › ")}) for an interested layperson, ` +
    "once in German (_de) and once in English (_en), same content.\n" +
    "- name_de / name_en: common name (English with an initial capital), empty if there is none.\n" +
    "- description: 2–4 sentences: what belongs to it, how old/widespread/species-rich the group is, what is remarkable.\n" +
    "- features: 3–5 short bullet points with the characteristic features that set this group apart from closely " +
    "related groups." }],
    obj({ name_de: S, name_en: S, description_de: S, description_en: S, features_de: arr(S), features_en: arr(S) }), 0.3);
}

// Translate existing taxon descriptions. items: [{ name, description, features }], from/to: "de" | "en"
export async function translateDescriptions(items, from, to) {
  if (!items.length) return [];
  const langName = { de: "German", en: "English" };
  return generateJSON([{ text:
    `Translate these descriptions of biological taxa from ${langName[from]} to ${langName[to]}. ` +
    "Keep the meaning, tone and the number of features; keep scientific names as they are. " +
    "Answer with one entry per taxon, name = scientific name as given.\n" + JSON.stringify(items) }],
    arr(obj({ name: S, description: S, features: arr(S) })), 0);
}

// Translate organism records. items: [{ id, scientific_name, label, reasoning, alternatives: [name] }]
export async function translateOrganisms(items, from, to) {
  if (!items.length) return [];
  const langName = { de: "German", en: "English" };
  return generateJSON([{ text:
    `Translate these records of recorded organisms from ${langName[from]} to ${langName[to]}. ` +
    "label is a common name: use the established common name in the target language if there is one " +
    "(e.g. Eichhörnchen -> Red squirrel; English with an initial capital), otherwise keep it. alternatives are common names, translate them " +
    "the same way and keep their order. Answer with one entry per record, same id.\n" + JSON.stringify(items) }],
    arr(obj({ id: I, label: S, reasoning: S, alternatives: arr(S) })), 0);
}

// Judge candidate photos: does each show the organism, and how good a portrait is it (1–5)?
export async function rankImages(scientificName, commonName, blobs) {
  const parts = [];
  for (const [i, blob] of blobs.entries()) parts.push({ text: `Image ${i}:` }, await imagePart(blob));
  parts.push({ text:
    `We are looking for an image that shows ${commonName} (${scientificName}) well – as a typical portrait for a ` +
    "reference work. Rate each image: index = image number; shows_organism = does it actually show a living or " +
    "realistically photographed member of this taxon (no map, drawing, skeleton, collage, no other animal/plant)?; " +
    "quality = 1–5 (sharpness, framing, visibility of typical features); " +
    `note = very short reason in ${lang === "en" ? "English" : "German"}.` });
  return generateJSON(parts, arr(obj({ index: I, shows_organism: B, quality: I, note: S })), 0);
}

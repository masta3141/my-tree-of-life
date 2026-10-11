// Gemini REST client (runs in the browser with the user's own API key).

import { settings } from "./settings.js";

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
  if (!apiKey) throw new GeminiError("Kein Gemini-API-Key eingetragen (⚙ Einstellungen).");
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
  if (!text) throw new GeminiError("Gemini: leere Antwort");
  return JSON.parse(text);
}

export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

const imagePart = async (blob) => ({ inline_data: { mime_type: blob.type || "image/jpeg", data: await blobToBase64(blob) } });

const IDENTIFY_PROMPT = `Du bist ein Taxonom. Identifiziere den beschriebenen und/oder abgebildeten Organismus.

Regeln:
- scientific_name: gültiger wissenschaftlicher Name (ohne Autor), so tief wie sicher möglich – idealerweise Art.
  Ist nur eine allgemeine Gruppe gemeint (z.B. "Spinne", "Baum"), wähle das Taxon, das die Beschreibung am
  besten trifft (z.B. "Araneae"). Bei "Baum" ohne Bild nimm die wahrscheinlichste typische mitteleuropäische Art
  und nenne Alternativen.
- rank: Rang auf Englisch klein (species, genus, family, order, class, phylum, kingdom, subspecies ...).
- common_name_de: gebräuchlicher deutscher Name.
- confidence: 0..1.
- reasoning: ein kurzer Satz auf Deutsch.
- alternatives: bis zu 3 plausible Alternativen (leer, wenn eindeutig).
- fallback_lineage: vollständige Linie von kingdom über phylum, class, order, family, genus bis zum Taxon selbst,
  nur Standardränge, englische Rangnamen klein.
`;

export async function identify(text, imageBlob) {
  const parts = [];
  if (imageBlob) parts.push(await imagePart(imageBlob));
  parts.push({ text: IDENTIFY_PROMPT + (text ? `\nEingabe: ${text}` : "\nEingabe: (nur Bild)") });
  return generateJSON(parts, obj({
    scientific_name: S,
    rank: S,
    common_name_de: S,
    confidence: N,
    reasoning: S,
    alternatives: arr(obj({ scientific_name: S, common_name_de: S })),
    fallback_lineage: arr(obj({ rank: S, name: S })),
  }), 0.2);
}

// [[rank, name]] -> { name: deutscher Name } (only where one exists)
export async function germanNames(taxa) {
  if (!taxa.length) return {};
  const listing = taxa.map(([rank, name]) => `- ${rank}: ${name}`).join("\n");
  const res = await generateJSON([{ text:
    "Gib für jedes Taxon den gebräuchlichen deutschen Namen an (z.B. Mammalia -> Säugetiere, " +
    "Artiodactyla -> Paarhufer). Wenn es keinen gebräuchlichen deutschen Namen gibt, gib einen leeren " +
    `String zurück. Antworte mit einem Eintrag pro Taxon, name = wissenschaftlicher Name.\n${listing}` }],
    arr(obj({ name: S, name_de: S })), 0);
  return Object.fromEntries(res.filter((g) => g.name_de).map((g) => [g.name, g.name_de]));
}

export async function describeTaxon(rank, name, lineage) {
  return generateJSON([{ text:
    `Beschreibe das Taxon ${name} (Rang: ${rank}; Linie: ${lineage.join(" › ")}) für einen interessierten Laien ` +
    "auf Deutsch.\n" +
    "- name_de: gebräuchlicher deutscher Name, leer wenn es keinen gibt.\n" +
    "- description: 2–4 Sätze: was gehört dazu, wie alt/verbreitet/artenreich ist die Gruppe, was ist bemerkenswert.\n" +
    "- features: 3–5 kurze Stichpunkte mit den kennzeichnenden Merkmalen, die diese Gruppe von nah verwandten " +
    "Gruppen unterscheiden." }],
    obj({ name_de: S, description: S, features: arr(S) }), 0.3);
}

// Judge candidate photos: does each show the organism, and how good a portrait is it (1–5)?
export async function rankImages(scientificName, commonName, blobs) {
  const parts = [];
  for (const [i, blob] of blobs.entries()) parts.push({ text: `Bild ${i}:` }, await imagePart(blob));
  parts.push({ text:
    `Gesucht ist ein Bild, das ${commonName} (${scientificName}) gut zeigt – als typisches Porträt für ein ` +
    "Nachschlagewerk. Bewerte jedes Bild: index = Bildnummer; shows_organism = zeigt es tatsächlich einen " +
    "lebenden oder realistisch fotografierten Vertreter dieses Taxons (keine Karte, Zeichnung, Skelett, " +
    "Collage, kein anderes Tier/Pflanze)?; quality = 1–5 (Schärfe, Bildausschnitt, Erkennbarkeit " +
    "typischer Merkmale); note = sehr kurze Begründung auf Deutsch." });
  return generateJSON(parts, arr(obj({ index: I, shows_organism: B, quality: I, note: S })), 0);
}

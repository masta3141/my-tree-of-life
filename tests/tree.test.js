import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree } from "../js/tree.js";

const T = (key, name, rank) => ({ key, name, rank });
const EUK = T("dom:Eukaryota", "Eukaryota", "domain");
const ANI = T("1", "Animalia", "kingdom");
const PLA = T("6", "Plantae", "kingdom");
const CHO = T("44", "Chordata", "phylum");
const ART = T("54", "Arthropoda", "phylum");
const MAM = T("359", "Mammalia", "class");
const ARA = T("367", "Arachnida", "class");
const ARTIO = T("731", "Artiodactyla", "order");
const ROD = T("1459", "Rodentia", "order");
const TRA = T("7707728", "Tracheophyta", "phylum");
const QUE = T("2877951", "Quercus", "genus");
const QRO = T("2878688", "Quercus robur", "species");

const cow = (id = 1) => ({ id, label: "Kuh", lineage: [EUK, ANI, CHO, MAM, ARTIO, T("2441022", "Bos taurus", "species")] });
const squirrel = () => ({ id: 2, label: "Eichhörnchen", lineage: [EUK, ANI, CHO, MAM, ROD, T("8211070", "Sciurus vulgaris", "species")] });
const spider = () => ({ id: 3, label: "Spinne", lineage: [EUK, ANI, ART, ARA, T("1496", "Araneae", "order")] });
const oak = () => ({ id: 4, label: "Eiche", lineage: [EUK, PLA, TRA, QUE, QRO] });

// compact representation: taxon name or organism label, with children
const shape = (n) => {
  const name = n.type === "organism" ? n.label : n.taxon.name;
  return n.children.length ? [name, n.children.map(shape)] : name;
};

const MAMMALS = ["Mammalia", [["Artiodactyla", ["Kuh"]], ["Rodentia", ["Eichhörnchen"]]]];

test("empty", () => assert.equal(buildTree([]), null));

test("single organism is domain plus leaf", () => {
  const t = buildTree([cow()]);
  assert.deepEqual(shape(t), ["Eukaryota", ["Kuh"]]);
  assert.deepEqual(t.children[0].collapsed.map((c) => c.name), ["Animalia", "Chordata", "Mammalia", "Artiodactyla"]);
});

test("two mammals split at Mammalia with distinguishing orders", () => {
  assert.deepEqual(shape(buildTree([cow(), squirrel()])), ["Eukaryota", [MAMMALS]]);
});

test("spider adds Animalia split", () => {
  assert.deepEqual(shape(buildTree([cow(), squirrel(), spider()])),
    ["Eukaryota", [["Animalia", [["Arthropoda", [["Araneae", ["Spinne"]]]], ["Chordata", [MAMMALS]]]]]]);
});

test("plant splits at domain", () => {
  assert.deepEqual(shape(buildTree([cow(), squirrel(), spider(), oak()])),
    ["Eukaryota", [["Animalia", [["Arthropoda", [["Araneae", ["Spinne"]]]], ["Chordata", [MAMMALS]]]], ["Plantae", ["Eiche"]]]]);
});

test("genus and species both recorded", () => {
  const genus = { id: 5, label: "Eichen allgemein", lineage: [EUK, PLA, TRA, QUE] };
  const t = buildTree([oak(), genus]);
  assert.deepEqual(shape(t), ["Eukaryota", [["Quercus", ["Eichen allgemein", "Eiche"]]]]);
  const eiche = t.children[0].children[1];
  assert.equal(eiche.type, "organism");
  assert.deepEqual(eiche.collapsed, []);
});

test("duplicates share taxon node", () => {
  assert.deepEqual(shape(buildTree([cow(1), cow(9)])), ["Eukaryota", [["Bos taurus", ["Kuh", "Kuh"]]]]);
});

test("multiple domains get super root", () => {
  const bac = { id: 7, label: "E. coli", lineage: [T("dom:Bacteria", "Bacteria", "domain"), T("3", "Bacteria", "kingdom")] };
  assert.deepEqual(shape(buildTree([cow(), bac])), ["Leben", [["Bacteria", [["Bacteria", ["E. coli"]]]], ["Eukaryota", ["Kuh"]]]]);
});

test("organism identified only to phylum keeps its taxon node", () => {
  const TAR = T("14", "Tardigrada", "phylum");
  const tardi = { id: 8, label: "Bärtierchen", lineage: [EUK, ANI, TAR] };
  const t = buildTree([cow(), tardi]);
  assert.deepEqual(shape(t), ["Eukaryota", [["Animalia", [["Chordata", ["Kuh"]], ["Tardigrada", ["Bärtierchen"]]]]]]);
  const tarNode = t.children[0].children[1];
  assert.equal(tarNode.type, "taxon");
  assert.equal(tarNode.children[0].taxon.key, "14");
});

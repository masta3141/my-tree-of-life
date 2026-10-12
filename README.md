# 🌳 My Tree of Life

Ein persönlicher Stammbaum des Lebens – nur mit den Organismen, die **dich** interessieren.

Du erfasst einen Organismus per Text und/oder Foto („Eichhörnchen“, „die Kastanie vor dem Haus“, ein Pilzfoto …).
Gemini bestimmt ihn, die Systematik kommt aus dem [GBIF-Backbone](https://www.gbif.org/). Der Baum zeigt nur
die Knoten, die nötig sind, um deine Organismen voneinander zu unterscheiden – mit einem Organismus ist das nur
die Domäne, mit jedem weiteren wächst er genau dort, wo sich die Wege trennen.

## Funktionen

- Bestimmung per Text und/oder Bild (Gemini), Alternativen und manuelle Korrektur
- Minimaler Baum, Spalten nach Rang (Domäne, Reich, Stamm, Klasse, Ordnung, Familie …)
- Beschreibungen und kennzeichnende Merkmale für jeden Knoten
- Eigene Bilder pro Organismus, plus Suche nach frei lizenzierten Fotos bei iNaturalist und
  Wikimedia Commons (von Gemini bewertet, mit Urheber- und Lizenzangabe)
- Export/Import der Sammlung als Datei

## Datenschutz

Es gibt keinen Server. Deine Sammlung (inkl. Bilder) liegt in der IndexedDB **deines Browsers**, dein
Gemini-API-Key im `localStorage` – beides verlässt den Browser nur in Anfragen an Google (Gemini),
GBIF, iNaturalist und Wikimedia. Browser-Daten können verloren gehen (Löschen der Websitedaten, privates
Fenster) – nutze ab und zu **Exportieren**.

## Benutzung

1. Kostenlosen Gemini-API-Key erstellen: <https://aistudio.google.com/apikey>
2. Seite öffnen, ⚙ → Key eintragen
3. Organismen erfassen

### Lokal starten

Die Seite ist rein statisch (ES-Module, d3 von cdnjs), braucht aber einen Webserver (nicht `file://`):

```
python3 -m http.server 8000     # oder: npm start
```
→ <http://localhost:8000>

Tests der Baum-Logik: `npm test` (Node ≥ 20, keine Abhängigkeiten).

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | Oberfläche und Styles |
| `js/app.js` | UI-Logik, Baum-Darstellung (d3) |
| `js/store.js` | Datenhaltung (IndexedDB), Bestimmungsablauf, Export/Import |
| `js/tree.js` | Minimalbaum-Algorithmus |
| `js/gbif.js` | GBIF-Abfrage → Linie |
| `js/gemini.js` | Gemini-REST-Aufrufe |
| `js/images.js` | Bildsuche iNaturalist / Commons mit Lizenzfilter |
| `js/settings.js` | API-Key und Modell (pro Browser) |

## Bildlizenzen

Übernommene Fotos behalten ihre Lizenz (CC0, CC BY, CC BY-SA, Public Domain; bei iNaturalist auch
CC BY-NC/CC BY-NC-SA). Urheber, Lizenz und Quelle werden beim Bild angezeigt. Für kommerzielle Nutzung
die NC-Lizenzen in `js/images.js` entfernen.

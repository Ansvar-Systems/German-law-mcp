import type { LawDocument } from "../shell/types.js";

export const GERMAN_LEGISLATION: LawDocument[] = [
  {
    id: "bgb-823",
    country: "de",
    kind: "statute",
    title: "Buergerliches Gesetzbuch (BGB) - Schadensersatzpflicht",
    citation: "§ 823 Abs. 1 BGB",
    sourceUrl: "https://www.gesetze-im-internet.de/bgb/__823.html",
    effectiveDate: "1900-01-01",
    textSnippet:
      "Wer vorsatzlich oder fahrlaessig das Leben, den Koerper, die Gesundheit, die Freiheit, das Eigentum oder ein sonstiges Recht eines anderen widerrechtlich verletzt, ist dem anderen zum Ersatz des daraus entstehenden Schadens verpflichtet.",
    metadata: {
      source: "gesetze-im-internet",
      statute: "BGB",
    },
  },
  {
    id: "gg-art-1",
    country: "de",
    kind: "statute",
    title: "Grundgesetz (GG) - Menschenwuerde",
    citation: "Art. 1 Abs. 1 GG",
    sourceUrl: "https://www.gesetze-im-internet.de/gg/art_1.html",
    effectiveDate: "1949-05-23",
    textSnippet:
      "Die Wuerde des Menschen ist unantastbar. Sie zu achten und zu schuetzen ist Verpflichtung aller staatlichen Gewalt.",
    metadata: {
      source: "gesetze-im-internet",
      statute: "GG",
    },
  },
  {
    id: "stgb-242",
    country: "de",
    kind: "statute",
    title: "Strafgesetzbuch (StGB) - Diebstahl",
    citation: "§ 242 Abs. 1 StGB",
    sourceUrl: "https://www.gesetze-im-internet.de/stgb/__242.html",
    effectiveDate: "1872-01-01",
    textSnippet:
      "Wer eine fremde bewegliche Sache einem anderen in der Absicht wegnimmt, die Sache sich oder einem Dritten rechtswidrig zuzueignen, wird mit Freiheitsstrafe bis zu fuenf Jahren oder mit Geldstrafe bestraft.",
    metadata: {
      source: "gesetze-im-internet",
      statute: "StGB",
    },
  },
];

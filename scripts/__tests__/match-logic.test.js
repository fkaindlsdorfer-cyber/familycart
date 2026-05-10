import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchesArticleName } from "../lib/match.js";

const cases = [
  // #  listItem                dealName                                expected  note
  [1,  "Berner",               "Hirter Bernstein 1270",                false,   "Substring ohne Wortgrenze"],
  [2,  "Bier",                 "Schwechater Bier",                     true,    "Einzeltoken passt"],
  [3,  "Lavazza Kaffee",       "Kaffee & Tee -25%",                   true,    "letztes Token (kaffee >=5, nicht in Stop-Liste)"],
  [4,  "Lavazza Kaffee",       "Lavazza Crema e Aroma",               true,    "erstes Token (Marke, >=4, nicht in Stop-Liste)"],
  [5,  "Milch",                "Lidl Schärdinger Hafer-Milch",        true,    "Bindestrich = Wortgrenze"],
  [6,  "develey curry sauce",  "Seelachsfilet mit Sauce Tartare",     false,   "Phrase nicht zusammenhängend, sauce in Stop-Liste"],
  [7,  "develey curry sauce",  "Develey Curry Sauce 250ml",           true,    "Vollständige Phrase"],
  [8,  "Salat",                "Vega Vita Tuna-Salat",                true,    "Bindestrich = Wortgrenze"],
  [9,  "Zipfer Bier",          "0,3l Bier (Restaurant)",              false,   "Zipfer fehlt; bier in Stop-Liste und <5 Zeichen"],
  [10, "Manner",               "Manner Neapolitaner",                  true,    "Einzeltoken passt"],
  [11, "Wiener knusperbraten", "Wiener Schnitzel",                    false,   "wiener in Stop-Liste; knusperbraten fehlt"],
  [12, "Erdbeeren",            "Bristot Bauletti Erdbeere",           true,    "Plural-Stemming en→''"],
  [13, "Erdbeeren",            "Danone Actimel Erdbeere",             true,    "Plural-Stemming (bewusstes FP akzeptiert)"],
  [14, "Bananen",              "Bruno Banani Vanilla Muse Set",       false,   "banani kein Plural-Stem von bananen"],
  [15, "Bananen",              "Hauswirth Schokobananen",             false,   "kein Wortgrenzen-Match im Kompositum"],
  [16, "Zipfer Bier",          "Zipfer Urtyp",                         true,    "echter Marken-Match aus Log: Zipfer=6 Zeichen, sollte trotzdem matchen"],
  [17, "Loidl käswurst",       "Loidl Kantwurst",                      true,    "echter Marken-Match aus Log: Loidl=5 Zeichen, sollte trotzdem matchen"],
  [18, "Kinder Country",       "Ferrero Kinder Country",               true,    "Phrase-Match: ganze Phrase im Deal, Token-Längen irrelevant"],
];

describe("matchesArticleName", () => {
  for (const [nr, listItem, dealName, expected, note] of cases) {
    it(`#${nr}: "${listItem}" vs "${dealName}" → ${expected} (${note})`, () => {
      assert.equal(matchesArticleName(listItem, dealName), expected);
    });
  }
});
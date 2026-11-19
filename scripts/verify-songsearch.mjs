#!/usr/bin/env node
/**
 * Checks the saved-song title search (matchSongs) and the song addresses.
 *
 * Run with: node --experimental-strip-types scripts/verify-songsearch.mjs
 */
const mod = await import("../src/lib/songSearch.ts").catch((e) => {
  console.log(e);
  return null;
});
if (!mod) {
  console.log("run with: node --experimental-strip-types scripts/verify-songsearch.mjs");
  process.exit(1);
}
const { matchSongs, songHref, songsHref } = mod;

let failed = 0;
function check(what, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
}
const titles = (rows) => rows.map((r) => r.title);

const rows = [
  { title: "Bach Cello Suite No. 1" },
  { title: "Autumn Leaves" },
  { title: "Καλημέρα ήλιε" },
  { title: "Suite Bergamasque" },
];

check("exact title", JSON.stringify(titles(matchSongs(rows, "Autumn Leaves"))) === JSON.stringify(["Autumn Leaves"]));
check("partial word", titles(matchSongs(rows, "bergam")).join() === "Suite Bergamasque");
check("case-insensitive", titles(matchSongs(rows, "AUTUMN")).join() === "Autumn Leaves");
check("no match", matchSongs(rows, "zzz").length === 0);
check("empty query keeps all", matchSongs(rows, "").length === rows.length);
check("blank and null queries keep all", matchSongs(rows, "   ").length === rows.length && matchSongs(rows, null).length === rows.length);
check("every word must match, in any order", titles(matchSongs(rows, "suite cello")).join() === "Bach Cello Suite No. 1");
check("accents and final sigma are folded", titles(matchSongs(rows, "ΗΛΙΕ")).join() === "Καλημέρα ήλιε" && matchSongs(rows, "καλημερα").length === 1);
check("songHref escapes the id", songHref("a b") === "/studio?song=a%20b");
check("songsHref with and without a query", songsHref("a  b") === "/songs?q=a%20b" && songsHref("") === "/songs" && songsHref(null) === "/songs");

process.exit(failed ? 1 : 0);

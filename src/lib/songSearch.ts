/**
 * Finding a saved song by the words in its title, and the addresses that open one.
 *
 * My songs' search box and the assistant both filter through matchSongs, so the
 * "…and 12 more" link in a reply opens a list holding exactly those twelve —
 * the same list the player would get by typing the words into the box.
 */
import type { ChartRow } from "./store/charts";

/** Lower case, accents off, final sigma folded, single spaces: "Καλημέρα" finds "καλημερας". */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Songs whose title holds every word of `query`, in any order. A blank query keeps them all. */
export function matchSongs<T extends Pick<ChartRow, "title">>(rows: T[], query?: string | null): T[] {
  const words = fold(query ?? "").split(" ").filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const title = fold(r.title);
    return words.every((w) => title.includes(w));
  });
}

/** A saved song's own page: the studio, with that song open. */
export function songHref(id: string): string {
  return `/studio?song=${encodeURIComponent(id)}`;
}

/** My songs, searched for `query` as if it had been typed into the box. */
export function songsHref(query?: string | null): string {
  const q = (query ?? "").replace(/\s+/g, " ").trim();
  return q ? `/songs?q=${encodeURIComponent(q)}` : "/songs";
}

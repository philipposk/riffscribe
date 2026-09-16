/**
 * Links in replies. A reply may carry markdown links, `[label](href)`, written by a
 * capability's render() or by the model. This is the one place that reads them: the parser
 * the widget renders from, the check that decides whether an href may become a real link,
 * and the helpers for everything that wants the words without the URLs (the number check,
 * speech, copying).
 *
 * Syntax, deliberately small:
 *  - `[label](href)`. The label is one line and may hold balanced brackets
 *    (`[Taverna [Old] Port](/p/1)`); `\[` and `\]` are literal brackets and `\\` a literal
 *    backslash, so any label can be written — `markdownLink()` does the escaping.
 *  - The href has no whitespace. Balanced parentheses are part of it
 *    (`/wiki/Samos_(island)`); `\(` and `\)` are literal ones.
 *  - Outside a link, `\[` and `\]` are literal brackets.
 *  - An image, `![alt](src)`, is shown as its alt text: never loaded, never a link.
 *  - Anything else that looks almost like a link stays as written.
 */
export type ReplySegment = {
    type: "text";
    text: string;
} | {
    type: "link";
    label: string;
    href: string;
};
export interface LinkPolicy {
    /** The page's origin (`location.origin`); relative hrefs are checked against it. */
    origin?: string;
    /** Origins on which absolute http(s) links are also allowed, e.g. `["https://maps.example.com"]`. */
    linkOrigins?: string[];
}
/** Split a reply into plain text and links. Images come back as text (their alt). */
export declare function parseLinks(text: string): ReplySegment[];
/** The reply as it reads: every link replaced by its label. For speech, copying and checks. */
export declare function linkText(text: string): string;
/**
 * The href to put on a real link, or null when it must stay plain text.
 *
 * Allowed: a same-origin path — exactly one leading "/" — and, when `linkOrigins` lists
 * their origin, absolute http(s) URLs. Never a scheme like `javascript:` or `data:`, never
 * `//host`, and never whitespace, control characters or backslashes anywhere: browsers
 * strip or rewrite those, so `/\evil.com` and `/<tab>/evil.com` both lead to `//evil.com`.
 */
export declare function safeLinkHref(href: string, policy?: LinkPolicy): string | null;
/** Escape text so it can never be read as a link (brackets become `\[` `\]`). */
export declare function escapeLinkText(s: string): string;
/**
 * Write a link that always parses back to exactly this label and href, whatever the label
 * holds (brackets, "](", a trailing backslash). Whitespace in the href is percent-encoded.
 *
 *   render: (r) => r.places.map((p) => markdownLink(p.name, `/places/${p.slug}`)).join(", ")
 */
export declare function markdownLink(label: string, href: string): string;
/**
 * Apply a text rewrite to a reply without breaking its links. `rewrite` runs over the text
 * around the links and over each label on its own. An href is never rewritten: if
 * `checkHref` (default: `rewrite`) would change it — a credential in a query string, an
 * internal name in a path — the link is dropped and only its label is kept.
 *
 * Returns `null` when the text has links but they could not be kept apart (a rewrite
 * removed or copied a placeholder); the caller should then rewrite the text as a whole.
 */
export declare function rewriteAroundLinks(text: string, rewrite: (s: string) => string, checkHref?: (s: string) => string): string | null;

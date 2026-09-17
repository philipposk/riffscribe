// Assistant replies with links in them. The parser and the safety rule live in core
// (parseLinks, safeLinkHref); this builds the DOM for one reply and follows a click.
// Nodes are made with createElement/createTextNode and textContent only — reply text is
// never parsed as HTML.
import { parseLinks, safeLinkHref, linkText } from "@page-assistant/core";
/** Append `text` to `parent`: plain text as text nodes, safe links as `<a>`, the rest as their label. */
export function renderReply(parent, text, opts = {}) {
    const doc = parent.ownerDocument ?? document;
    const origin = typeof location !== "undefined" ? location.origin : undefined;
    for (const seg of parseLinks(text)) {
        if (seg.type === "text") {
            parent.appendChild(doc.createTextNode(seg.text));
            continue;
        }
        const href = safeLinkHref(seg.href, { origin, linkOrigins: opts.linkOrigins });
        if (!href) {
            parent.appendChild(doc.createTextNode(seg.label));
            continue;
        }
        const a = doc.createElement("a");
        a.href = href;
        a.textContent = seg.label;
        a.addEventListener("click", (e) => {
            // Cmd/Ctrl/Shift/middle click: the browser opens a new tab or window, as on any link.
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
                return;
            e.preventDefault();
            followLink(href, opts.onNavigate);
            opts.onFollowed?.(href);
        });
        parent.appendChild(a);
    }
}
const REPLY_EXCERPT_MAX = 120;
/**
 * A reply as a short plain-text excerpt, for the closed-panel notification bubble
 * (`ask()`'s reply preview). Links read as their label — never a raw URL — whitespace is
 * collapsed, and anything past `max` characters is cut with a trailing "…".
 */
export function replyExcerpt(text, max = REPLY_EXCERPT_MAX) {
    const plain = linkText(text).replace(/\s+/g, " ").trim();
    return plain.length > max ? plain.slice(0, max).trimEnd() + "…" : plain;
}
/** Navigate with the host's handler; if it throws or rejects, do a normal page load. */
export function followLink(href, onNavigate) {
    const load = () => window.location.assign(href);
    if (!onNavigate)
        return load();
    try {
        const r = onNavigate(href);
        if (r && typeof r.then === "function")
            r.catch(load);
    }
    catch {
        load();
    }
}

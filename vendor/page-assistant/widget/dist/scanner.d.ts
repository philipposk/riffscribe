import type { PageMap } from "@page-assistant/core";
/**
 * Read the current page: collect headings, links, and interactive controls with stable
 * selectors. This is the "blind" mode that lets the assistant understand an app it was
 * not explicitly integrated into. Integrated hosts also benefit: scan output seeds the
 * model's understanding of what's clickable.
 */
export declare function scanPage(doc?: Document): PageMap["controls"];
/** A first-visit full scan: this page plus same-origin nav links (one level deep). */
export declare function fullScan(doc?: Document, maxPages?: number): Promise<PageMap>;

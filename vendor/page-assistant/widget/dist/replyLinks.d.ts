export interface ReplyLinkOptions {
    /** Origins on which absolute http(s) links are allowed, besides same-origin paths. */
    linkOrigins?: string[];
    /** The host's navigation (an SPA router's push). Without it: `location.assign`. */
    onNavigate?: (href: string) => void | Promise<unknown>;
    /** Called after a link was followed in this page (not for new-tab clicks). */
    onFollowed?: (href: string) => void;
}
/** Append `text` to `parent`: plain text as text nodes, safe links as `<a>`, the rest as their label. */
export declare function renderReply(parent: HTMLElement, text: string, opts?: ReplyLinkOptions): void;
/** Navigate with the host's handler; if it throws or rejects, do a normal page load. */
export declare function followLink(href: string, onNavigate?: (href: string) => void | Promise<unknown>): void;

/**
 * Rewrites applied to every user-facing reply, so configuration and internals the host
 * never meant to show do not reach the user: credentials, connection strings, environment
 * variable names, and whatever the host adds (internal system names, old product names).
 *
 * A reply mixes model prose with host-written render() output and raw error text from
 * run(), so no single author can be trusted to keep these out; this runs last, on the
 * final text.
 */
/**
 * `[pattern, replacement]`. A string pattern matches as a whole word, case-insensitively;
 * a RegExp is used as given (made global). The replacement may use `$1`-style groups.
 */
export type ScrubRule = [pattern: string | RegExp, replacement: string];
/** On by default. Nothing here is ever useful to the person reading the reply. */
export declare const DEFAULT_SCRUB_RULES: ScrubRule[];
/**
 * For surfaces that render replies as plain text (the widget does): markdown emphasis and
 * inline code would otherwise show as literal `**` and backticks.
 */
export declare const PLAIN_TEXT_SCRUB_RULES: ScrubRule[];
/** Apply `rules` in order. */
export declare function scrubText(text: string, rules: ScrubRule[]): string;

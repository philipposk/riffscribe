/**
 * Factory for procedural "how does this field work?" capabilities.
 *
 * Host apps use these when an explanation depends on org state — greyed-out
 * fields, optional modules, missing setup — so the model must not guess.
 * Answers are marked `verbatim: true` so the grounding validator keeps the
 * host's wording.
 */
export function explainUiCapability(opts) {
    return {
        name: opts.name,
        description: opts.description,
        parameters: { type: "object", properties: {} },
        tags: opts.tags ?? ["help"],
        verbatim: true,
        enabled: opts.enabled,
        async run() {
            return await opts.run();
        },
        render: opts.render,
    };
}
/**
 * Merge a screen hint into `getPageState()` output so the model knows which
 * explain capability to run on this view.
 */
export function pageStateHint(base, hint) {
    return { ...base, hint };
}

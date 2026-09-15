export interface ModelChoice {
    id: string;
    label: string;
    provider?: string;
}
export interface ModelCatalog {
    /** Models this server can actually serve (it has the provider key). */
    models: ModelChoice[];
    /** True when the server ignores the client's `model` and uses its own. */
    fixed: boolean;
    /** Optional server-supplied explanation, shown in place of the picker. */
    reason?: string;
}
/**
 * Ask `GET {serverUrl}/v1/models`.
 *
 * Degrades the safe way: any failure (404, network, bad JSON, an older server that only
 * returns `{models}`) resolves to the built-in list with `fixed: false`, so a server that
 * predates this endpoint still shows a working picker. A server that says `fixed` wins.
 */
export declare function fetchModelCatalog(serverUrl: string | undefined, signal?: AbortSignal, authToken?: string): Promise<ModelCatalog>;

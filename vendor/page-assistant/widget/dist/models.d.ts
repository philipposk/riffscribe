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
 * A server that does not answer (404, network, bad JSON, no serverUrl) is taken to fix the
 * model: most hosts proxy through their own route, which ignores the client's `model`, so a
 * picker there changed nothing. Only a server that lists models gets one; an older server
 * that returns just `{models}` still does. A server that says `fixed` wins.
 */
export declare function fetchModelCatalog(serverUrl: string | undefined, signal?: AbortSignal, authToken?: string): Promise<ModelCatalog>;

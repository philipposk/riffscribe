// What the server will actually honour for `model`.
//
// The picker used to be a hardcoded list shown unconditionally. On a deployment that pins
// the model server-side — which an unauthenticated proxy has to do, or a visitor could
// upgrade themselves onto a costlier model — choosing from it changed nothing at all.
import { DEFAULT_MODELS } from "./assistant-settings.js";
/**
 * Ask `GET {serverUrl}/v1/models`.
 *
 * Degrades the safe way: any failure (404, network, bad JSON, an older server that only
 * returns `{models}`) resolves to the built-in list with `fixed: false`, so a server that
 * predates this endpoint still shows a working picker. A server that says `fixed` wins.
 */
export async function fetchModelCatalog(serverUrl, signal, authToken) {
    const fallback = { models: [...DEFAULT_MODELS], fixed: false };
    if (!serverUrl || typeof fetch === "undefined")
        return fallback;
    const base = serverUrl.replace(/\/$/, "");
    try {
        const headers = {};
        if (authToken)
            headers.authorization = `Bearer ${authToken}`;
        const res = await fetch(`${base}/v1/models`, { signal, headers });
        if (!res.ok)
            return fallback;
        const raw = (await res.json());
        const models = Array.isArray(raw?.models)
            ? raw.models
                .filter((m) => !!m && typeof m.id === "string")
                .map((m) => ({ id: m.id, label: typeof m.label === "string" && m.label ? m.label : m.id, provider: m.provider }))
            : [];
        return {
            models: models.length ? models : fallback.models,
            fixed: raw?.fixed === true,
            reason: typeof raw?.reason === "string" && raw.reason.trim() ? raw.reason : undefined,
        };
    }
    catch {
        return fallback;
    }
}

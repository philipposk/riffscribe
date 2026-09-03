/** Lightweight client analytics — local event log + optional server beacon. */
const LOCAL_KEY = "page_assistant_analytics";
const MAX_EVENTS = 500;
export function trackEvent(type, meta, serverUrl, authToken) {
    const ev = { type, ts: new Date().toISOString(), meta };
    appendLocal(ev);
    if (serverUrl) {
        const headers = { "content-type": "application/json" };
        // /v1/analytics is guarded when PA_AUTH_TOKEN is set — without the bearer the POST 401s
        // and analytics silently vanish.
        if (authToken)
            headers.authorization = `Bearer ${authToken}`;
        fetch(`${serverUrl.replace(/\/$/, "")}/v1/analytics`, {
            method: "POST",
            headers,
            body: JSON.stringify(ev),
            keepalive: true,
        }).catch(() => { });
    }
}
function appendLocal(ev) {
    if (typeof localStorage === "undefined")
        return;
    try {
        const list = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
        list.push(ev);
        localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(-MAX_EVENTS)));
    }
    catch {
        /* ignore */
    }
}
export function getLocalAnalytics() {
    if (typeof localStorage === "undefined")
        return [];
    try {
        return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
    }
    catch {
        return [];
    }
}
export function exportAnalyticsMarkdown() {
    const events = getLocalAnalytics();
    const lines = ["# Page Assistant Analytics", "", `Exported: ${new Date().toISOString()}`, ""];
    for (const e of events.slice(-100)) {
        lines.push(`- **${e.type}** @ ${e.ts}${e.meta ? ` — ${JSON.stringify(e.meta)}` : ""}`);
    }
    return lines.join("\n");
}

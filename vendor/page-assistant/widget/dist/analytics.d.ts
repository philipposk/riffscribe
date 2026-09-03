/** Lightweight client analytics — local event log + optional server beacon. */
export interface AnalyticsEvent {
    type: string;
    ts: string;
    meta?: Record<string, unknown>;
}
export declare function trackEvent(type: string, meta?: Record<string, unknown>, serverUrl?: string, authToken?: string): void;
export declare function getLocalAnalytics(): AnalyticsEvent[];
export declare function exportAnalyticsMarkdown(): string;

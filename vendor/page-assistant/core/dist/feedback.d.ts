import type { ChatResponse } from "./types.js";
export type TicketKind = "missing_capability" | "error" | "hallucination_caught" | "confusion" | "suggestion" | "success" | "other";
export interface Ticket {
    app: string;
    source: string;
    kind: TicketKind;
    summary: string;
    detail?: string;
    context?: {
        url?: string;
        path?: string;
        capability?: string;
        request?: string;
    };
    severity?: "low" | "med" | "high";
    createdAt?: string;
}
export interface TicketStore {
    save(t: Ticket): Promise<void> | void;
    list(limit?: number): Promise<Ticket[]> | Ticket[];
}
/** Default in-memory store. Swap for a DB/file store in production. */
export declare class MemoryTicketStore implements TicketStore {
    private maxTickets;
    private tickets;
    constructor(maxTickets?: number);
    save(t: Ticket): void;
    list(limit?: number): Ticket[];
}
/** Validate + normalize an incoming ticket payload (untrusted input). */
export declare function normalizeTicket(body: unknown): Ticket | {
    error: string;
};
/**
 * Auto-derive tickets from one assistant turn. This is what makes the loop self-improving
 * WITHOUT relying on the other agent being polite: errors, caught hallucinations, and
 * unmet requests become tickets automatically.
 */
export declare function ticketsFromRun(app: string, source: string, request: string, res: ChatResponse): Ticket[];
/**
 * Flood guard for auto-derived tickets. The /v1/agent loop derives a `missing_capability`
 * ticket every time no capability matched — an agent looping on the same failing request
 * would otherwise write the same ticket thousands of times. This collapses identical
 * derived tickets seen within `windowMs` down to the first occurrence.
 */
export declare function makeTicketFloodGuard(opts?: {
    windowMs?: number;
    max?: number;
}): (t: Ticket) => boolean;
/** The /.well-known/agent-feedback.json discovery document. */
export declare function feedbackWellKnown(app: string, feedbackEndpoint: string): {
    schemaVersion: string;
    app: string;
    feedbackEndpoint: string;
    method: string;
    please: string;
    ticketSchema: {
        summary: string;
        kind: string;
        detail: string;
        severity: string;
        source: string;
        context: string;
    };
};
/** Client helper: send a ticket to an app's feedback endpoint. */
export declare function sendTicket(feedbackEndpoint: string, ticket: Ticket): Promise<boolean>;

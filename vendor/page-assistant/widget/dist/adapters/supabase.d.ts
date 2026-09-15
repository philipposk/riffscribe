import type { ChatHistoryAdapter } from "../chatHistoryAccount.js";
/** The parts of a supabase-js v2 client this adapter calls. */
export interface SupabaseClientLike {
    from(table: string): any;
    auth: {
        getSession(): Promise<{
            data: {
                session: {
                    user: {
                        id: string;
                    };
                } | null;
            };
            error?: unknown;
        }>;
    };
}
export interface SupabaseChatHistoryOptions {
    /** Default "assistant_chats". */
    table?: string;
    /** Keeps apps or workspaces that share one table apart. Stored in the `app` column. Default "". */
    app?: string;
    /**
     * Chats with no activity for this many months are left out of the list and deleted when
     * the user next opens the assistant. Default 12; `false` turns it off. This covers only
     * users who come back: schedule the SQL retention function for everyone else.
     */
    retentionMonths?: number | false;
    /** Most chats listed. Default 500. */
    listLimit?: number;
}
export declare function supabaseChatHistoryAdapter(client: SupabaseClientLike, opts?: SupabaseChatHistoryOptions): ChatHistoryAdapter;

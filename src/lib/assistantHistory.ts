/**
 * Where the assistant keeps its chats.
 *
 * Signed in, chats are saved to the player's account, in riffscribe_assistant_chats,
 * so a chat started on the laptop is there on the tablet on the music stand. Signed
 * out — or on a deployment with no Supabase project — they stay in this browser, as
 * they always have. The player can change that in the assistant's settings (Data
 * tab): their account, this device only, or not saved at all; and delete one chat or
 * all of them.
 *
 * Only the browser client is used, with the player's own session. Row-level security
 * (supabase/assistant_chats.sql) limits every read and write to their own rows.
 *
 * Saved chats with no activity for 12 months are deleted: daily by the database, and
 * by the adapter itself for the player's own chats whenever they open the assistant.
 *
 * The widget is loaded lazily, so its adapter factory is passed in rather than
 * imported here — importing it would pull the whole widget into the page bundle.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ChatHistoryAdapter, SupabaseChatHistoryOptions, SupabaseClientLike,
} from "@page-assistant/widget";

export const ASSISTANT_CHATS_TABLE = "riffscribe_assistant_chats";
export const ASSISTANT_CHATS_APP = "riffscribe";
export const ASSISTANT_CHATS_RETENTION_MONTHS = 12;

type AdapterFactory = (client: SupabaseClientLike, opts?: SupabaseChatHistoryOptions) => ChatHistoryAdapter;

/** The account adapter, or undefined when saving is not configured on this deployment. */
export function assistantChatHistory(
  client: SupabaseClient | null,
  makeAdapter: AdapterFactory,
): ChatHistoryAdapter | undefined {
  if (!client) return undefined;
  const adapter = makeAdapter(client, {
    table: ASSISTANT_CHATS_TABLE,
    app: ASSISTANT_CHATS_APP,
    retentionMonths: ASSISTANT_CHATS_RETENTION_MONTHS,
  });
  return {
    ...adapter,
    /**
     * Who is signed in, from the session this browser already holds — no network
     * round trip. Null means nobody, and the widget falls back to this device.
     *
     * It also keeps device-saved chats apart per person: on a shared computer each
     * player sees only their own, and chats made while signed out are offered to
     * whoever signs in only with wording that says they may not be theirs.
     */
    async currentUserId() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data.session?.user.id ?? null;
    },
  };
}

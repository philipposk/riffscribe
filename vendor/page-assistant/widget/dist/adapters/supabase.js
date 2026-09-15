// Reference ChatHistoryAdapter for Supabase.
//
// Pass the supabase-js client your app already signs users in with — never a service-role
// client. Every query runs as the signed-in user, and the table's row-level security
// (packages/widget/supabase/assistant_chats.sql) limits each user to their own rows.
//
// No dependency on supabase-js: the client is typed by the few methods used here.
const LIST_COLUMNS = "id,title,pinned,archived,group_id,model,created_at,updated_at";
/** The table's primary key. A chat id is only unique within one user's chats in one app. */
const CONFLICT_KEY = "user_id,app,id";
function fromRow(r) {
    const out = {
        id: String(r.id),
        title: r.title ?? "",
        pinned: !!r.pinned,
        archived: !!r.archived,
        groupId: r.group_id ?? null,
        model: r.model ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
    if (Array.isArray(r.messages))
        out.messages = r.messages;
    return out;
}
function toError(e) {
    if (e instanceof Error)
        return e;
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    return new Error(`chat history: ${msg}`);
}
export function supabaseChatHistoryAdapter(client, opts = {}) {
    const table = opts.table ?? "assistant_chats";
    const app = opts.app ?? "";
    const months = opts.retentionMonths === false ? undefined : (opts.retentionMonths ?? 12);
    const limit = opts.listLimit ?? 500;
    const userId = async () => {
        const { data, error } = await client.auth.getSession();
        if (error)
            throw toError(error);
        return data?.session?.user?.id ?? null;
    };
    const requireUser = async () => {
        const id = await userId();
        if (!id)
            throw new Error("chat history: nobody is signed in");
        return id;
    };
    const run = async (query) => {
        const { data, error } = await query;
        if (error)
            throw toError(error);
        return data;
    };
    const cutoff = () => {
        if (!months)
            return undefined;
        const d = new Date();
        d.setMonth(d.getMonth() - months);
        return d.toISOString();
    };
    const toRow = (c, uid) => ({
        id: c.id,
        user_id: uid,
        app,
        title: c.title,
        messages: c.messages,
        pinned: !!c.pinned,
        archived: !!c.archived,
        group_id: c.groupId ?? null,
        model: c.model ?? null,
        created_at: c.createdAt,
        updated_at: c.updatedAt,
    });
    return {
        retentionMonths: months,
        currentUserId: userId,
        async list() {
            const uid = await requireUser();
            const since = cutoff();
            if (since) {
                // Best effort: the scheduled SQL job is the real enforcement.
                try {
                    await run(client.from(table).delete().eq("user_id", uid).eq("app", app).lt("updated_at", since));
                }
                catch {
                    /* listing matters more than pruning */
                }
            }
            let q = client.from(table).select(LIST_COLUMNS).eq("user_id", uid).eq("app", app);
            if (since)
                q = q.gte("updated_at", since);
            const rows = await run(q.order("updated_at", { ascending: false }).limit(limit));
            return (rows ?? []).map(fromRow);
        },
        async get(id) {
            const uid = await requireUser();
            const row = await run(client.from(table).select("*").eq("user_id", uid).eq("app", app).eq("id", id).maybeSingle());
            if (!row)
                return null;
            const chat = fromRow(row);
            return { ...chat, messages: chat.messages ?? [] };
        },
        async save(chat) {
            const uid = await requireUser();
            await run(client.from(table).upsert(toRow(chat, uid), { onConflict: CONFLICT_KEY }));
        },
        async saveMany(chats) {
            if (!chats.length)
                return;
            const uid = await requireUser();
            await run(client.from(table).upsert(chats.map((c) => toRow(c, uid)), { onConflict: CONFLICT_KEY }));
        },
        async delete(id) {
            const uid = await requireUser();
            await run(client.from(table).delete().eq("user_id", uid).eq("app", app).eq("id", id));
        },
        async deleteAll() {
            const uid = await requireUser();
            await run(client.from(table).delete().eq("user_id", uid).eq("app", app));
        },
    };
}

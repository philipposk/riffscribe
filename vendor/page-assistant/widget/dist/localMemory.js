const KEY = "page-assistant-memory";
const MAX_FACTS = 200;
/**
 * localStorage-backed memory so the assistant remembers users ACROSS visits (the in-memory
 * store forgets on every page load). Same keyword recall as core's InMemoryStore.
 */
export class LocalMemoryStore {
    load() {
        try {
            return JSON.parse(localStorage.getItem(KEY) ?? "[]");
        }
        catch {
            return [];
        }
    }
    persist(facts) {
        try {
            localStorage.setItem(KEY, JSON.stringify(facts.slice(-MAX_FACTS)));
        }
        catch {
            /* quota exceeded / private mode — degrade to session-only */
        }
    }
    remember(fact) {
        const facts = this.load();
        facts.push({ ...fact, id: String(facts.length + 1), createdAt: new Date().toISOString() });
        this.persist(facts);
    }
    recall(query, limit = 5) {
        const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
        return this.load()
            .map((f) => ({
            f,
            score: terms.reduce((s, t) => s + (`${f.topic} ${f.content}`.toLowerCase().includes(t) ? 1 : 0), 0),
        }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((x) => x.f);
    }
}

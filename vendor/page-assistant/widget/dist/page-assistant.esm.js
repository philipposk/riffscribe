var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/fileUpload.ts
var fileUpload_exports = {};
__export(fileUpload_exports, {
  formatAttachmentsForPrompt: () => formatAttachmentsForPrompt,
  readFileAttachment: () => readFileAttachment
});
async function readFileAttachment(file, opts = {}) {
  if (file.type.startsWith("image/")) {
    if (!opts.imagesEnabled) {
      return { error: "Images aren't supported yet \u2014 I can't see attached pictures. Try describing it or attach a text file." };
    }
    if (file.size > MAX_IMAGE_BYTES) return { error: "Image too large (max 2MB)" };
    const b64 = await fileToDataUrl(file);
    return { name: file.name, mime: file.type, content: b64, kind: "image" };
  }
  if (TEXT_TYPES.has(file.type) || TEXT_EXT.test(file.name)) {
    if (file.size > MAX_TEXT_BYTES) return { error: "File too large (max 100KB text)" };
    const text = await file.text();
    return { name: file.name, mime: file.type || "text/plain", content: text, kind: "text" };
  }
  return { error: `Unsupported file type: ${file.type || file.name}` };
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsDataURL(file);
  });
}
function formatAttachmentsForPrompt(text, attachments) {
  if (!attachments.length) return text;
  const parts = [text];
  for (const a of attachments) {
    if (a.kind === "text") {
      parts.push(`

--- File: ${a.name} ---
${a.content.slice(0, 8e3)}`);
    } else {
      parts.push(`

[Attached image "${a.name}" (${a.mime}). Data URL follows]
${a.content}`);
    }
  }
  return parts.join("");
}
var MAX_TEXT_BYTES, MAX_IMAGE_BYTES, TEXT_TYPES, TEXT_EXT;
var init_fileUpload = __esm({
  "src/fileUpload.ts"() {
    "use strict";
    MAX_TEXT_BYTES = 1e5;
    MAX_IMAGE_BYTES = 2e6;
    TEXT_TYPES = /* @__PURE__ */ new Set([
      "text/plain",
      "text/markdown",
      "text/csv",
      "application/json",
      "application/javascript",
      "text/html",
      "text/css"
    ]);
    TEXT_EXT = /\.(txt|md|csv|json|js|ts|tsx|jsx|html|css|yaml|yml|xml|log)$/i;
  }
});

// ../core/dist/grounding.js
var MAX_TOOL_ROUNDS = 6;
var DEFAULT_HISTORY_WINDOW = 20;
function historyWindow() {
  const raw = Number(typeof process !== "undefined" && process.env?.PA_HISTORY_WINDOW || DEFAULT_HISTORY_WINDOW);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_HISTORY_WINDOW;
}
function windowMessages(messages, window2) {
  if (messages.length <= window2)
    return messages;
  let start = messages.length - window2;
  while (start > 0 && messages[start].role === "tool")
    start--;
  return messages.slice(start);
}
var uid = 0;
function genToolCallId() {
  return `tc_${Date.now().toString(36)}_${(uid++).toString(36)}`;
}
var Assistant = class {
  constructor(opts) {
    __publicField(this, "opts");
    __publicField(this, "caps");
    this.opts = opts;
    this.caps = new Map(opts.capabilities.map((c) => [c.name, c]));
  }
  get capabilities() {
    return [...this.caps.values()];
  }
  /** Fold in extra knowledge discovered at runtime (e.g. fetched README / llm.txt). */
  setKnowledge(text) {
    this.opts.knowledge = [this.opts.knowledge, text].filter(Boolean).join("\n\n").slice(0, 6e3);
  }
  systemPrompt(page, recalled = []) {
    const app = this.opts.appName ?? "this app";
    const lines = [
      `You are the in-app assistant for ${app}. You help the user by calling the app's real capabilities.`,
      `RULES:`,
      `- You can only do things by calling a listed capability. Never claim you did something you did not call.`,
      `- Never invent numbers, names, or results. If a capability returns data, report exactly what it returned.`,
      `- If you lack a capability for the request, say so plainly and suggest what the user can do.`,
      `- For capabilities marked confirm, describe what will happen and wait for the user to approve before calling.`,
      `- Be concise. Prefer doing the action over describing it.`,
      `Current page: ${page.title ?? page.path} (${page.path}).`
    ];
    if (page.state && Object.keys(page.state).length) {
      lines.push(`Page state: ${JSON.stringify(page.state).slice(0, 800)}`);
    }
    if (page.map) {
      lines.push(`This page was scanned. Known controls: ${page.map.controls.slice(0, 25).map((c) => `${c.kind}:${c.label}`).join(", ")}.`);
    }
    if (this.opts.persona)
      lines.push(this.opts.persona);
    if (recalled.length)
      lines.push(`Things you remember about this user (from earlier sessions):
${recalled.map((r) => `- ${r}`).join("\n")}`);
    if (this.opts.knowledge)
      lines.push(`
What this app is (background \u2014 use it to understand requests, not as facts to quote verbatim):
${this.opts.knowledge.slice(0, 4e3)}`);
    if (this.opts.suggestions?.length)
      lines.push(`If the user seems unsure what to do, offer one of: ${this.opts.suggestions.slice(0, 6).join("; ")}.`);
    return lines.join("\n");
  }
  toolSpecs() {
    return this.capabilities.map((c) => ({
      name: c.name,
      description: c.description + (c.confirm ? " (requires user confirmation)" : ""),
      parameters: { ...c.parameters, additionalProperties: false }
    }));
  }
  async chat(req) {
    const caller = req.caller ?? "user";
    const messages = [...req.history ?? [], { role: "user", content: req.message }];
    const invocations = [];
    const forced = forcedFactualTool(req.message, this.capabilities);
    let corrected = false;
    const usage = { promptTokens: 0, completionTokens: 0, provider: void 0 };
    const window2 = historyWindow();
    let recalled = [];
    try {
      recalled = (await this.opts.memory.recall(req.message, 4)).map((f) => `${f.topic}: ${f.content}`);
    } catch {
    }
    const accUsage = (u, provider) => {
      if (u?.promptTokens)
        usage.promptTokens += u.promptTokens;
      if (u?.completionTokens)
        usage.completionTokens += u.completionTokens;
      if (provider)
        usage.provider = provider;
    };
    const finalUsage = () => usage.promptTokens || usage.completionTokens || usage.provider ? { ...usage } : void 0;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const out = await this.opts.llm.complete({
        system: this.systemPrompt(req.page, recalled),
        messages: windowMessages(messages, window2),
        tools: this.toolSpecs(),
        forceTool: round === 0 ? forced : void 0,
        temperature: forced ? 0 : 0.3
      });
      accUsage(out.usage, out.provider);
      if (!out.toolCalls.length) {
        const { text, wasCorrected } = validateFactualText(out.text, invocations);
        corrected = corrected || wasCorrected;
        return { message: text, invocations, corrected, usage: finalUsage() };
      }
      const turnCalls = out.toolCalls.map((c) => ({ id: c.id ?? genToolCallId(), name: c.name, args: c.args }));
      messages.push({ role: "assistant", content: out.text ?? "", toolCalls: turnCalls });
      for (const call of turnCalls) {
        const cap = this.caps.get(call.name);
        if (!cap) {
          invocations.push({ name: call.name, args: call.args, ok: false, error: "unknown capability" });
          messages.push({ role: "tool", toolName: call.name, toolCallId: call.id, content: `ERROR: no such capability` });
          continue;
        }
        if (cap.confirm) {
          return {
            message: `Confirm this action? ${cap.description}`,
            invocations,
            pendingConfirmation: {
              name: cap.name,
              args: call.args,
              preview: `${cap.name}(${JSON.stringify(call.args)})`
            },
            corrected,
            usage: finalUsage()
          };
        }
        const problem = validateArgs(call.args, cap.parameters);
        if (problem) {
          invocations.push({ name: cap.name, args: call.args, ok: false, error: problem });
          messages.push({ role: "tool", toolName: cap.name, toolCallId: call.id, content: `ERROR: ${problem}` });
          continue;
        }
        const inv = await this.execute(cap, call.args, req.page, caller);
        invocations.push(inv);
        messages.push({
          role: "tool",
          toolName: cap.name,
          toolCallId: call.id,
          content: inv.ok ? inv.rendered ?? JSON.stringify(inv.result) : `ERROR: ${inv.error}`
        });
      }
    }
    const last = [...invocations].reverse().find((i) => i.ok && i.rendered);
    return {
      message: last?.rendered ?? "I could not complete that. Please try rephrasing.",
      invocations,
      corrected,
      usage: finalUsage()
    };
  }
  /** Execute a confirmed capability (called after user approves a pendingConfirmation). */
  async confirmAndRun(name, args, page) {
    const cap = this.caps.get(name);
    if (!cap)
      return { message: "That action is no longer available.", invocations: [] };
    const inv = await this.execute(cap, args, page, "user");
    return { message: inv.ok ? inv.rendered ?? "Done." : `That failed: ${inv.error}`, invocations: [inv] };
  }
  async execute(cap, rawArgs, page, caller) {
    const args = coerceArgTypes(stripUnknownKeys(rawArgs, cap.parameters), cap.parameters);
    try {
      const result = await cap.run(args, { page, memory: this.opts.memory, caller });
      return {
        name: cap.name,
        args,
        ok: true,
        result,
        rendered: cap.render ? cap.render(result, args) : void 0
      };
    } catch (e) {
      return { name: cap.name, args, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
};
function coerceArgTypes(args, schema) {
  const props = schema.properties;
  if (!props)
    return args;
  const out = { ...args };
  for (const [k, spec] of Object.entries(props)) {
    const want = spec.type;
    const v = out[k];
    if ((want === "number" || want === "integer") && typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      const num = Number(v);
      out[k] = want === "integer" ? Math.trunc(num) : num;
    }
  }
  return out;
}
function stripUnknownKeys(args, schema) {
  if (!schema.properties)
    return args;
  const allowed = new Set(Object.keys(schema.properties));
  const out = {};
  for (const [k, v] of Object.entries(args))
    if (allowed.has(k))
      out[k] = v;
  return out;
}
function validateArgs(args, schema) {
  const props = schema.properties ?? {};
  const required = schema.required ?? [];
  const missing = required.filter((k) => args[k] === void 0 || args[k] === null || args[k] === "");
  if (missing.length) {
    return `missing required argument(s): ${missing.join(", ")}. Provide ${missing.map((k) => `"${k}"`).join(", ")} and call again.`;
  }
  for (const [k, spec] of Object.entries(props)) {
    if (args[k] === void 0 || args[k] === null)
      continue;
    const want = spec.type;
    if (!want)
      continue;
    const got = jsonType(args[k]);
    const coercible = want === "number" && got === "string" && args[k] !== "" && !Number.isNaN(Number(args[k]));
    if (!coercible && !typeMatches(want, got)) {
      return `argument "${k}" must be a ${want} (got ${got}). Fix it and call again.`;
    }
  }
  return null;
}
function jsonType(v) {
  if (Array.isArray(v))
    return "array";
  if (v === null)
    return "null";
  return typeof v;
}
function typeMatches(want, got) {
  if (want === "integer")
    return got === "number";
  return want === got;
}
function forcedFactualTool(message, caps) {
  const m = message.toLowerCase();
  const factualIntent = /\b(how many|how tall|what is the|simulate|run|calculate|predict|best|compare|show me)\b/.test(m);
  if (!factualIntent)
    return void 0;
  const scored = caps.map((c) => ({ c, score: overlapScore(m, `${c.name} ${c.description}`.toLowerCase()) })).filter((s) => s.score >= 2).sort((a, b) => b.score - a.score);
  if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score))
    return scored[0].c.name;
  return void 0;
}
function overlapScore(a, b) {
  const words = new Set(a.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
  let s = 0;
  for (const w of words)
    if (b.includes(w))
      s++;
  return s;
}
function validateFactualText(text, invocations) {
  const rendered = invocations.filter((i) => i.ok && i.rendered).map((i) => i.rendered);
  if (!rendered.length)
    return { text, wasCorrected: false };
  const trusted = [];
  const trustedNumbers = /* @__PURE__ */ new Set();
  for (const r of rendered)
    for (const n of r.replace(/(\d),(\d)/g, "$1$2").match(/\d+(\.\d+)?/g) ?? []) {
      trustedNumbers.add(n);
      trusted.push(Number(n));
    }
  const isHonest = (n) => {
    if (trustedNumbers.has(n))
      return true;
    const num = Number(n);
    return trusted.some((t) => Math.round(t) === num || t.toFixed(1) === n || Math.abs(t - num) < 0.05);
  };
  const structural = collectStructuralNumbers(text);
  const claimedNumbers = text.replace(/(\d),(\d)/g, "$1$2").match(/\d+(\.\d+)?/g) ?? [];
  const invented = claimedNumbers.filter((n) => !isHonest(n) && Number(n) > 4 && !isWhitelisted(n, structural));
  if (invented.length === 0)
    return { text, wasCorrected: false };
  return { text: rendered.join("\n\n"), wasCorrected: true };
}
function isWhitelisted(n, structural) {
  return structural.has(n);
}
var ORDINAL_RE = /\b\d+(?:st|nd|rd|th)\b/gi;
var VERSION_RE = /\bv\d+(?:\.\d+)+\b|\b\d+\.\d+\.\d+\b/gi;
var URL_RE = /\bhttps?:\/\/\S+/gi;
var COUNT_CONTEXT_RE = /\b(?:top|first|last|next|page|chapter|step|no|number)\s+(\d+)\b|#(\d+)\b/gi;
var TOKEN_NUM_RE = /\b(?:[A-Za-z][\w]*[./_-][\w./_-]*\d[\w./_-]*|\d[\w]*[./_-][\w./_-]*[A-Za-z][\w./_-]*|[A-Za-z]+[./_-]+\d[\w./_-]*)\b/g;
var YEAR_CONTEXT_RE = /\b(?:in|year|since|by|during|from|until|by the year|circa|©)\s+((?:19|20)\d{2})\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:\d{1,2},?\s+)?((?:19|20)\d{2})\b|\b\d{1,2}[/-]\d{1,2}[/-]((?:19|20)\d{2})\b|\b((?:19|20)\d{2})[/-]\d{1,2}[/-]\d{1,2}\b/gi;
function collectStructuralNumbers(text) {
  const set = /* @__PURE__ */ new Set();
  const add = (s) => {
    for (const n of s.replace(/(\d),(\d)/g, "$1$2").match(/\d+(\.\d+)?/g) ?? [])
      set.add(n);
  };
  const addExact = (s) => {
    if (s)
      set.add(s);
  };
  for (const m of text.match(ORDINAL_RE) ?? [])
    add(m);
  for (const m of text.match(VERSION_RE) ?? [])
    add(m);
  for (const m of text.match(URL_RE) ?? [])
    add(m);
  for (const m of text.match(TOKEN_NUM_RE) ?? [])
    add(m);
  for (const m of text.matchAll(COUNT_CONTEXT_RE))
    add(m[1] ?? m[2] ?? "");
  for (const m of text.matchAll(YEAR_CONTEXT_RE))
    addExact(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
  return set;
}

// ../core/dist/memory.js
var MAX_FACTS = 200;
var InMemoryStore = class {
  constructor(maxFacts = MAX_FACTS) {
    __publicField(this, "maxFacts");
    __publicField(this, "facts", []);
    __publicField(this, "seq", 0);
    this.maxFacts = maxFacts;
  }
  remember(fact) {
    this.facts.push({ ...fact, id: String(++this.seq), createdAt: (/* @__PURE__ */ new Date()).toISOString() });
    if (this.facts.length > this.maxFacts)
      this.facts.splice(0, this.facts.length - this.maxFacts);
  }
  recall(query, limit = 5) {
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    return this.facts.map((f) => ({ f, score: terms.reduce((s, t) => s + (`${f.topic} ${f.content}`.toLowerCase().includes(t) ? 1 : 0), 0) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.f);
  }
};

// ../core/dist/builtins.js
var rememberFactCapability = {
  name: "remember_fact",
  description: "Remember a stable fact about the user or their preferences for future conversations (e.g. 'grows indoors in a 2m tent'). Use when the user states something worth keeping.",
  tags: ["memory"],
  exposeToAgents: false,
  parameters: {
    type: "object",
    properties: {
      topic: { type: "string", description: "Short topic key, e.g. 'grow setup'." },
      fact: { type: "string", description: "The fact, one sentence." }
    },
    required: ["topic", "fact"]
  },
  run: async ({ topic, fact }, ctx) => {
    await ctx.memory.remember({ topic: String(topic).slice(0, 80), content: String(fact).slice(0, 400) });
    return { saved: true, topic };
  },
  render: (r) => `Noted \u2014 I'll remember that (${r.topic}).`
};

// src/llmProxy.ts
var ProxyError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "ProxyError";
  }
};
var DEFAULT_TIMEOUT_MS = 3e4;
function proxyProvider(serverUrl, authToken, getModel, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const headers = { "content-type": "application/json" };
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  return {
    name: "proxy",
    async complete(input) {
      const model = getModel?.();
      const body = model ? { ...input, model } : input;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(`${serverUrl.replace(/\/$/, "")}/v1/llm/complete`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } catch (e) {
        throw new ProxyError(0, e?.name === "AbortError" ? "request timed out" : "network error");
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ProxyError(res.status, `assistant backend ${res.status}: ${text}`);
      }
      return res.json();
    }
  };
}

// src/voice.ts
var VoiceError = class extends Error {
  constructor(reason, message) {
    super(message ?? reason);
    this.reason = reason;
    this.name = "VoiceError";
  }
};
var SILERO_CDN = "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.22/dist/index.js";
var Voice = class {
  constructor(opts = {}) {
    this.opts = opts;
    __publicField(this, "speaking", false);
    __publicField(this, "currentAudio");
    __publicField(this, "currentUtterance");
    __publicField(this, "activeRecognition");
    __publicField(this, "listenAbort");
    __publicField(this, "bargeCleanup");
  }
  get isSpeaking() {
    return this.speaking;
  }
  async speak(text, onWord) {
    this.stop();
    if (this.opts.ttsMode === "server" && this.opts.serverUrl) {
      return this.speakServer(text);
    }
    return this.speakBrowser(text, onWord);
  }
  speakBrowser(text, onWord) {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      this.currentUtterance = u;
      if (this.opts.browserVoice) {
        const v = speechSynthesis.getVoices().find((x) => x.name.includes(this.opts.browserVoice));
        if (v) u.voice = v;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.speaking = false;
        this.currentUtterance = void 0;
        this.stopBargeIn();
        resolve();
      };
      u.onstart = () => {
        this.speaking = true;
        this.startBargeIn();
      };
      u.onboundary = (e) => onWord?.(text.slice(e.charIndex, e.charIndex + 12));
      u.onend = done;
      u.onerror = done;
      setTimeout(done, Math.max(5e3, text.length * 120));
      speechSynthesis.speak(u);
    });
  }
  async speakServer(text) {
    const headers = { "content-type": "application/json" };
    if (this.opts.authToken) headers.authorization = `Bearer ${this.opts.authToken}`;
    let res;
    try {
      res = await fetch(`${this.opts.serverUrl}/v1/voice/tts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text,
          voiceId: this.opts.voiceId,
          provider: this.opts.ttsProvider
        })
      });
    } catch {
      return this.speakBrowser(text);
    }
    if (!res.ok) return this.speakBrowser(text);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.currentAudio = audio;
    this.speaking = true;
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.speaking = false;
        this.currentAudio = void 0;
        this.stopBargeIn();
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.play().then(
        () => this.startBargeIn(),
        () => done()
      );
    });
  }
  stop() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.currentUtterance = void 0;
    if (this.currentAudio) {
      this.currentAudio.pause();
      const src = this.currentAudio.src;
      this.currentAudio = void 0;
      if (src.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(src);
        } catch {
        }
      }
    }
    this.speaking = false;
    this.stopBargeIn();
  }
  // ---- Barge-in: real voice-activity detection ------------------------------
  /**
   * Start barge-in — BUT never open the mic just to speak. Opening getUserMedia on every
   * TTS reply prompted TTS-only users for mic access, lit the mic indicator during all
   * speech, and let speaker echo trip the RMS threshold (the assistant barged in on
   * itself). So we only run barge-in when the mic is already available:
   *   - a live listen stream already exists (reuse it), or
   *   - mic permission was ALREADY granted (Permissions API says "granted").
   * Otherwise barge-in is silently skipped; tapping the mic button still interrupts TTS.
   */
  startBargeIn() {
    this.stopBargeIn();
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    if (this.opts.vad === "silero") {
      this.ifMicAlreadyGranted(() => this.startSileroBargeIn());
      return;
    }
    this.ifMicAlreadyGranted(() => this.startAnalyserBargeIn());
  }
  /** Run `fn` only if the mic is already usable without a new permission prompt. */
  ifMicAlreadyGranted(fn) {
    const perms = navigator.permissions;
    if (!perms?.query) {
      return;
    }
    perms.query({ name: "microphone" }).then((status) => {
      if (status.state === "granted") fn();
    }).catch(() => {
    });
  }
  startAnalyserBargeIn() {
    let cancelled = false;
    let stream;
    let ctx;
    let raf = 0;
    const cleanup = () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {
      });
    };
    this.bargeCleanup = cleanup;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then((s) => {
      if (cancelled) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const source = ctx.createMediaStreamSource(s);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let voicedFrames = 0;
      const tick = () => {
        if (cancelled || !this.speaking) return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        if (rms > 0.09) {
          if (++voicedFrames >= 6) {
            this.stop();
            return;
          }
        } else {
          voicedFrames = 0;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }).catch(() => {
    });
  }
  /** Optional Silero VAD via lazy CDN import. Never bundled; opt-in via `vad:"silero"`. */
  startSileroBargeIn() {
    let cancelled = false;
    let vadInstance;
    this.bargeCleanup = () => {
      cancelled = true;
      try {
        vadInstance?.destroy?.();
      } catch {
      }
    };
    let dynImport;
    try {
      dynImport = new Function("s", "return import(s)")(SILERO_CDN);
    } catch {
      this.startAnalyserBargeIn();
      return;
    }
    dynImport.then(async (mod) => {
      if (cancelled) return;
      const MicVAD = mod?.MicVAD ?? window.vad?.MicVAD;
      if (!MicVAD) return this.startAnalyserBargeIn();
      vadInstance = await MicVAD.new({
        onSpeechStart: () => {
          if (this.speaking) this.stop();
        }
      });
      if (cancelled) {
        vadInstance?.destroy?.();
        return;
      }
      vadInstance.start();
    }).catch(() => {
      if (!cancelled) this.startAnalyserBargeIn();
    });
  }
  stopBargeIn() {
    const c = this.bargeCleanup;
    this.bargeCleanup = void 0;
    c?.();
  }
  /**
   * Listen for one utterance. Uses the browser SpeechRecognition API when available
   * (instant, free); falls back to MediaRecorder + backend Whisper. Distinguishes
   * no-speech / permission-denied / other errors so the caller can surface a message.
   */
  async listenOnce(hooks) {
    this.stop();
    if (this.opts.sttMode === "server" && this.opts.serverUrl) {
      try {
        return await this.listenServer(hooks);
      } catch (e) {
        if (e instanceof VoiceError && e.reason === "other") {
          const SRfb = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (SRfb) {
            hooks?.onServerFallback?.();
            return this.listenBrowser(SRfb);
          }
        }
        throw e;
      }
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) return this.listenBrowser(SR);
    return this.listenServer(hooks);
  }
  /** Browser SpeechRecognition path (free, instant). Extracted so server STT can fall back to it. */
  listenBrowser(SR) {
    return new Promise((resolve, reject) => {
      const r = new SR();
      this.activeRecognition = r;
      r.lang = "en-US";
      r.interimResults = false;
      r.maxAlternatives = 1;
      let settled = false;
      let gotError = null;
      const finish = (text) => {
        if (settled) return;
        settled = true;
        this.activeRecognition = void 0;
        resolve(text);
      };
      const fail = (reason) => {
        if (settled) return;
        settled = true;
        this.activeRecognition = void 0;
        reject(new VoiceError(reason));
      };
      r.onresult = (e) => finish(e.results[0][0].transcript);
      r.onerror = (e) => {
        if (e?.error === "aborted") return finish("");
        if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
          gotError = "not-allowed";
          return fail("not-allowed");
        }
        if (e?.error === "no-speech") {
          gotError = "no-speech";
          return;
        }
        gotError = "other";
      };
      r.onend = () => {
        if (settled) return;
        if (gotError === "no-speech" || gotError === null) return fail("no-speech");
        if (gotError === "other") return fail("other");
        finish("");
      };
      this.listenAbort = new AbortController();
      this.listenAbort.signal.addEventListener("abort", () => {
        try {
          r.abort();
        } catch {
        }
        finish("");
      });
      setTimeout(() => {
        try {
          r.stop();
        } catch {
        }
      }, 12e3);
      try {
        r.start();
      } catch {
        fail("other");
      }
    });
  }
  /** Cancel an in-flight listen (second mic tap). Resolves the pending listenOnce with "". */
  cancelListen() {
    if (this.activeRecognition) {
      try {
        this.activeRecognition.abort();
      } catch {
      }
    }
    this.listenAbort?.abort();
  }
  async listenServer(hooks) {
    if (!this.opts.serverUrl) return "";
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
        throw new VoiceError("not-allowed");
      }
      if (e?.name === "NotFoundError" || e?.name === "NotReadableError") {
        throw new VoiceError("no-mic");
      }
      throw new VoiceError("other");
    }
    const abort = new AbortController();
    this.listenAbort = abort;
    let cancelled = false;
    abort.signal.addEventListener("abort", () => cancelled = true);
    try {
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const stopped = new Promise((r) => {
        rec.onstop = () => r();
        setTimeout(r, 6e3);
      });
      rec.start();
      hooks?.onCaptureStart?.();
      const CAPTURE_MS = 4e3;
      const start = Date.now();
      await new Promise((resolve) => {
        const iv = setInterval(() => {
          const remaining = CAPTURE_MS - (Date.now() - start);
          if (cancelled || remaining <= 0) {
            clearInterval(iv);
            hooks?.onCountdown?.(0, CAPTURE_MS);
            resolve();
          } else {
            hooks?.onCountdown?.(remaining, CAPTURE_MS);
          }
        }, 250);
        abort.signal.addEventListener("abort", () => {
          clearInterval(iv);
          resolve();
        });
      });
      try {
        rec.stop();
      } catch {
      }
      await stopped;
      if (cancelled) return "";
      const blob = new Blob(chunks, { type: "audio/webm" });
      if (!blob.size) throw new VoiceError("no-speech");
      const headers = { "content-type": "application/octet-stream" };
      if (this.opts.authToken) headers.authorization = `Bearer ${this.opts.authToken}`;
      let res;
      try {
        res = await fetch(`${this.opts.serverUrl}/v1/voice/stt`, {
          method: "POST",
          headers,
          body: await blob.arrayBuffer()
        });
      } catch {
        throw new VoiceError("other");
      }
      if (!res.ok) throw new VoiceError("other");
      const text = (await res.json()).text ?? "";
      if (!text.trim()) throw new VoiceError("no-speech");
      return text;
    } finally {
      this.listenAbort = void 0;
      stream.getTracks().forEach((t) => t.stop());
    }
  }
};

// src/chatHistory.ts
var CHAT_HISTORY_STORAGE_KEY = "page_assistant_chat_history";
var CHAT_HISTORY_CHANGE_EVENT = "page-assistant-chat-history-change";
var MAX_SESSIONS = 200;
var MAX_MESSAGES_PER_SESSION = 100;
function uid2() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
function titleFromMessage(text) {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 48 ? t.slice(0, 46) + "\u2026" : t || "New chat";
}
var ChatHistoryStore = class {
  constructor(storageKey = CHAT_HISTORY_STORAGE_KEY) {
    this.storageKey = storageKey;
    __publicField(this, "data");
    this.data = this.load();
  }
  load() {
    if (typeof localStorage === "undefined") {
      return { version: 1, activeId: null, sessions: [], groups: [] };
    }
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return { version: 1, activeId: null, sessions: [], groups: [] };
      const parsed = JSON.parse(raw);
      if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
        return { version: 1, activeId: null, sessions: [], groups: [] };
      }
      return { version: 1, activeId: parsed.activeId ?? null, sessions: parsed.sessions, groups: parsed.groups ?? [] };
    } catch {
      return { version: 1, activeId: null, sessions: [], groups: [] };
    }
  }
  persist() {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.data));
      window.dispatchEvent(new CustomEvent(CHAT_HISTORY_CHANGE_EVENT));
    } catch {
      const archived = this.data.sessions.filter((s) => s.archived).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      for (const s of archived.slice(0, 5)) this.data.sessions = this.data.sessions.filter((x) => x.id !== s.id);
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.data));
      } catch {
      }
    }
  }
  getActiveId() {
    return this.data.activeId;
  }
  getActive() {
    if (!this.data.activeId) return null;
    return this.data.sessions.find((s) => s.id === this.data.activeId) ?? null;
  }
  list(includeArchived = false) {
    const sessions = includeArchived ? [...this.data.sessions] : this.data.sessions.filter((s) => !s.archived);
    return sessions.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      const ao = a.order ?? 0;
      const bo = b.order ?? 0;
      if (ao !== bo) return bo - ao;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }
  listGroups() {
    return [...this.data.groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  get(id) {
    return this.data.sessions.find((s) => s.id === id);
  }
  create(opts) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const session = {
      id: uid2(),
      title: opts?.title ?? "New chat",
      messages: [],
      createdAt: now,
      updatedAt: now,
      model: opts?.model
    };
    this.data.sessions.unshift(session);
    this.data.activeId = session.id;
    this.trimSessions();
    this.persist();
    return session;
  }
  setActive(id) {
    this.data.activeId = id;
    if (id) {
      const s = this.get(id);
      if (s) {
        s.unread = false;
      }
    }
    this.persist();
  }
  saveMessages(id, messages, opts) {
    const s = this.get(id);
    if (!s) return;
    s.messages = messages.slice(-MAX_MESSAGES_PER_SESSION);
    s.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (opts?.model) s.model = opts.model;
    const firstUser = s.messages.find((m) => m.role === "user");
    if (firstUser && (s.title === "New chat" || !s.title)) {
      s.title = titleFromMessage(firstUser.content);
    }
    this.persist();
  }
  rename(id, title) {
    const s = this.get(id);
    if (!s) return;
    s.title = title.trim() || s.title;
    s.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.persist();
  }
  delete(id) {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id);
    if (this.data.activeId === id) {
      this.data.activeId = this.data.sessions.find((s) => !s.archived)?.id ?? null;
    }
    this.persist();
  }
  archive(id, archived = true) {
    const s = this.get(id);
    if (!s) return;
    s.archived = archived;
    s.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (archived && this.data.activeId === id) {
      this.data.activeId = this.data.sessions.find((x) => !x.archived && x.id !== id)?.id ?? null;
    }
    this.persist();
  }
  pin(id, pinned = true) {
    const s = this.get(id);
    if (!s) return;
    s.pinned = pinned;
    s.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.persist();
  }
  markUnread(id, unread = true) {
    const s = this.get(id);
    if (!s) return;
    s.unread = unread;
    this.persist();
  }
  fork(id) {
    const src = this.get(id);
    if (!src) return null;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const forked = {
      id: uid2(),
      title: `${src.title} (fork)`,
      messages: [...src.messages],
      createdAt: now,
      updatedAt: now,
      model: src.model,
      groupId: src.groupId
    };
    this.data.sessions.unshift(forked);
    this.data.activeId = forked.id;
    this.trimSessions();
    this.persist();
    return forked;
  }
  reorder(ids) {
    ids.forEach((id, i) => {
      const s = this.get(id);
      if (s) s.order = ids.length - i;
    });
    this.persist();
  }
  setGroup(sessionId, groupId) {
    const s = this.get(sessionId);
    if (!s) return;
    s.groupId = groupId;
    s.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.persist();
  }
  createGroup(name) {
    const g = { id: uid2(), name, order: this.data.groups.length };
    this.data.groups.push(g);
    this.persist();
    return g;
  }
  renameGroup(id, name) {
    const g = this.data.groups.find((x) => x.id === id);
    if (!g) return;
    g.name = name.trim() || g.name;
    this.persist();
  }
  deleteGroup(id) {
    this.data.groups = this.data.groups.filter((g) => g.id !== id);
    for (const s of this.data.sessions) {
      if (s.groupId === id) s.groupId = void 0;
    }
    this.persist();
  }
  /** Export session as shareable JSON (no secrets). */
  share(id) {
    const s = this.get(id);
    if (!s) return null;
    return JSON.stringify({ title: s.title, messages: s.messages, exportedAt: (/* @__PURE__ */ new Date()).toISOString() }, null, 2);
  }
  /** Export all chats as JSON backup. */
  exportAll() {
    return JSON.stringify(this.data, null, 2);
  }
  importAll(json) {
    try {
      const parsed = JSON.parse(json);
      if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) return false;
      this.data = parsed;
      this.persist();
      return true;
    } catch {
      return false;
    }
  }
  search(query) {
    const q = query.toLowerCase().trim();
    if (!q) return this.list();
    return this.list(true).filter((s) => {
      if (s.title.toLowerCase().includes(q)) return true;
      return s.messages.some((m) => m.content.toLowerCase().includes(q));
    });
  }
  trimSessions() {
    if (this.data.sessions.length <= MAX_SESSIONS) return;
    const sorted = [...this.data.sessions].filter((s) => !s.pinned && s.archived).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    for (const s of sorted) {
      if (this.data.sessions.length <= MAX_SESSIONS) break;
      this.data.sessions = this.data.sessions.filter((x) => x.id !== s.id);
    }
  }
};

// src/chatSidebar.ts
var SIDEBAR_CSS = `
.sidebar {
  width: 220px; min-width: 220px; background: var(--pa-bg-sidebar); border-right: 1px solid var(--pa-border);
  display: flex; flex-direction: column; overflow: hidden; transition: width .2s, min-width .2s;
  position: relative;
}
.sidebar.collapsed { width: 0; min-width: 0; border: none; }
.sidebar-head { padding: 10px; border-bottom: 1px solid var(--pa-border); display: flex; gap: 6px; align-items: center; }
.sidebar-head input {
  flex: 1; background: var(--pa-bg-input); border: 1px solid var(--pa-border); color: var(--pa-text);
  border-radius: 8px; padding: 6px 8px; font-size: 12px; outline: none;
}
.sidebar-head button, .new-chat {
  background: var(--pa-border); border: none; color: var(--pa-text); border-radius: 8px; cursor: pointer;
  padding: 6px 8px; font-size: 12px; white-space: nowrap;
}
.new-chat { margin: 8px; width: calc(100% - 16px); font-weight: 600; background: var(--pa-accent); color: #fff; }
.sidebar-list { flex: 1; overflow-y: auto; padding: 4px 0; }
.section-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--pa-text-muted);
  padding: 8px 12px 4px; font-weight: 600;
}
.chat-item {
  display: flex; align-items: center; gap: 6px; padding: 8px 10px; cursor: pointer;
  font-size: 13px; color: var(--pa-text); border-left: 3px solid transparent;
}
.chat-item:hover { background: var(--pa-border); }
.chat-item.active { background: var(--pa-bg-msg-asst); border-left-color: var(--pa-accent); }
.chat-item.unread .chat-title { font-weight: 700; }
.chat-item.pinned .chat-title::before { content: "\u{1F4CC} "; font-size: 10px; }
.chat-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-menu-btn {
  background: none; border: none; color: var(--pa-text-muted); cursor: pointer; padding: 2px 4px;
  border-radius: 4px; font-size: 14px; opacity: 0;
}
.chat-item:hover .chat-menu-btn, .chat-item:focus-within .chat-menu-btn { opacity: 1; }
.chat-menu-btn:hover { background: var(--pa-border); color: var(--pa-text); }
.ctx-menu {
  position: fixed; z-index: 2147483647; background: var(--pa-bg-head); border: 1px solid var(--pa-border);
  border-radius: 8px; padding: 4px 0; min-width: 160px; box-shadow: 0 8px 24px rgba(0,0,0,.4);
}
.ctx-menu button {
  display: block; width: 100%; text-align: left; background: none; border: none;
  color: var(--pa-text); padding: 8px 14px; font-size: 13px; cursor: pointer;
}
.ctx-menu button:hover { background: var(--pa-border); }
.ctx-menu button.danger { color: var(--pa-danger, #f87171); }
.show-more {
  display: block; width: calc(100% - 16px); margin: 6px 8px; background: none; border: 1px dashed var(--pa-border);
  color: var(--pa-text-muted); border-radius: 8px; padding: 6px; font-size: 12px; cursor: pointer;
}
.show-more:hover { background: var(--pa-border); color: var(--pa-text); }
.toggle-sidebar {
  background: none; border: none; color: var(--pa-text-muted); cursor: pointer; font-size: 16px; padding: 2px 6px;
}
/* On narrow viewports the sidebar overlays the panel instead of squeezing the chat. */
@media (max-width: 520px) {
  .sidebar:not(.collapsed) {
    position: absolute; inset: 0 auto 0 0; width: 80%; min-width: 0; max-width: 260px;
    z-index: 5; box-shadow: 6px 0 24px rgba(0,0,0,.4);
  }
  .chat-menu-btn { opacity: 1; } /* touch has no hover \u2014 keep the \u22EF menu reachable */
}
@media (hover: none) {
  .chat-menu-btn { opacity: 1; }
}
`;
var PAGE_SIZE = 15;
var ChatSidebar = class {
  constructor(store, handlers, activeId) {
    this.store = store;
    this.handlers = handlers;
    this.activeId = activeId;
    __publicField(this, "el");
    __publicField(this, "listEl");
    __publicField(this, "searchInput");
    __publicField(this, "ctxMenu");
    __publicField(this, "ctxMenuAnchor");
    __publicField(this, "showLimit", PAGE_SIZE);
    __publicField(this, "query", "");
    __publicField(this, "onHistoryChange", () => this.refresh());
    __publicField(this, "outsideClickHandler");
  }
  render() {
    this.el = el("div", "sidebar");
    const style = document.createElement("style");
    style.textContent = SIDEBAR_CSS;
    this.el.appendChild(style);
    const head = el("div", "sidebar-head");
    this.searchInput = el("input");
    this.searchInput.placeholder = "Search chats\u2026";
    this.searchInput.setAttribute("aria-label", "Search chats");
    this.searchInput.oninput = () => {
      this.query = this.searchInput.value;
      this.handlers.onSearch(this.query);
      this.refresh();
    };
    const toggleBtn = el("button", "toggle-sidebar");
    toggleBtn.textContent = "\u25C0";
    toggleBtn.title = "Collapse sidebar";
    toggleBtn.setAttribute("aria-label", "Collapse chat history sidebar");
    toggleBtn.onclick = () => this.handlers.onToggle(false);
    head.append(this.searchInput, toggleBtn);
    const newBtn = el("button", "new-chat");
    newBtn.textContent = "+ New chat";
    newBtn.setAttribute("aria-label", "Start a new chat");
    newBtn.onclick = () => this.handlers.onNew();
    this.listEl = el("div", "sidebar-list");
    this.el.append(head, newBtn, this.listEl);
    this.refresh();
    window.addEventListener(CHAT_HISTORY_CHANGE_EVENT, this.onHistoryChange);
    return this.el;
  }
  /** Detach the history listener and any open menu (for widget teardown). */
  destroy() {
    window.removeEventListener(CHAT_HISTORY_CHANGE_EVENT, this.onHistoryChange);
    this.closeContextMenu();
  }
  setActive(id) {
    this.activeId = id;
    this.refresh();
  }
  setCollapsed(collapsed) {
    this.el.classList.toggle("collapsed", collapsed);
    if (collapsed) this.closeContextMenu();
  }
  refresh() {
    this.closeContextMenu();
    this.listEl.innerHTML = "";
    const sessions = this.query ? this.store.search(this.query) : this.store.list();
    const groups = this.store.listGroups();
    const pinned = sessions.filter((s) => s.pinned && !s.archived);
    const unpinned = sessions.filter((s) => !s.pinned && !s.archived);
    const archived = sessions.filter((s) => s.archived);
    if (pinned.length) {
      this.addSection("Pinned");
      for (const s of pinned) this.addItem(s);
    }
    const grouped = /* @__PURE__ */ new Map();
    const ungrouped = [];
    for (const s of unpinned) {
      if (s.groupId) {
        const arr = grouped.get(s.groupId) ?? [];
        arr.push(s);
        grouped.set(s.groupId, arr);
      } else {
        ungrouped.push(s);
      }
    }
    for (const g of groups) {
      const items = grouped.get(g.id);
      if (!items?.length) continue;
      this.addSection(g.name);
      for (const s of items.slice(0, this.showLimit)) this.addItem(s);
    }
    if (ungrouped.length) {
      this.addSection("Recent");
      const visible = ungrouped.slice(0, this.showLimit);
      for (const s of visible) this.addItem(s);
      if (ungrouped.length > this.showLimit) {
        const more = el("button", "show-more");
        more.textContent = `Show ${ungrouped.length - this.showLimit} more\u2026`;
        more.onclick = () => {
          this.showLimit += PAGE_SIZE;
          this.refresh();
        };
        this.listEl.appendChild(more);
      }
    }
    if (archived.length) {
      this.addSection("Archived");
      for (const s of archived.slice(0, 5)) this.addItem(s);
    }
    if (!sessions.length) {
      const empty = el("div", "section-label");
      empty.textContent = "No chats yet";
      this.listEl.appendChild(empty);
    }
  }
  addSection(label) {
    const s = el("div", "section-label");
    s.textContent = label;
    this.listEl.appendChild(s);
  }
  addItem(session) {
    const item = el("div", "chat-item");
    if (session.id === this.activeId) item.classList.add("active");
    if (session.unread) item.classList.add("unread");
    if (session.pinned) item.classList.add("pinned");
    const title = el("span", "chat-title");
    title.textContent = session.title;
    title.title = session.title;
    const menuBtn = el("button", "chat-menu-btn");
    menuBtn.textContent = "\u22EF";
    menuBtn.setAttribute("aria-label", `Actions for "${session.title}"`);
    menuBtn.setAttribute("aria-haspopup", "menu");
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.ctxMenu && this.ctxMenuAnchor === menuBtn) {
        this.closeContextMenu();
        return;
      }
      this.openContextMenu(session, menuBtn);
    };
    item.onclick = () => this.handlers.onSelect(session.id);
    item.append(title, menuBtn);
    this.listEl.appendChild(item);
  }
  openContextMenu(session, anchor) {
    this.closeContextMenu();
    const menu = el("div", "ctx-menu");
    menu.setAttribute("role", "menu");
    const items = [
      { label: "Rename", action: () => this.promptRename(session) },
      { label: "Fork", action: () => this.handlers.onFork(session.id) },
      { label: session.pinned ? "Unpin" : "Pin", action: () => this.handlers.onPin(session.id, !session.pinned) },
      { label: "Mark unread", action: () => this.handlers.onMarkUnread(session.id) },
      { label: "Share (copy JSON)", action: () => this.handlers.onShare(session.id) },
      { label: session.archived ? "Unarchive" : "Archive", action: () => this.handlers.onArchive(session.id) },
      {
        label: "Delete",
        action: () => {
          if (typeof confirm === "function" && !confirm(`Delete "${session.title}"? This can't be undone.`)) return;
          this.handlers.onDelete(session.id);
        },
        danger: true
      }
    ];
    for (const it of items) {
      const btn = el("button");
      btn.textContent = it.label;
      btn.setAttribute("role", "menuitem");
      if (it.danger) btn.classList.add("danger");
      btn.onclick = () => {
        this.closeContextMenu();
        it.action();
      };
      menu.appendChild(btn);
    }
    const root = this.el.getRootNode();
    (root instanceof ShadowRoot ? root : this.el).appendChild(menu);
    this.ctxMenu = menu;
    this.ctxMenuAnchor = anchor;
    const rect = anchor.getBoundingClientRect();
    const width = 180;
    const menuH = menu.offsetHeight || 8 + items.length * 34;
    const margin = 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    let top;
    if (spaceBelow >= menuH + margin || rect.top < menuH + margin) {
      top = Math.min(rect.bottom + 4, window.innerHeight - menuH - margin);
    } else {
      top = Math.max(margin, rect.top - menuH - 4);
    }
    menu.style.top = `${Math.max(margin, top)}px`;
    menu.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`;
    this.outsideClickHandler = (e) => {
      if (this.ctxMenuAnchor && (e.target === this.ctxMenuAnchor || this.ctxMenuAnchor.contains(e.target))) return;
      if (this.ctxMenu && !this.ctxMenu.contains(e.target)) this.closeContextMenu();
    };
    setTimeout(() => {
      this.el.getRootNode().addEventListener("click", this.outsideClickHandler, { capture: true });
      document.addEventListener("click", this.outsideClickHandler, { capture: true });
    }, 0);
  }
  closeContextMenu() {
    this.ctxMenu?.remove();
    this.ctxMenu = void 0;
    this.ctxMenuAnchor = void 0;
    if (this.outsideClickHandler) {
      this.el?.getRootNode().removeEventListener("click", this.outsideClickHandler, { capture: true });
      document.removeEventListener("click", this.outsideClickHandler, { capture: true });
      this.outsideClickHandler = void 0;
    }
  }
  /** Close the context menu if it's open; returns true if there was one to close (for Escape). */
  closeContextMenuIfOpen() {
    if (!this.ctxMenu) return false;
    this.closeContextMenu();
    return true;
  }
  promptRename(session) {
    const title = prompt("Rename chat:", session.title);
    if (title?.trim()) this.handlers.onRename(session.id, title.trim());
  }
};
function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

// src/themes.ts
var THEME_VARS = {
  dark: {
    "--pa-bg": "#0f1715",
    "--pa-bg-head": "#12211a",
    "--pa-bg-sidebar": "#0b1310",
    "--pa-bg-input": "#0b1310",
    "--pa-bg-msg-user": "#1f6f43",
    "--pa-bg-msg-asst": "#1a2a22",
    "--pa-text": "#e7f5ec",
    "--pa-text-muted": "#9ab4a6",
    "--pa-border": "#1f3a2c",
    "--pa-accent": "#16a34a",
    "--pa-danger": "#f87171",
    "--pa-launcher-from": "#5eead4",
    "--pa-launcher-to": "#0d9488"
  },
  light: {
    "--pa-bg": "#ffffff",
    "--pa-bg-head": "#f4f7f5",
    "--pa-bg-sidebar": "#f0f4f2",
    "--pa-bg-input": "#ffffff",
    "--pa-bg-msg-user": "#047857",
    "--pa-bg-msg-asst": "#f0fdf4",
    "--pa-text": "#0f172a",
    "--pa-text-muted": "#64748b",
    "--pa-border": "#e2e8f0",
    // Darkened from #059669 (~3.75:1 white text) to hit WCAG AA (~4.5:1) on accent buttons
    // (send / Confirm / Retry / "+ New chat").
    "--pa-accent": "#047857",
    // Darker red for the "Delete" menu item — #f87171 was ~2.2:1 on white (fails AA).
    "--pa-danger": "#dc2626",
    "--pa-launcher-from": "#34d399",
    "--pa-launcher-to": "#059669"
  }
};
function resolveTheme(mode) {
  if (mode === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  if (mode === "light") return "light";
  return "dark";
}
function themeCssVars(mode) {
  const resolved = resolveTheme(mode);
  const vars = THEME_VARS[resolved];
  return Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join("; ");
}

// src/ui.ts
var CSS2 = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; }
.launcher {
  position: fixed; right: calc(22px + env(safe-area-inset-right)); bottom: calc(22px + env(safe-area-inset-bottom));
  width: 60px; height: 60px; border-radius: 50%;
  border: none; cursor: pointer; z-index: 2147483646;
  background: radial-gradient(circle at 30% 30%, var(--pa-launcher-from), var(--pa-launcher-to));
  box-shadow: 0 8px 28px rgba(13,148,136,.45); transition: transform .25s, box-shadow .25s;
  display:flex; align-items:center; justify-content:center; color:#042f2e;
}
.launcher svg { width: 28px; height: 28px; fill: currentColor; }
.launcher:hover { transform: scale(1.08); }
.launcher.talking { animation: bob .5s infinite alternate; }
.launcher.thinking { animation: spin 1.2s linear infinite; }
.launcher.listening { box-shadow: 0 0 0 6px rgba(94,234,212,.35), 0 8px 28px rgba(13,148,136,.45); }
.launcher.scanning { animation: pulse .8s infinite; }
@keyframes bob { to { transform: translateY(-4px); } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 50% { box-shadow: 0 0 0 10px rgba(94,234,212,.25), 0 8px 28px rgba(13,148,136,.45); } }
.panel-wrap {
  position: fixed; right: calc(22px + env(safe-area-inset-right)); bottom: calc(92px + env(safe-area-inset-bottom));
  z-index: 2147483646; display: none;
}
.panel-wrap.open { display: flex; }
.panel {
  position: relative;
  width: 580px; max-width: calc(100vw - 32px);
  height: 520px; max-height: calc(100vh - 130px); background: var(--pa-bg); color: var(--pa-text);
  border: 1px solid var(--pa-border); border-radius: 16px;
  display: flex; flex-direction: row; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.5);
}
.panel-body { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.head { padding: 14px 16px; background: var(--pa-bg-head); border-bottom: 1px solid var(--pa-border); font-weight: 600; display:flex; align-items:center; gap:8px; }
.head .dot { width:8px;height:8px;border-radius:50%;background:#4ade80; }
.head .actions { margin-left: auto; display: flex; gap: 4px; align-items: center; }
.head button { background:none; border:none; color:var(--pa-text-muted); font-size:16px; cursor:pointer; padding:2px 6px; border-radius:6px; }
.head button:hover { background: var(--pa-border); color: var(--pa-text); }
.log { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.msg { padding: 9px 12px; border-radius: 12px; max-width: 85%; line-height: 1.4; font-size: 14px; white-space: pre-wrap; }
.msg.user { align-self: flex-end; background: var(--pa-bg-msg-user); color: #fff; }
.msg.assistant { align-self: flex-start; background: var(--pa-bg-msg-asst); border: 1px solid var(--pa-border); }
.msg.system { align-self: center; font-size: 12px; opacity: .75; background: transparent; }
.msg.error {
  align-self: center; background: var(--pa-error-bg); color: var(--pa-error-text);
  border: 1px solid var(--pa-error-border); font-size: 13px; opacity: 1; max-width: 92%;
  display: flex; flex-direction: column; gap: 6px;
}
.msg.error .retry {
  align-self: flex-start; background: var(--pa-accent); color: #fff; border: none;
  border-radius: 8px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.typing { align-self: flex-start; display: flex; gap: 4px; padding: 11px 14px; background: var(--pa-bg-msg-asst); border: 1px solid var(--pa-border); border-radius: 12px; }
.typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--pa-text-muted); opacity: .5; animation: blink 1.2s infinite; }
.typing span:nth-child(2) { animation-delay: .2s; }
.typing span:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%,60%,100% { opacity:.3; transform:translateY(0);} 30% { opacity:1; transform:translateY(-3px);} }
.confirm { display:flex; gap:8px; margin-top:6px; }
.confirm button { flex:1; padding:7px; border-radius:8px; border:none; cursor:pointer; font-weight:600; }
.confirm .yes { background:var(--pa-accent); color:#fff; } .confirm .no { background:var(--pa-border); color:var(--pa-text); }
.chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
.chip { background:var(--pa-bg-sidebar); border:1px solid var(--pa-border); color:var(--pa-text); border-radius:14px; padding:6px 11px; font-size:12px; cursor:pointer; }
.chip:hover { opacity: .85; }
.attach-preview { display:flex; flex-wrap:wrap; gap:4px; padding: 4px 10px; }
.attach-tag { font-size:11px; background:var(--pa-bg-sidebar); border:1px solid var(--pa-border); border-radius:6px; padding:2px 6px; color:var(--pa-text-muted); display:inline-flex; align-items:center; gap:4px; }
.attach-tag button { background:none; border:none; color:var(--pa-text-muted); cursor:pointer; font-size:12px; line-height:1; padding:0; }
.attach-tag button:hover { color:var(--pa-text); }
.foot { padding: 10px; border-top: 1px solid var(--pa-border); display: flex; gap: 8px; align-items: center; }
.foot input[type=text] { flex: 1; background: var(--pa-bg-input); border: 1px solid var(--pa-border); color: var(--pa-text); border-radius: 10px; padding: 9px 12px; outline: none; font-size: 16px; }
.foot input[type=text]:disabled { opacity: .6; }
.foot button { border: none; border-radius: 10px; padding: 0 12px; cursor: pointer; font-size: 16px; height: 36px; }
.foot button:disabled { opacity: .5; cursor: default; }
.foot .attach { background: var(--pa-border); color: var(--pa-text-muted); font-size: 14px; }
.foot .mic { background: var(--pa-border); color: var(--pa-mic-glyph); position: relative; }
.foot .mic.on { background:var(--pa-accent); color:#fff; }
.foot .mic .countdown { position:absolute; top:-6px; right:-4px; background:var(--pa-accent); color:#fff; font-size:9px; min-width:14px; height:14px; border-radius:7px; display:none; align-items:center; justify-content:center; padding:0 3px; }
.foot .mic.counting .countdown { display:flex; }
.foot .tts { background: var(--pa-border); color: var(--pa-text-muted); font-size: 18px; }
.foot .tts.on { background:#0d9488; color:#ecfdf5; }
.foot .send { background: var(--pa-accent); color: #fff; }
.scanline { position:fixed; left:0; right:0; height:3px; background:linear-gradient(90deg,transparent,#4ade80,transparent); z-index:2147483645; display:none; animation: sweep 1.4s ease-in-out infinite; }
.scanline.on { display:block; }
@keyframes sweep { 0%{top:0} 100%{top:100vh} }
.toast { position:fixed; left:50%; bottom:100px; transform:translateX(-50%); background:var(--pa-bg-head); color:var(--pa-text); border:1px solid var(--pa-border); border-radius:10px; padding:8px 14px; font-size:13px; z-index:2147483647; box-shadow:0 8px 24px rgba(0,0,0,.4); opacity:0; transition:opacity .2s; pointer-events:none; }
.toast.show { opacity:1; }
/* Highlight ring for the visual action preview \u2014 drawn in the shadow root, never in host DOM. */
.pa-highlight { position:fixed; z-index:2147483644; border:3px solid var(--pa-accent); border-radius:8px; box-shadow:0 0 0 3px rgba(22,163,74,.35), 0 0 20px rgba(22,163,74,.5); pointer-events:none; transition:all .2s ease; }
.pa-highlight::after { content:"\u{1F449}"; position:absolute; left:-26px; top:50%; transform:translateY(-50%); font-size:18px; }
.kbd-hint { position:absolute; bottom:4px; left:50%; transform:translateX(-50%); font-size:10px; color:var(--pa-text-muted); opacity:.6; }
/* Scrim behind the overlay sidebar on phones \u2014 tap it to dismiss the sidebar. */
.sidebar-scrim { position: absolute; inset: 0; z-index: 4; background: rgba(0,0,0,.4); display: none; }
.sidebar-scrim.show { display: block; }
@media (min-width: 521px) { .sidebar-scrim { display: none !important; } }
@media (max-width: 520px) {
  .panel { width: calc(100vw - 16px); height: calc(100dvh - 110px); max-height: calc(100dvh - 110px); }
  .panel-wrap { right: 8px; left: 8px; bottom: calc(84px + env(safe-area-inset-bottom)); }
}
@media (prefers-reduced-motion: reduce) {
  .launcher.talking, .launcher.thinking, .launcher.scanning { animation: none; }
  .launcher.listening { box-shadow: 0 0 0 6px rgba(94,234,212,.35), 0 8px 28px rgba(13,148,136,.45); }
  .scanline { animation: none; top: 50%; }
  .typing span { animation: none; opacity: .6; }
}
`;
var CONTRAST_VARS = {
  dark: "--pa-mic-glyph:#9ff0c2; --pa-error-bg:#3a1414; --pa-error-text:#fecaca; --pa-error-border:#7f1d1d;",
  light: "--pa-mic-glyph:#047857; --pa-error-bg:#fef2f2; --pa-error-text:#991b1b; --pa-error-border:#fecaca;"
};
var WidgetUI = class {
  constructor(title, handlers, opts = {}) {
    this.title = title;
    this.handlers = handlers;
    this.opts = opts;
    __publicField(this, "root");
    __publicField(this, "host");
    __publicField(this, "launcher");
    __publicField(this, "panelWrap");
    __publicField(this, "panel");
    __publicField(this, "log");
    __publicField(this, "input");
    __publicField(this, "micBtn");
    __publicField(this, "micCountdown");
    __publicField(this, "ttsBtn");
    __publicField(this, "sendBtn");
    __publicField(this, "attachBtn");
    __publicField(this, "scanline");
    __publicField(this, "toastEl");
    __publicField(this, "sidebar");
    __publicField(this, "sidebarEl");
    __publicField(this, "sidebarScrim");
    __publicField(this, "attachPreview");
    __publicField(this, "fileInput");
    __publicField(this, "pendingAttachments", []);
    __publicField(this, "sidebarOpen");
    __publicField(this, "theme");
    __publicField(this, "styleEl");
    __publicField(this, "typingEl");
    __publicField(this, "confirmRow");
    __publicField(this, "highlightEl");
    __publicField(this, "highlightTarget");
    __publicField(this, "highlightReanchor");
    __publicField(this, "busy", false);
    __publicField(this, "lastFocused");
    __publicField(this, "keydownHandler");
    __publicField(this, "viewportHandler");
    const isNarrow = typeof matchMedia !== "undefined" && matchMedia("(max-width: 520px)").matches;
    this.sidebarOpen = isNarrow ? false : opts.sidebarOpen ?? true;
    this.theme = opts.theme ?? "dark";
    this.host = document.createElement("div");
    this.host.id = "page-assistant-root";
    document.body.appendChild(this.host);
    this.root = this.host.attachShadow({ mode: "open" });
    this.render();
    this.bindKeyboard();
    this.bindViewport();
  }
  themeStyle(theme) {
    const resolved = theme === "light" || theme === "system" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    return `:host { ${themeCssVars(theme)}; ${CONTRAST_VARS[resolved]} } ${CSS2}`;
  }
  render() {
    this.styleEl = document.createElement("style");
    this.styleEl.textContent = this.themeStyle(this.theme);
    this.root.appendChild(this.styleEl);
    this.scanline = el2("div", "scanline");
    this.toastEl = el2("div", "toast");
    this.launcher = el2("button", "launcher");
    this.launcher.innerHTML = PHONE_SVG;
    this.launcher.title = this.title;
    this.launcher.setAttribute("aria-label", `Open ${this.title}`);
    this.launcher.setAttribute("aria-expanded", "false");
    this.panelWrap = el2("div", "panel-wrap");
    this.panel = el2("div", "panel");
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", this.title);
    if (this.opts.chatStore) {
      const handlers = {
        onSelect: (id) => this.handlers.onSelectChat?.(id),
        onNew: () => this.handlers.onNewChat?.(),
        // Route delete/archive through the controller so it can detect when the ACTIVE
        // chat was removed and start a fresh one (otherwise persistCurrentChat no-ops).
        onDelete: (id) => this.handlers.onDeleteChat?.(id),
        onArchive: (id) => this.handlers.onArchiveChat?.(id),
        onPin: (id, pinned) => this.opts.chatStore.pin(id, pinned),
        onRename: (id, title) => this.opts.chatStore.rename(id, title),
        onFork: (id) => {
          this.opts.chatStore.fork(id);
          this.handlers.onSelectChat?.(this.opts.chatStore.getActiveId());
        },
        onMarkUnread: (id) => this.opts.chatStore.markUnread(id, true),
        onShare: (id) => {
          const json = this.opts.chatStore.share(id);
          if (json) {
            navigator.clipboard?.writeText(json).then(
              () => this.toast("Chat JSON copied to clipboard"),
              () => this.toast("Couldn't copy to clipboard")
            );
          }
        },
        onSearch: () => {
        },
        onToggle: (open) => this.setSidebarOpen(open)
      };
      this.opts.onSidebarHandlers?.(handlers);
      this.sidebar = new ChatSidebar(this.opts.chatStore, handlers, this.opts.chatStore.getActiveId());
      this.sidebarEl = this.sidebar.render();
      if (!this.sidebarOpen) this.sidebar.setCollapsed(true);
      this.panel.appendChild(this.sidebarEl);
      const scrim = el2("div", "sidebar-scrim");
      scrim.onclick = () => this.setSidebarOpen(false);
      if (this.sidebarOpen) scrim.classList.add("show");
      this.sidebarScrim = scrim;
      this.panel.appendChild(scrim);
    }
    const body = el2("div", "panel-body");
    const head = el2("div", "head");
    head.innerHTML = `<span class="dot"></span>${escapeHtml(this.title)}`;
    const actions = el2("div", "actions");
    if (this.opts.chatStore) {
      const sidebarToggle = el2("button");
      sidebarToggle.textContent = "\u2630";
      sidebarToggle.title = "Toggle chat history";
      sidebarToggle.setAttribute("aria-label", "Toggle chat history sidebar");
      sidebarToggle.setAttribute("aria-pressed", String(this.sidebarOpen));
      sidebarToggle.onclick = () => {
        this.setSidebarOpen(!this.sidebarOpen);
        sidebarToggle.setAttribute("aria-pressed", String(this.sidebarOpen));
      };
      actions.appendChild(sidebarToggle);
    }
    const exportBtn = el2("button");
    exportBtn.textContent = "\u2193";
    exportBtn.title = "Export chat";
    exportBtn.setAttribute("aria-label", "Export this chat");
    exportBtn.onclick = () => this.handlers.onExportChat?.();
    const settingsBtn = el2("button");
    settingsBtn.textContent = "\u2699";
    settingsBtn.title = "Assistant settings";
    settingsBtn.setAttribute("aria-label", "Open assistant settings");
    settingsBtn.onclick = () => this.handlers.onSettings?.();
    const closeBtn = el2("button");
    closeBtn.textContent = "\xD7";
    closeBtn.setAttribute("aria-label", "Close assistant");
    closeBtn.onclick = () => this.toggle(false);
    actions.append(exportBtn, settingsBtn, closeBtn);
    head.appendChild(actions);
    this.log = el2("div", "log");
    this.log.setAttribute("role", "log");
    this.log.setAttribute("aria-live", "polite");
    this.log.setAttribute("aria-relevant", "additions");
    this.attachPreview = el2("div", "attach-preview");
    const foot = el2("div", "foot");
    this.fileInput = el2("input");
    this.fileInput.type = "file";
    this.fileInput.multiple = true;
    this.fileInput.accept = ".txt,.md,.csv,.json,.js,.ts,.html,.css,.yaml,.yml,.xml,.log" + (this.opts.imagesEnabled ? ",image/*" : "");
    this.fileInput.style.display = "none";
    this.fileInput.onchange = () => this.handleFiles();
    const attachBtn = el2("button", "attach");
    attachBtn.textContent = "\u{1F4CE}";
    attachBtn.title = "Attach file";
    attachBtn.setAttribute("aria-label", "Attach a file");
    attachBtn.onclick = () => this.fileInput.click();
    this.attachBtn = attachBtn;
    this.input = el2("input");
    this.input.type = "text";
    this.input.placeholder = "Ask or tell me to do something\u2026";
    this.input.setAttribute("aria-label", "Message the assistant");
    this.ttsBtn = el2("button", "tts");
    this.ttsBtn.textContent = "\u260E";
    this.ttsBtn.title = "Read replies aloud (off)";
    this.ttsBtn.setAttribute("aria-label", "Read replies aloud");
    this.ttsBtn.setAttribute("aria-pressed", "false");
    this.micBtn = el2("button", "mic");
    this.micBtn.textContent = "\u{1F399}";
    this.micCountdown = el2("span", "countdown");
    this.micBtn.appendChild(this.micCountdown);
    this.micBtn.setAttribute("aria-label", "Speak to the assistant");
    this.micBtn.setAttribute("aria-pressed", "false");
    this.sendBtn = el2("button", "send");
    this.sendBtn.textContent = "\u27A4";
    this.sendBtn.setAttribute("aria-label", "Send message");
    foot.append(attachBtn, this.input, this.ttsBtn, this.micBtn, this.sendBtn);
    body.append(head, this.log, this.attachPreview, foot);
    this.panel.appendChild(body);
    this.panelWrap.appendChild(this.panel);
    this.root.append(this.scanline, this.toastEl, this.launcher, this.panelWrap, this.fileInput);
    this.launcher.onclick = () => this.toggle();
    this.sendBtn.onclick = () => this.submit();
    this.input.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) this.submit();
    };
    this.micBtn.onclick = () => this.handlers.onMic();
    this.ttsBtn.onclick = () => {
      const on = !this.ttsBtn.classList.contains("on");
      this.setTtsEnabled(on);
      this.handlers.onTtsToggle?.(on);
    };
  }
  bindKeyboard() {
    this.keydownHandler = (e) => {
      if (!this.panelWrap.classList.contains("open")) return;
      const mod = e.metaKey || e.ctrlKey;
      const inside = this.root.contains(e.composedPath?.()[0] ?? e.target);
      if (mod && inside && e.key === "k") {
        e.preventDefault();
        this.input.focus();
      }
      if (mod && inside && e.key === "n") {
        e.preventDefault();
        this.handlers.onNewChat?.();
      }
      if (mod && inside && e.key === "b") {
        e.preventDefault();
        this.setSidebarOpen(!this.sidebarOpen);
      }
      if (e.key === "Escape") {
        if (this.sidebar?.closeContextMenuIfOpen()) {
          e.preventDefault();
          return;
        }
        if (!inside) return;
        e.preventDefault();
        this.toggle(false);
      }
      if (e.key === "Tab") this.trapFocus(e);
    };
    document.addEventListener("keydown", this.keydownHandler);
  }
  bindViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    this.viewportHandler = () => {
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const px = overlap > 60 ? overlap : 0;
      this.panelWrap.style.transform = px ? `translateY(-${px}px)` : "";
    };
    vv.addEventListener("resize", this.viewportHandler);
    vv.addEventListener("scroll", this.viewportHandler);
  }
  focusables() {
    const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    return [...this.panel.querySelectorAll(sel)].filter(
      (e) => !e.hasAttribute("disabled") && e.offsetParent !== null
    );
  }
  trapFocus(e) {
    const items = this.focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = this.root.activeElement ?? document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
  async handleFiles() {
    const { readFileAttachment: readFileAttachment2 } = await Promise.resolve().then(() => (init_fileUpload(), fileUpload_exports));
    for (const file of Array.from(this.fileInput.files ?? [])) {
      const result = await readFileAttachment2(file, { imagesEnabled: this.opts.imagesEnabled });
      if ("error" in result) {
        this.addMessage("system", result.error);
      } else {
        this.pendingAttachments.push(result);
      }
    }
    this.fileInput.value = "";
    this.refreshAttachPreview();
  }
  refreshAttachPreview() {
    this.attachPreview.innerHTML = "";
    this.pendingAttachments.forEach((a, i) => {
      const tag = el2("span", "attach-tag");
      const label = el2("span");
      label.textContent = a.name;
      const rm = el2("button");
      rm.textContent = "\xD7";
      rm.setAttribute("aria-label", `Remove attachment ${a.name}`);
      rm.onclick = () => {
        this.pendingAttachments.splice(i, 1);
        this.refreshAttachPreview();
      };
      tag.append(label, rm);
      this.attachPreview.appendChild(tag);
    });
  }
  setSidebarOpen(open) {
    this.sidebarOpen = open;
    this.sidebar?.setCollapsed(!open);
    this.sidebarScrim?.classList.toggle("show", open);
  }
  setTheme(theme) {
    this.theme = theme;
    this.styleEl.textContent = this.themeStyle(theme);
  }
  setActiveChat(id) {
    this.sidebar?.setActive(id);
  }
  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add("show");
    setTimeout(() => this.toastEl.classList.remove("show"), 2200);
  }
  submit() {
    if (this.busy) return;
    const t = this.input.value.trim();
    if (!t && !this.pendingAttachments.length) return;
    this.input.value = "";
    const attachments = [...this.pendingAttachments];
    this.pendingAttachments = [];
    this.refreshAttachPreview();
    this.handlers.onSend(t, attachments.length ? attachments : void 0);
  }
  /** Lock/unlock all input affordances while a request is in flight. */
  setBusy(busy) {
    this.busy = busy;
    this.input.disabled = busy;
    this.sendBtn.disabled = busy;
    this.micBtn.disabled = busy;
    this.attachBtn.disabled = busy;
    this.log.querySelectorAll(".chip").forEach((c) => c.disabled = busy);
    if (busy) this.showTyping();
    else this.hideTyping();
  }
  showTyping() {
    if (this.typingEl) return;
    const t = el2("div", "typing");
    t.setAttribute("aria-label", "Assistant is thinking");
    t.innerHTML = "<span></span><span></span><span></span>";
    this.log.appendChild(t);
    this.typingEl = t;
    this.log.scrollTop = this.log.scrollHeight;
  }
  hideTyping() {
    this.typingEl?.remove();
    this.typingEl = void 0;
  }
  toggle(open) {
    const willOpen = open ?? !this.panelWrap.classList.contains("open");
    this.panelWrap.classList.toggle("open", willOpen);
    this.launcher.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) {
      this.lastFocused = document.activeElement ?? void 0;
      this.input.focus();
    } else {
      this.clearHighlight();
      (this.lastFocused ?? this.launcher).focus();
    }
    this.handlers.onToggle?.(willOpen);
  }
  setMic(on) {
    this.micBtn.classList.toggle("on", on);
    this.micBtn.setAttribute("aria-pressed", String(on));
    this.micBtn.setAttribute("aria-label", on ? "Stop listening" : "Speak to the assistant");
    if (!on) this.setMicCountdown(null);
  }
  /** Show a remaining-seconds badge on the mic during the server-STT capture window. */
  setMicCountdown(seconds) {
    if (seconds === null) {
      this.micBtn.classList.remove("counting");
      this.micCountdown.textContent = "";
    } else {
      this.micBtn.classList.add("counting");
      this.micCountdown.textContent = String(Math.ceil(seconds));
    }
  }
  setTtsEnabled(on) {
    this.ttsBtn.classList.toggle("on", on);
    this.ttsBtn.title = on ? "Read replies aloud (on)" : "Read replies aloud (off)";
    this.ttsBtn.setAttribute("aria-pressed", String(on));
  }
  clearLog() {
    this.clearConfirm();
    this.hideTyping();
    this.clearHighlight();
    this.log.innerHTML = "";
    this.typingEl = void 0;
  }
  loadMessages(messages) {
    this.clearLog();
    this.log.setAttribute("aria-live", "off");
    for (const m of messages) {
      if (m.role === "user" || m.role === "assistant" || m.role === "system") {
        this.addMessage(m.role, m.content);
      }
    }
    this.log.setAttribute("aria-live", "polite");
  }
  addMessage(role, text) {
    const m = el2("div", `msg ${role}`);
    m.textContent = text;
    this.log.appendChild(m);
    this.log.scrollTop = this.log.scrollHeight;
    return m;
  }
  /** Error bubble with readable styling and optional retry. */
  addError(text, onRetry) {
    const m = el2("div", "msg error");
    const line = el2("div");
    line.textContent = text;
    m.appendChild(line);
    if (onRetry) {
      const btn = el2("button", "retry");
      btn.textContent = "Retry";
      btn.onclick = () => {
        m.remove();
        onRetry();
      };
      m.appendChild(btn);
    }
    this.log.appendChild(m);
    this.log.scrollTop = this.log.scrollHeight;
    return m;
  }
  clearConfirm() {
    this.confirmRow?.remove();
    this.confirmRow = void 0;
  }
  /** Remove any stale confirm row (called when the controller clears `pending`). */
  removeConfirm() {
    this.clearConfirm();
  }
  addConfirm(preview) {
    this.clearConfirm();
    const wrap = el2("div", "msg assistant");
    wrap.textContent = preview;
    const row = el2("div", "confirm");
    const yes = el2("button", "yes");
    yes.textContent = "Confirm";
    const no = el2("button", "no");
    no.textContent = "Cancel";
    yes.onclick = () => {
      this.clearConfirm();
      this.clearHighlight();
      this.handlers.onConfirm(true);
    };
    no.onclick = () => {
      this.clearConfirm();
      this.clearHighlight();
      this.handlers.onConfirm(false);
    };
    row.append(yes, no);
    wrap.appendChild(row);
    this.log.appendChild(wrap);
    this.confirmRow = wrap;
    this.log.scrollTop = this.log.scrollHeight;
  }
  // ---- Visual action preview: highlight the control the assistant will operate ----
  /** Draw a highlight ring over a page element (in the shadow root). Defensive: no-op if gone. */
  highlightElement(selector) {
    this.clearHighlight();
    let target = null;
    try {
      target = document.querySelector(selector);
    } catch {
      return false;
    }
    if (!target) return false;
    const rect0 = target.getBoundingClientRect();
    if (!rect0.width && !rect0.height) return false;
    const ring = el2("div", "pa-highlight");
    this.root.appendChild(ring);
    this.highlightEl = ring;
    this.highlightTarget = target;
    const place = () => {
      if (!this.highlightEl || !this.highlightTarget) return;
      const r = this.highlightTarget.getBoundingClientRect();
      if (!r.width && !r.height) return;
      const pad = 4;
      this.highlightEl.style.top = `${r.top - pad}px`;
      this.highlightEl.style.left = `${r.left - pad}px`;
      this.highlightEl.style.width = `${r.width + pad * 2}px`;
      this.highlightEl.style.height = `${r.height + pad * 2}px`;
    };
    place();
    let scrollSettled = false;
    const onScrollEnd = () => {
      if (scrollSettled) return;
      scrollSettled = true;
      window.removeEventListener("scrollend", onScrollEnd);
      place();
    };
    if ("onscrollend" in window) {
      window.addEventListener("scrollend", onScrollEnd, { once: true });
    }
    let lastTop = rect0.top;
    let stableFrames = 0;
    let raf = 0;
    const settle = () => {
      if (!this.highlightEl) return;
      const t = this.highlightTarget.getBoundingClientRect().top;
      if (Math.abs(t - lastTop) < 0.5) {
        if (++stableFrames >= 3) {
          onScrollEnd();
          return;
        }
      } else {
        stableFrames = 0;
      }
      lastTop = t;
      place();
      raf = requestAnimationFrame(settle);
    };
    try {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
    }
    raf = requestAnimationFrame(settle);
    const reanchor = () => place();
    window.addEventListener("scroll", reanchor, { passive: true, capture: true });
    window.addEventListener("resize", reanchor, { passive: true });
    this.highlightReanchor = () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", reanchor, { capture: true });
      window.removeEventListener("resize", reanchor);
      window.removeEventListener("scrollend", onScrollEnd);
    };
    return true;
  }
  clearHighlight() {
    this.highlightReanchor?.();
    this.highlightReanchor = void 0;
    this.highlightTarget = void 0;
    this.highlightEl?.remove();
    this.highlightEl = void 0;
  }
  addSuggestions(items, onPick) {
    if (!items.length) return;
    const wrap = el2("div", "msg system");
    wrap.textContent = "Try:";
    const row = el2("div", "chips");
    for (const it of items.slice(0, 4)) {
      const c = el2("button", "chip");
      c.textContent = it.length > 48 ? it.slice(0, 46) + "\u2026" : it;
      c.title = it;
      c.onclick = () => {
        row.parentElement?.remove();
        onPick(it);
      };
      row.appendChild(c);
    }
    wrap.appendChild(row);
    this.log.appendChild(wrap);
    this.log.scrollTop = this.log.scrollHeight;
  }
  setState(s) {
    this.launcher.classList.remove("talking", "thinking", "listening", "scanning");
    if (s !== "idle") this.launcher.classList.add(s);
    this.scanline.classList.toggle("on", s === "scanning");
  }
  /** Tear down all DOM + listeners this UI created (for destroy()). */
  destroy() {
    if (this.keydownHandler) document.removeEventListener("keydown", this.keydownHandler);
    const vv = window.visualViewport;
    if (vv && this.viewportHandler) {
      vv.removeEventListener("resize", this.viewportHandler);
      vv.removeEventListener("scroll", this.viewportHandler);
    }
    this.sidebar?.destroy();
    this.clearHighlight();
    this.host.remove();
  }
};
function el2(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
var PHONE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8c1.5 2.9 3.7 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>`;

// src/scanner.ts
function scanPage(doc = document) {
  const controls = [];
  const push = (kind, el5, label) => {
    const text = label.trim().slice(0, 80);
    if (text) controls.push({ kind, label: text, selector: cssPath(el5) });
  };
  doc.querySelectorAll("a[href]").forEach((el5) => push("link", el5, el5.textContent || el5.getAttribute("aria-label") || ""));
  doc.querySelectorAll("button, [role=button]").forEach((el5) => push("button", el5, el5.textContent || el5.getAttribute("aria-label") || ""));
  doc.querySelectorAll("input, textarea").forEach((el5) => {
    const i = el5;
    push("input", el5, i.getAttribute("aria-label") || i.placeholder || i.name || i.type || "");
  });
  doc.querySelectorAll("select").forEach((el5) => push("select", el5, el5.getAttribute("aria-label") || el5.name || ""));
  const seen = /* @__PURE__ */ new Set();
  return controls.filter((c) => {
    const k = `${c.kind}:${c.label}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 60);
}
async function fullScan(doc = document, maxPages = 6) {
  const here = {
    url: location.href,
    title: doc.title,
    headings: [...doc.querySelectorAll("h1, h2")].map((h) => (h.textContent || "").trim()).filter(Boolean).slice(0, 20),
    links: [...doc.querySelectorAll("a[href]")].map((a) => ({ text: (a.textContent || "").trim(), href: a.href })).filter((l) => l.text && sameOrigin(l.href)).slice(0, 40)
  };
  const pages = [here];
  const targets = dedupe(here.links.map((l) => l.href)).filter((u) => u !== location.href).slice(0, maxPages - 1);
  await Promise.all(
    targets.map(async (url) => {
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        const html = await res.text();
        const d = new DOMParser().parseFromString(html, "text/html");
        pages.push({
          url,
          title: d.title,
          headings: [...d.querySelectorAll("h1, h2")].map((h) => (h.textContent || "").trim()).filter(Boolean).slice(0, 15),
          links: []
        });
      } catch {
      }
    })
  );
  return { scannedAt: (/* @__PURE__ */ new Date()).toISOString(), pages, controls: scanPage(doc) };
}
function sameOrigin(href) {
  try {
    return new URL(href, location.href).origin === location.origin;
  } catch {
    return false;
  }
}
function dedupe(a) {
  return [...new Set(a)];
}
function cssPath(el5) {
  if (el5.id) return `#${CSS.escape(el5.id)}`;
  const testid = el5.getAttribute("data-testid");
  if (testid) return `[data-testid="${testid}"]`;
  const parts = [];
  let node = el5;
  while (node && node.nodeType === 1 && parts.length < 5) {
    let sel = node.nodeName.toLowerCase();
    const parent = node.parentElement;
    if (parent) {
      const sibs = [...parent.children].filter((c) => c.nodeName === node.nodeName);
      if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(node) + 1})`;
    }
    parts.unshift(sel);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

// src/localMemory.ts
var KEY = "page-assistant-memory";
var MAX_FACTS2 = 200;
var LocalMemoryStore = class {
  load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "[]");
    } catch {
      return [];
    }
  }
  persist(facts) {
    try {
      localStorage.setItem(KEY, JSON.stringify(facts.slice(-MAX_FACTS2)));
    } catch {
    }
  }
  remember(fact) {
    const facts = this.load();
    facts.push({ ...fact, id: String(facts.length + 1), createdAt: (/* @__PURE__ */ new Date()).toISOString() });
    this.persist(facts);
  }
  recall(query, limit = 5) {
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    return this.load().map((f) => ({
      f,
      score: terms.reduce((s, t) => s + (`${f.topic} ${f.content}`.toLowerCase().includes(t) ? 1 : 0), 0)
    })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.f);
  }
};

// src/pageActions.ts
function pageActionCapabilities(getMap, rescan) {
  return [
    {
      name: "open_page_link",
      description: "Navigate to a link or click a button that exists on the current page, identified by its visible label (from the page scan).",
      tags: ["page"],
      confirm: true,
      parameters: {
        type: "object",
        properties: { label: { type: "string", description: "Visible text of the link/button, e.g. 'Pricing' or 'Sign in'." } },
        required: ["label"]
      },
      run: ({ label }) => {
        const map = getMap();
        if (!map) throw new Error("The page hasn't been scanned yet.");
        const want = label.trim().toLowerCase();
        const exact = map.controls.filter((c) => c.label.trim().toLowerCase() === want);
        if (exact.length > 1) {
          throw new Error(`Multiple controls match "${label}" \u2014 be more specific.`);
        }
        const hit = exact[0];
        if (!hit) {
          throw new Error(`No link or button labelled "${label}" on this page.`);
        }
        const el5 = document.querySelector(hit.selector);
        if (!el5) throw new Error(`"${hit.label}" was on the page at scan time but is gone now.`);
        el5.click();
        return { clicked: hit.label, kind: hit.kind };
      },
      render: (r) => `Opened "${r.clicked}".`
    },
    {
      name: "rescan_page",
      description: "Re-read the current page (after navigation or when content changed) and refresh the map of links, buttons and inputs.",
      tags: ["page"],
      parameters: { type: "object", properties: {} },
      run: async () => {
        const map = await rescan();
        return { pages: map.pages.length, controls: map.controls.length };
      },
      render: (r) => `Re-read the page: ${r.pages} pages, ${r.controls} interactive controls mapped.`
    }
  ];
}

// src/settings.ts
var VOICE_SETTINGS_STORAGE_KEY = "page_assistant_voice_settings";
var VOICE_SETTINGS_CHANGE_EVENT = "pa-voice-settings-change";
var BROWSER_ONLY_CAPABILITIES = {
  tts: { server: false, providers: [] },
  stt: { server: false }
};
async function fetchVoiceCapabilities(serverUrl, signal, authToken) {
  if (!serverUrl || typeof fetch === "undefined") return BROWSER_ONLY_CAPABILITIES;
  const base = serverUrl.replace(/\/$/, "");
  try {
    const headers = {};
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    const res = await fetch(`${base}/v1/voice/capabilities`, { signal, headers });
    if (!res.ok) return BROWSER_ONLY_CAPABILITIES;
    const raw = await res.json();
    return {
      tts: {
        server: Boolean(raw?.tts?.server),
        providers: Array.isArray(raw?.tts?.providers) ? raw.tts.providers : []
      },
      stt: { server: Boolean(raw?.stt?.server) }
    };
  } catch {
    return BROWSER_ONLY_CAPABILITIES;
  }
}
var DEFAULTS = {
  autoSpeak: false,
  ttsMode: "server",
  ttsProvider: "elevenlabs",
  elevenLabsVoiceId: "21m00Tcm4TlvDq8ikWAM",
  openaiVoice: "nova",
  sttMode: "browser"
};
var ELEVENLABS_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel \u2014 warm US" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Sarah \u2014 soft US" },
  { id: "pNInz6obpgDQGcFmaJgB", label: "Adam \u2014 deep US" },
  { id: "TxGEqnHWrfWFTfGW9XjX", label: "Josh \u2014 young US" },
  { id: "VR6AewLTigWG4xSOukaG", label: "Arnold \u2014 crisp" },
  { id: "AZnzlk1XvdvUeBnXmlld", label: "Domi \u2014 strong US" },
  { id: "MF3mGyEYCl7XYWbV9V6O", label: "Elli \u2014 young US" },
  { id: "ErXwobaYiN019PkySvjV", label: "Antoni \u2014 warm" },
  { id: "onwK4e9ZLuTAKqWW03F9", label: "Daniel \u2014 British" },
  { id: "XB0fDUnXU5powFXDhCwa", label: "Charlotte \u2014 Swedish-English" }
];
var OPENAI_VOICES = [
  { id: "nova", label: "Nova (natural)" },
  { id: "shimmer", label: "Shimmer (warm)" },
  { id: "alloy", label: "Alloy (neutral)" },
  { id: "echo", label: "Echo (male)" },
  { id: "fable", label: "Fable (British)" },
  { id: "onyx", label: "Onyx (deep)" }
];
function getVoiceSettings(storageKey = VOICE_SETTINGS_STORAGE_KEY) {
  if (typeof localStorage === "undefined") return DEFAULTS;
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(storageKey) || "{}") };
  } catch {
    return DEFAULTS;
  }
}
function setVoiceSettings(patch, storageKey = VOICE_SETTINGS_STORAGE_KEY) {
  const next = { ...getVoiceSettings(storageKey), ...patch };
  localStorage.setItem(storageKey, JSON.stringify(next));
  window.dispatchEvent(new Event(VOICE_SETTINGS_CHANGE_EVENT));
  return next;
}
function voiceOptionsFromSettings(serverUrl, settings = getVoiceSettings()) {
  const voiceId = settings.ttsProvider === "elevenlabs" ? settings.elevenLabsVoiceId : settings.openaiVoice;
  return {
    serverUrl,
    ttsMode: settings.ttsMode,
    ttsProvider: settings.ttsProvider,
    voiceId,
    sttMode: settings.sttMode
  };
}

// src/settings-ui.ts
var CSS3 = `
* { box-sizing: border-box; font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; }
.wrap { color: #e7f5ec; font-size: 14px; line-height: 1.45; }
.hint { margin: 0 0 14px; font-size: 13px; color: #9ab4a6; }
.row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.label { width: 140px; flex-shrink: 0; color: #9ab4a6; font-size: 13px; }
.field { flex: 1; min-width: 180px; }
select, label.field { display: block; width: 100%; max-width: 320px; }
select {
  background: #0b1310; border: 1px solid #244234; color: #e7f5ec;
  border-radius: 8px; padding: 8px 10px; font-size: 14px;
}
.check { display: flex; align-items: center; gap: 8px; cursor: pointer; max-width: 320px; }
.modal-backdrop {
  position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.55);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.modal {
  width: min(480px, 100%); max-height: 90vh; overflow: auto;
  background: #0f1715; border: 1px solid #1f3a2c; border-radius: 16px;
  padding: 18px 20px; box-shadow: 0 20px 60px rgba(0,0,0,.5);
}
.modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.modal-head h2 { margin: 0; font-size: 18px; font-weight: 600; }
.modal-foot { margin-top: 16px; display: flex; justify-content: flex-end; gap: 10px; align-items: center; }
.btn {
  border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer; font-size: 14px; font-weight: 500;
}
.btn-ghost { background: transparent; color: #9ab4a6; }
.btn-ghost:hover { color: #e7f5ec; }
.btn-primary { background: #16a34a; color: #fff; }
.btn-primary:hover { background: #15803d; }
.link { color: #9ab4a6; font-size: 13px; text-decoration: none; }
.link:hover { color: #e7f5ec; }
`;
function renderForm(root, storageKey) {
  root.innerHTML = "";
  const wrap = el3("div", "wrap");
  const hint = el3("p", "hint");
  hint.textContent = "Text replies are free. Read-aloud uses your browser or the server (ElevenLabs / OpenAI). Mic defaults to the free browser recognizer; server Whisper costs per minute.";
  wrap.appendChild(hint);
  const addRow2 = (label, field) => {
    const row = el3("div", "row");
    const lab = el3("span", "label");
    lab.textContent = label;
    row.append(lab, field);
    wrap.appendChild(row);
  };
  const speakLabel = el3("label", "check field");
  const speakCb = el3("input");
  speakCb.type = "checkbox";
  const speakText = el3("span");
  const refreshSpeak = () => {
    const s = getVoiceSettings(storageKey);
    speakCb.checked = s.autoSpeak;
    speakText.textContent = s.autoSpeak ? "On (\u260E in assistant)" : "Off \u2014 text only (default)";
  };
  speakCb.onchange = () => {
    setVoiceSettings({ autoSpeak: speakCb.checked }, storageKey);
    refreshSpeak();
  };
  speakLabel.append(speakCb, speakText);
  refreshSpeak();
  addRow2("Read aloud", speakLabel);
  const ttsSel = el3("select", "field");
  ttsSel.innerHTML = `<option value="browser">Browser (free, robotic)</option><option value="server">Server \u2014 ElevenLabs / OpenAI</option>`;
  addRow2("Speech engine", ttsSel);
  const serverBlock = el3("div");
  wrap.appendChild(serverBlock);
  const renderServerRows = () => {
    const s = getVoiceSettings(storageKey);
    ttsSel.value = s.ttsMode;
    serverBlock.innerHTML = "";
    if (s.ttsMode !== "server") return;
    const provRow = el3("div", "row");
    provRow.innerHTML = `<span class="label">Provider</span>`;
    const provSel = el3("select", "field");
    provSel.innerHTML = `<option value="elevenlabs">ElevenLabs (recommended)</option><option value="openai">OpenAI TTS</option>`;
    provSel.value = s.ttsProvider;
    provSel.onchange = () => {
      setVoiceSettings({ ttsProvider: provSel.value }, storageKey);
      renderServerRows();
    };
    provRow.appendChild(provSel);
    serverBlock.appendChild(provRow);
    const voiceRow = el3("div", "row");
    voiceRow.innerHTML = `<span class="label">Voice</span>`;
    const voiceSel = el3("select", "field");
    const list = s.ttsProvider === "elevenlabs" ? ELEVENLABS_VOICES : OPENAI_VOICES;
    voiceSel.innerHTML = list.map((v) => `<option value="${v.id}">${escapeHtml2(v.label)}</option>`).join("");
    voiceSel.value = s.ttsProvider === "elevenlabs" ? s.elevenLabsVoiceId : s.openaiVoice;
    voiceSel.onchange = () => {
      if (getVoiceSettings(storageKey).ttsProvider === "elevenlabs") {
        setVoiceSettings({ elevenLabsVoiceId: voiceSel.value }, storageKey);
      } else {
        setVoiceSettings({ openaiVoice: voiceSel.value }, storageKey);
      }
    };
    voiceRow.appendChild(voiceSel);
    serverBlock.appendChild(voiceRow);
  };
  ttsSel.onchange = () => {
    setVoiceSettings({ ttsMode: ttsSel.value }, storageKey);
    renderServerRows();
  };
  renderServerRows();
  const sttSel = el3("select", "field");
  sttSel.innerHTML = `<option value="browser">Browser (free)</option><option value="server">Server \u2014 Whisper</option>`;
  sttSel.value = getVoiceSettings(storageKey).sttMode;
  sttSel.onchange = () => {
    setVoiceSettings({ sttMode: sttSel.value }, storageKey);
  };
  addRow2("Mic input", sttSel);
  root.appendChild(wrap);
  const onExternal = () => {
    refreshSpeak();
    renderServerRows();
    sttSel.value = getVoiceSettings(storageKey).sttMode;
  };
  window.addEventListener(VOICE_SETTINGS_CHANGE_EVENT, onExternal);
  return () => window.removeEventListener(VOICE_SETTINGS_CHANGE_EVENT, onExternal);
}
function mountVoiceSettingsPanel(container, opts = {}) {
  const storageKey = opts.storageKey ?? VOICE_SETTINGS_STORAGE_KEY;
  const host = document.createElement("div");
  container.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS3;
  shadow.appendChild(style);
  const formRoot = el3("div");
  shadow.appendChild(formRoot);
  const cleanupForm = renderForm(formRoot, storageKey);
  return () => {
    cleanupForm();
    host.remove();
  };
}
var modalHost;
function openVoiceSettingsModal(opts = {}) {
  closeVoiceSettingsModal();
  const storageKey = opts.storageKey ?? VOICE_SETTINGS_STORAGE_KEY;
  const title = opts.title ?? "Page assistant";
  modalHost = document.createElement("div");
  document.body.appendChild(modalHost);
  const shadow = modalHost.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS3;
  shadow.appendChild(style);
  const backdrop = el3("div", "modal-backdrop");
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-label", title);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeVoiceSettingsModal();
  };
  const modal = el3("div", "modal");
  modal.onclick = (e) => e.stopPropagation();
  const head = el3("div", "modal-head");
  const h2 = el3("h2");
  h2.textContent = title;
  const closeBtn = el3("button", "btn btn-ghost");
  closeBtn.textContent = "\xD7";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.onclick = () => closeVoiceSettingsModal();
  head.append(h2, closeBtn);
  const formRoot = el3("div");
  const cleanupForm = renderForm(formRoot, storageKey);
  const foot = el3("div", "modal-foot");
  if (opts.settingsPageUrl) {
    const link = el3("a", "link");
    link.href = opts.settingsPageUrl;
    link.textContent = "All settings \u2192";
    link.onclick = () => closeVoiceSettingsModal();
    foot.appendChild(link);
  }
  const done = el3("button", "btn btn-primary");
  done.textContent = "Done";
  done.onclick = () => closeVoiceSettingsModal();
  foot.appendChild(done);
  modal.append(head, formRoot, foot);
  backdrop.appendChild(modal);
  shadow.appendChild(backdrop);
  const prevCleanup = modalHost._cleanup;
  modalHost._cleanup = () => {
    cleanupForm();
    prevCleanup?.();
  };
}
function closeVoiceSettingsModal() {
  if (!modalHost) return;
  modalHost._cleanup?.();
  modalHost.remove();
  modalHost = void 0;
}
function el3(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function escapeHtml2(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// src/assistant-settings.ts
var ASSISTANT_SETTINGS_STORAGE_KEY = "page_assistant_settings";
var ASSISTANT_SETTINGS_CHANGE_EVENT = "page-assistant-settings-change";
var DEFAULT_MODELS = [
  { id: "gpt-4o-mini", label: "GPT-4o Mini (fast)", provider: "openai" },
  { id: "gpt-4o", label: "GPT-4o (smart)", provider: "openai" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fast)", provider: "anthropic" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (smart)", provider: "anthropic" },
  { id: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku (OpenRouter)", provider: "openrouter" }
];
var DEFAULTS2 = {
  model: "gpt-4o-mini",
  theme: "dark",
  sidebarOpen: true,
  analyticsEnabled: false
};
function getAssistantSettings(storageKey = ASSISTANT_SETTINGS_STORAGE_KEY) {
  if (typeof localStorage === "undefined") return { ...DEFAULTS2 };
  try {
    return { ...DEFAULTS2, ...JSON.parse(localStorage.getItem(storageKey) || "{}") };
  } catch {
    return { ...DEFAULTS2 };
  }
}
function setAssistantSettings(patch, storageKey = ASSISTANT_SETTINGS_STORAGE_KEY) {
  const next = { ...getAssistantSettings(storageKey), ...patch };
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(storageKey, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(ASSISTANT_SETTINGS_CHANGE_EVENT, { detail: next }));
  }
  return next;
}

// src/settings-ui-shared.ts
var CSS4 = `
* { box-sizing: border-box; font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; }
.wrap { color: #e7f5ec; font-size: 14px; line-height: 1.45; }
.hint { margin: 0 0 14px; font-size: 13px; color: #9ab4a6; }
.row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.label { width: 140px; flex-shrink: 0; color: #9ab4a6; font-size: 13px; }
.field { flex: 1; min-width: 180px; }
select, label.field { display: block; width: 100%; max-width: 320px; }
select {
  background: #0b1310; border: 1px solid #244234; color: #e7f5ec;
  border-radius: 8px; padding: 8px 10px; font-size: 14px;
}
.check { display: flex; align-items: center; gap: 8px; cursor: pointer; max-width: 320px; }
.modal-backdrop {
  position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.55);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.modal {
  width: min(520px, 100%); max-height: 90vh; overflow: auto;
  background: #0f1715; border: 1px solid #1f3a2c; border-radius: 16px;
  padding: 18px 20px; box-shadow: 0 20px 60px rgba(0,0,0,.5);
}
.modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.modal-head h2 { margin: 0; font-size: 18px; font-weight: 600; }
.modal-foot { margin-top: 16px; display: flex; justify-content: flex-end; gap: 10px; align-items: center; }
.btn {
  border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer; font-size: 14px; font-weight: 500;
}
.btn-ghost { background: transparent; color: #9ab4a6; }
.btn-ghost:hover { color: #e7f5ec; }
.btn-primary { background: #16a34a; color: #fff; }
.btn-primary:hover { background: #15803d; }
.link { color: #9ab4a6; font-size: 13px; text-decoration: none; }
.link:hover { color: #e7f5ec; }
`;

// src/assistant-settings-ui.ts
var TABS = ["General", "Voice", "Data"];
function mountAssistantSettingsPanel(container, opts = {}) {
  const storageKey = opts.storageKey ?? ASSISTANT_SETTINGS_STORAGE_KEY;
  const voiceKey = opts.voiceStorageKey ?? VOICE_SETTINGS_STORAGE_KEY;
  const host = document.createElement("div");
  container.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS4 + EXTRA_CSS;
  shadow.appendChild(style);
  let activeTab = "General";
  const root = el4("div", "wrap");
  shadow.appendChild(root);
  let caps = BROWSER_ONLY_CAPABILITIES;
  const render = () => {
    root.innerHTML = "";
    const tabs = el4("div", "tabs");
    for (const t of TABS) {
      const btn = el4("button", `tab${activeTab === t ? " active" : ""}`);
      btn.textContent = t;
      btn.onclick = () => {
        activeTab = t;
        render();
      };
      tabs.appendChild(btn);
    }
    root.appendChild(tabs);
    const body = el4("div", "tab-body");
    if (activeTab === "General") renderGeneral(body, storageKey);
    else if (activeTab === "Voice") renderVoice(body, voiceKey, caps);
    else renderData(body, opts.chatStore);
    root.appendChild(body);
  };
  render();
  const abort = new AbortController();
  fetchVoiceCapabilities(opts.serverUrl, abort.signal, opts.authToken).then((c) => {
    caps = c;
    if (activeTab === "Voice") render();
  });
  const onChange = () => render();
  window.addEventListener(ASSISTANT_SETTINGS_CHANGE_EVENT, onChange);
  window.addEventListener(VOICE_SETTINGS_CHANGE_EVENT, onChange);
  return () => {
    abort.abort();
    window.removeEventListener(ASSISTANT_SETTINGS_CHANGE_EVENT, onChange);
    window.removeEventListener(VOICE_SETTINGS_CHANGE_EVENT, onChange);
    host.remove();
  };
}
function renderGeneral(root, storageKey) {
  const s = getAssistantSettings(storageKey);
  addRow(root, "Model", () => {
    const sel = el4("select", "field");
    sel.innerHTML = DEFAULT_MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join("");
    sel.value = s.model;
    sel.onchange = () => setAssistantSettings({ model: sel.value }, storageKey);
    return sel;
  });
  const modelNote = el4("p", "hint");
  modelNote.style.margin = "-6px 0 12px 152px";
  modelNote.textContent = "Models depend on the server's configured providers \u2014 an unsupported one will error when you send.";
  root.appendChild(modelNote);
  addRow(root, "Theme", () => {
    const sel = el4("select", "field");
    sel.innerHTML = `<option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option>`;
    sel.value = s.theme;
    sel.onchange = () => setAssistantSettings({ theme: sel.value }, storageKey);
    return sel;
  });
  addRow(root, "Chat sidebar", () => {
    const lab = el4("label", "check field");
    const cb = el4("input");
    cb.type = "checkbox";
    cb.checked = s.sidebarOpen;
    cb.onchange = () => setAssistantSettings({ sidebarOpen: cb.checked }, storageKey);
    lab.append(cb, el4("span", void 0, "Show history sidebar by default"));
    return lab;
  });
  addRow(root, "Analytics", () => {
    const lab = el4("label", "check field");
    const cb = el4("input");
    cb.type = "checkbox";
    cb.checked = s.analyticsEnabled;
    cb.onchange = () => setAssistantSettings({ analyticsEnabled: cb.checked }, storageKey);
    lab.append(cb, el4("span", void 0, "Send anonymous usage events to server"));
    return lab;
  });
}
function renderVoice(root, voiceKey, caps) {
  const hint = el4("p", "hint");
  hint.textContent = "Voice settings apply to read-aloud and microphone input.";
  root.appendChild(hint);
  const speakLabel = el4("label", "check field");
  const speakCb = el4("input");
  speakCb.type = "checkbox";
  speakCb.checked = getVoiceSettings(voiceKey).autoSpeak;
  speakCb.onchange = () => setVoiceSettings({ autoSpeak: speakCb.checked }, voiceKey);
  speakLabel.append(speakCb, el4("span", void 0, "Read replies aloud"));
  addRow(root, "Read aloud", () => speakLabel);
  const vs = getVoiceSettings(voiceKey);
  const serverTts = caps.tts.server;
  const serverStt = caps.stt.server;
  const ttsSel = el4("select", "field");
  ttsSel.innerHTML = `<option value="browser">Browser (free)</option><option value="server"${serverTts ? "" : " disabled"}>Server TTS${serverTts ? "" : " (not configured)"}</option>`;
  ttsSel.value = vs.ttsMode;
  ttsSel.onchange = () => setVoiceSettings({ ttsMode: ttsSel.value }, voiceKey);
  addRow(root, "Speech engine", () => ttsSel);
  const sttSel = el4("select", "field");
  sttSel.innerHTML = `<option value="browser">Browser mic</option><option value="server"${serverStt ? "" : " disabled"}>Server Whisper${serverStt ? "" : " (not configured)"}</option>`;
  sttSel.value = vs.sttMode;
  sttSel.onchange = () => setVoiceSettings({ sttMode: sttSel.value }, voiceKey);
  addRow(root, "Mic input", () => sttSel);
  if (vs.ttsMode === "server") {
    const provSel = el4("select", "field");
    const provOpts = [
      ["elevenlabs", "ElevenLabs"],
      ["openai", "OpenAI"]
    ];
    provSel.innerHTML = provOpts.map(([id, label]) => {
      const ok = !serverTts || caps.tts.providers.length === 0 || caps.tts.providers.includes(id);
      return `<option value="${id}"${ok ? "" : " disabled"}>${label}${ok ? "" : " (no server key)"}</option>`;
    }).join("");
    provSel.value = vs.ttsProvider;
    provSel.onchange = () => setVoiceSettings({ ttsProvider: provSel.value }, voiceKey);
    addRow(root, "TTS provider", () => provSel);
    const voiceSel = el4("select", "field");
    const list = vs.ttsProvider === "elevenlabs" ? ELEVENLABS_VOICES : OPENAI_VOICES;
    voiceSel.innerHTML = list.map((v) => `<option value="${v.id}">${v.label}</option>`).join("");
    voiceSel.value = vs.ttsProvider === "elevenlabs" ? vs.elevenLabsVoiceId : vs.openaiVoice;
    voiceSel.onchange = () => {
      if (getVoiceSettings(voiceKey).ttsProvider === "elevenlabs") {
        setVoiceSettings({ elevenLabsVoiceId: voiceSel.value }, voiceKey);
      } else {
        setVoiceSettings({ openaiVoice: voiceSel.value }, voiceKey);
      }
    };
    addRow(root, "Voice", () => voiceSel);
  }
  const note = el4("p", "hint");
  note.style.marginTop = "12px";
  if (!serverTts && !serverStt) {
    note.textContent = "This server has no voice keys configured, so only the free browser voice and mic are available. Server TTS/STT (ElevenLabs \xB7 OpenAI \xB7 Whisper) are greyed out.";
    root.appendChild(note);
  } else if (vs.ttsMode === "server" && !serverTts || vs.sttMode === "server" && !serverStt) {
    note.textContent = "A saved option isn't available on this server and will fall back to the browser. Greyed-out choices need a server API key.";
    root.appendChild(note);
  } else if (!serverTts || !serverStt) {
    note.textContent = "Greyed-out server options aren't configured on this server; the browser handles them for free.";
    root.appendChild(note);
  }
}
function renderData(root, chatStore) {
  const hint = el4("p", "hint");
  hint.textContent = "Export or import your chat history. Data stays in your browser unless you share it.";
  root.appendChild(hint);
  const exportBtn = el4("button", "btn btn-primary");
  exportBtn.textContent = "Export all chats (JSON)";
  exportBtn.onclick = () => {
    if (!chatStore) return;
    downloadFile("page-assistant-chats.json", chatStore.exportAll());
  };
  root.appendChild(exportBtn);
  const importLabel = el4("label", "btn btn-ghost");
  importLabel.textContent = "Import chats\u2026";
  const importInput = el4("input");
  importInput.type = "file";
  importInput.accept = ".json";
  importInput.style.display = "none";
  importInput.onchange = async () => {
    const file = importInput.files?.[0];
    if (!file || !chatStore) return;
    const ok = chatStore.importAll(await file.text());
    alert(ok ? "Imported successfully" : "Invalid backup file");
    importInput.value = "";
  };
  importLabel.appendChild(importInput);
  importLabel.onclick = () => importInput.click();
  root.appendChild(importLabel);
}
var modalHost2;
function openAssistantSettingsModal(opts = {}) {
  closeAssistantSettingsModal();
  modalHost2 = document.createElement("div");
  document.body.appendChild(modalHost2);
  const shadow = modalHost2.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS4 + EXTRA_CSS;
  shadow.appendChild(style);
  const backdrop = el4("div", "modal-backdrop");
  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeAssistantSettingsModal();
  };
  const modal = el4("div", "modal");
  modal.onclick = (e) => e.stopPropagation();
  const head = el4("div", "modal-head");
  const h2 = el4("h2");
  h2.textContent = opts.title ?? "Assistant settings";
  const closeBtn = el4("button", "btn btn-ghost");
  closeBtn.textContent = "\xD7";
  closeBtn.onclick = () => closeAssistantSettingsModal();
  head.append(h2, closeBtn);
  const mount = el4("div");
  modal.append(head, mount);
  backdrop.appendChild(modal);
  shadow.appendChild(backdrop);
  const cleanup = mountAssistantSettingsPanel(mount, opts);
  modalHost2._cleanup = cleanup;
}
function closeAssistantSettingsModal() {
  if (!modalHost2) return;
  modalHost2._cleanup?.();
  modalHost2.remove();
  modalHost2 = void 0;
}
var EXTRA_CSS = `
.tabs { display: flex; gap: 4px; margin-bottom: 14px; border-bottom: 1px solid #244234; padding-bottom: 8px; }
.tab { background: none; border: none; color: #9ab4a6; padding: 6px 12px; cursor: pointer; border-radius: 6px; font-size: 13px; }
.tab.active { background: #1d3328; color: #e7f5ec; }
.tab-body { min-height: 200px; }
.btn { margin-top: 8px; display: inline-block; }
`;
function addRow(root, label, fieldFn) {
  const row = el4("div", "row");
  const lab = el4("span", "label");
  lab.textContent = label;
  row.append(lab, fieldFn());
  root.appendChild(row);
}
function downloadFile(name, content) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function el4(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

// src/index.ts
init_fileUpload();

// src/analytics.ts
var LOCAL_KEY = "page_assistant_analytics";
var MAX_EVENTS = 500;
function trackEvent(type, meta, serverUrl, authToken) {
  const ev = { type, ts: (/* @__PURE__ */ new Date()).toISOString(), meta };
  appendLocal(ev);
  if (serverUrl) {
    const headers = { "content-type": "application/json" };
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    fetch(`${serverUrl.replace(/\/$/, "")}/v1/analytics`, {
      method: "POST",
      headers,
      body: JSON.stringify(ev),
      keepalive: true
    }).catch(() => {
    });
  }
}
function appendLocal(ev) {
  if (typeof localStorage === "undefined") return;
  try {
    const list = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
    list.push(ev);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(-MAX_EVENTS)));
  } catch {
  }
}
function getLocalAnalytics() {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function exportAnalyticsMarkdown() {
  const events = getLocalAnalytics();
  const lines = ["# Page Assistant Analytics", "", `Exported: ${(/* @__PURE__ */ new Date()).toISOString()}`, ""];
  for (const e of events.slice(-100)) {
    lines.push(`- **${e.type}** @ ${e.ts}${e.meta ? ` \u2014 ${JSON.stringify(e.meta)}` : ""}`);
  }
  return lines.join("\n");
}

// src/capability.ts
function capability(c) {
  return c;
}

// src/index.ts
init_fileUpload();
var PageAssistantController = class {
  constructor(cfg) {
    this.cfg = cfg;
    __publicField(this, "assistant");
    __publicField(this, "ui");
    __publicField(this, "voice");
    __publicField(this, "history", []);
    __publicField(this, "chatStore");
    __publicField(this, "activeChatId", null);
    __publicField(this, "scanned", false);
    __publicField(this, "listening", false);
    __publicField(this, "ttsEnabled");
    __publicField(this, "pending");
    __publicField(this, "map");
    __publicField(this, "settingsKey");
    __publicField(this, "assistantSettingsKey");
    __publicField(this, "onSettingsChange");
    __publicField(this, "onAssistantSettingsChange");
    __publicField(this, "lastTurn");
    __publicField(this, "greetedChatId", null);
    __publicField(this, "notedSttFallback", false);
    __publicField(this, "destroyed", false);
    this.settingsKey = cfg.settingsStorageKey ?? VOICE_SETTINGS_STORAGE_KEY;
    this.assistantSettingsKey = cfg.assistantSettingsStorageKey ?? ASSISTANT_SETTINGS_STORAGE_KEY;
    const assistantSettings = getAssistantSettings(this.assistantSettingsKey);
    const stored = getVoiceSettings(this.settingsKey);
    const useStored = cfg.useVoiceSettings !== false;
    this.ttsEnabled = cfg.autoSpeak ?? (useStored ? stored.autoSpeak : false);
    this.chatStore = new ChatHistoryStore(cfg.chatHistoryStorageKey);
    if (!cfg.disableChatHistory) {
      const active = this.chatStore.getActive();
      if (active) {
        this.activeChatId = active.id;
        this.history = [...active.messages];
      } else {
        const created = this.chatStore.create({ model: assistantSettings.model });
        this.activeChatId = created.id;
      }
    }
    const memory = cfg.memory === "session" ? new InMemoryStore() : new LocalMemoryStore();
    const builtins = [
      rememberFactCapability,
      ...pageActionCapabilities(
        () => this.map,
        async () => {
          this.map = await fullScan();
          return this.map;
        }
      )
    ].filter((b) => !cfg.capabilities.some((c) => c.name === b.name));
    this.assistant = new Assistant({
      capabilities: [...cfg.capabilities, ...builtins],
      llm: proxyProvider(
        cfg.serverUrl,
        cfg.authToken,
        () => getAssistantSettings(this.assistantSettingsKey).model,
        cfg.requestTimeoutMs
      ),
      memory,
      appName: cfg.appName,
      persona: cfg.persona,
      knowledge: cfg.knowledge,
      suggestions: cfg.suggestions
    });
    if (cfg.voice !== false) {
      let vo;
      if (cfg.voice === true || cfg.voice === void 0) {
        vo = useStored ? voiceOptionsFromSettings(cfg.serverUrl, stored) : { serverUrl: cfg.serverUrl };
      } else {
        vo = { serverUrl: cfg.serverUrl, ...cfg.voice };
      }
      if (cfg.authToken) vo = { ...vo, authToken: cfg.authToken };
      this.voice = new Voice(vo);
    }
    const settingsUiOpts = {
      storageKey: this.settingsKey,
      settingsPageUrl: cfg.settingsPageUrl,
      title: cfg.appName ? `${cfg.appName} assistant` : "Page assistant",
      chatStore: cfg.disableChatHistory ? void 0 : this.chatStore,
      serverUrl: cfg.serverUrl,
      authToken: cfg.authToken
    };
    this.ui = new WidgetUI(cfg.appName ?? "Assistant", {
      onSend: (t, attachments) => this.handleUser(t, attachments),
      onMic: () => this.toggleMic(),
      onConfirm: (ok) => this.handleConfirm(ok),
      onToggle: (open) => this.handleToggle(open),
      onSettings: () => cfg.onSettings?.() ?? (cfg.useExtendedSettings !== false ? openAssistantSettingsModal(settingsUiOpts) : openVoiceSettingsModal(settingsUiOpts)),
      onTtsToggle: (on) => {
        this.ttsEnabled = on;
      },
      onNewChat: () => this.newChat(),
      onSelectChat: (id) => this.switchChat(id),
      onExportChat: () => this.exportCurrentChat(),
      onDeleteChat: (id) => this.deleteChat(id),
      onArchiveChat: (id) => this.archiveChat(id)
    }, {
      chatStore: cfg.disableChatHistory ? void 0 : this.chatStore,
      theme: assistantSettings.theme,
      sidebarOpen: assistantSettings.sidebarOpen,
      imagesEnabled: cfg.imagesEnabled
    });
    if (this.activeChatId && this.history.length) {
      this.ui.loadMessages(this.displayHistory());
      this.ui.setActiveChat(this.activeChatId);
      this.greetedChatId = this.activeChatId;
    }
    this.ui.setTtsEnabled(this.ttsEnabled);
    this.onSettingsChange = () => {
      if (cfg.useVoiceSettings === false || cfg.voice === false) return;
      const s = getVoiceSettings(this.settingsKey);
      this.updateConfig({
        autoSpeak: cfg.autoSpeak ?? s.autoSpeak,
        voice: voiceOptionsFromSettings(cfg.serverUrl, s)
      });
    };
    this.onAssistantSettingsChange = () => {
      const s = getAssistantSettings(this.assistantSettingsKey);
      this.ui.setTheme(s.theme);
      this.ui.setSidebarOpen(s.sidebarOpen);
    };
    window.addEventListener(VOICE_SETTINGS_CHANGE_EVENT, this.onSettingsChange);
    window.addEventListener(ASSISTANT_SETTINGS_CHANGE_EVENT, this.onAssistantSettingsChange);
    injectDiscoveryHint(cfg.serverUrl, cfg.knowledgeUrl, () => !this.destroyed);
  }
  dispose() {
    window.removeEventListener(VOICE_SETTINGS_CHANGE_EVENT, this.onSettingsChange);
    window.removeEventListener(ASSISTANT_SETTINGS_CHANGE_EVENT, this.onAssistantSettingsChange);
  }
  /** Full teardown for SPA/React strict-mode remounts: listeners, timers, voice, DOM. */
  destroy() {
    this.destroyed = true;
    this.dispose();
    this.voice?.cancelListen();
    this.voice?.stop();
    this.voice = void 0;
    this.pending = void 0;
    closeAssistantSettingsModal();
    closeVoiceSettingsModal();
    this.ui.destroy();
    removeDiscoveryHint();
  }
  updateConfig(patch) {
    if (patch.autoSpeak !== void 0) {
      this.ttsEnabled = patch.autoSpeak;
      this.ui.setTtsEnabled(this.ttsEnabled);
    }
    if (patch.voice !== void 0) {
      if (patch.voice === false) {
        this.voice = void 0;
      } else {
        const vo = patch.voice === true ? { serverUrl: this.cfg.serverUrl, authToken: this.cfg.authToken } : { serverUrl: this.cfg.serverUrl, authToken: this.cfg.authToken, ...patch.voice };
        this.voice = new Voice(vo);
      }
    }
  }
  newChat() {
    const model = getAssistantSettings(this.assistantSettingsKey).model;
    const session = this.chatStore.create({ model });
    this.activeChatId = session.id;
    this.history = [];
    this.clearPending();
    this.ui.clearLog();
    this.ui.setActiveChat(session.id);
    this.showGreeting();
    this.track("chat_new", { id: session.id });
  }
  /** Show greeting + suggestions once per empty chat (also fires on New chat). */
  showGreeting() {
    if (this.history.length) return;
    if (this.greetedChatId === this.activeChatId) return;
    this.greetedChatId = this.activeChatId;
    if (this.cfg.greeting) this.ui.addMessage("assistant", this.cfg.greeting);
    if (this.cfg.suggestions?.length) {
      this.ui.addSuggestions(this.cfg.suggestions, (t) => this.handleUser(t));
    }
  }
  clearPending() {
    this.pending = void 0;
    this.ui.removeConfirm();
    this.ui.clearHighlight();
  }
  deleteChat(id) {
    const wasActive = id === this.activeChatId;
    this.chatStore.delete(id);
    if (wasActive) {
      const next = this.chatStore.getActive();
      if (next) {
        this.activeChatId = next.id;
        this.history = [...next.messages];
        this.clearPending();
        this.ui.clearLog();
        this.ui.loadMessages(this.displayHistory());
        this.ui.setActiveChat(next.id);
      } else {
        this.newChat();
      }
    }
  }
  archiveChat(id) {
    const session = this.chatStore.get(id);
    const willArchive = !session?.archived;
    this.chatStore.archive(id, willArchive);
    if (willArchive && id === this.activeChatId) {
      const next = this.chatStore.getActive();
      if (next && next.id !== id) {
        this.switchChat(next.id);
      } else {
        this.newChat();
      }
    }
  }
  switchChat(id) {
    const session = this.chatStore.get(id);
    if (!session) return;
    this.persistCurrentChat();
    this.activeChatId = id;
    this.chatStore.setActive(id);
    this.history = [...session.messages];
    this.clearPending();
    this.ui.clearLog();
    this.ui.loadMessages(this.displayHistory());
    this.ui.setActiveChat(id);
    this.track("chat_switch", { id });
  }
  persistCurrentChat() {
    if (!this.activeChatId || this.cfg.disableChatHistory) return;
    const model = getAssistantSettings(this.assistantSettingsKey).model;
    this.chatStore.saveMessages(this.activeChatId, this.history, { model });
  }
  /** History mapped for display: collapse the raw attachment dump back to a "📎 name" line. */
  displayHistory() {
    return this.history.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system").map((m) => m.role === "user" ? { ...m, content: stripAttachmentDump(m.content) } : m);
  }
  exportCurrentChat() {
    if (!this.activeChatId) return;
    const json = this.chatStore.share(this.activeChatId);
    if (!json) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "chat-export.json";
    a.click();
    URL.revokeObjectURL(url);
    this.track("chat_export", { id: this.activeChatId });
  }
  analyticsUrl() {
    const s = getAssistantSettings(this.assistantSettingsKey);
    return s.analyticsEnabled ? this.cfg.serverUrl : void 0;
  }
  track(type, meta) {
    trackEvent(type, meta, this.analyticsUrl(), this.cfg.authToken);
  }
  async handleToggle(open) {
    if (!open) {
      this.voice?.stop();
      this.persistCurrentChat();
      return;
    }
    if (this.scanned) return;
    this.scanned = true;
    this.track("widget_open", {});
    this.showGreeting();
    if (this.cfg.knowledgeUrl) {
      try {
        const url = new URL(this.cfg.knowledgeUrl, location.href);
        if (url.origin !== location.origin) {
          this.ui.addMessage("system", "Skipped knowledge fetch: cross-origin URLs are not allowed.");
        } else {
          const res = await fetch(url.href);
          if (res.ok) this.assistant.setKnowledge((await res.text()).slice(0, 6e3));
        }
      } catch {
      }
    }
    if (this.cfg.autoScan !== false) {
      this.ui.setState("scanning");
      this.ui.addMessage("system", "Reading this app\u2026");
      try {
        this.map = await fullScan();
      } catch {
        this.map = { scannedAt: (/* @__PURE__ */ new Date()).toISOString(), pages: [], controls: scanPage() };
      }
      this.ui.setState("idle");
      this.ui.addMessage("system", `Ready \u2014 mapped ${this.map?.pages.length ?? 0} pages, ${this.map?.controls.length ?? 0} controls.`);
    }
  }
  pageContext() {
    return {
      url: location.href,
      path: location.pathname,
      title: document.title,
      state: this.cfg.getPageState?.(),
      map: this.map
    };
  }
  async handleUser(text, attachments) {
    if (this.pending) {
      this.clearPending();
      this.ui.addMessage("system", "Previous pending action cancelled.");
    }
    const message = formatAttachmentsForPrompt(text, attachments ?? []);
    if (!message.trim()) return;
    this.lastTurn = { text, attachments };
    this.ui.addMessage("user", text + (attachments?.length ? `
\u{1F4CE} ${attachments.map((a) => a.name).join(", ")}` : ""));
    this.ui.setState("thinking");
    this.ui.setBusy(true);
    try {
      const res = await this.assistant.chat({ message, page: this.pageContext(), history: this.history });
      this.history.push({ role: "user", content: message }, { role: "assistant", content: res.message });
      this.persistCurrentChat();
      if (res.pendingConfirmation) {
        this.pending = { name: res.pendingConfirmation.name, args: res.pendingConfirmation.args };
        const previewText = res.message || readableArgs(res.pendingConfirmation.args) || res.pendingConfirmation.preview || res.pendingConfirmation.name;
        this.showActionPreview(res.pendingConfirmation.name, res.pendingConfirmation.args);
        this.ui.addConfirm(previewText);
        this.ui.setState("idle");
        this.ui.setBusy(false);
        return;
      }
      this.ui.setBusy(false);
      this.ui.addMessage("assistant", res.message);
      await this.say(res.message);
      this.track("message_sent", { len: message.length });
    } catch (e) {
      this.ui.setBusy(false);
      this.ui.setState("idle");
      this.showFriendlyError(e, () => this.retryLastTurn());
    }
  }
  retryLastTurn() {
    if (!this.lastTurn) return;
    const { text, attachments } = this.lastTurn;
    this.handleUser(text, attachments);
  }
  /** Map any error to a plain-English message + retry affordance. */
  showFriendlyError(e, onRetry) {
    let msg = "Something went wrong, please try again.";
    if (e instanceof ProxyError) {
      switch (true) {
        case e.status === 0:
          msg = "Can't reach the assistant \u2014 check your connection and try again.";
          break;
        case (e.status === 401 || e.status === 403):
          msg = "The assistant isn't configured correctly.";
          break;
        case e.status === 429:
          msg = "The assistant is busy \u2014 try again in a moment.";
          break;
        case e.status >= 500:
          msg = "The assistant had a problem \u2014 try again.";
          break;
      }
    } else if (e instanceof TypeError) {
      msg = "Can't reach the assistant \u2014 check your connection and try again.";
    }
    this.ui.addError(msg, onRetry);
  }
  /** Highlight the on-page control a confirm-gated action will operate. Defensive. */
  showActionPreview(name, args) {
    this.ui.clearHighlight();
    const selector = this.resolveActionSelector(name, args);
    if (selector) this.ui.highlightElement(selector);
  }
  /** Resolve a scanner selector for the control an action targets (undefined if none). */
  resolveActionSelector(name, args) {
    if (typeof args.selector === "string") return args.selector;
    const label = typeof args.label === "string" ? args.label.trim().toLowerCase() : void 0;
    if (label && this.map) {
      const hit = this.map.controls.find((c) => c.label.trim().toLowerCase() === label);
      if (hit) return hit.selector;
    }
    return void 0;
  }
  async handleConfirm(approved) {
    this.ui.clearHighlight();
    if (!approved || !this.pending) {
      this.pending = void 0;
      this.ui.addMessage("system", "Cancelled.");
      return;
    }
    const pending = this.pending;
    this.ui.setState("thinking");
    this.ui.setBusy(true);
    try {
      const res = await this.assistant.confirmAndRun(pending.name, pending.args, this.pageContext());
      this.history.push({ role: "assistant", content: res.message });
      this.persistCurrentChat();
      this.ui.setBusy(false);
      this.ui.addMessage("assistant", res.message);
      await this.say(res.message);
    } catch (e) {
      this.ui.setBusy(false);
      this.ui.setState("idle");
      this.showFriendlyError(e, () => {
        this.pending = pending;
        this.handleConfirm(true);
      });
    } finally {
      this.pending = void 0;
    }
  }
  async say(text) {
    if (!this.voice || !this.ttsEnabled) {
      this.ui.setState("idle");
      return;
    }
    this.ui.setState("talking");
    try {
      await this.voice.speak(text);
    } catch {
    }
    this.ui.setState("idle");
  }
  async toggleMic() {
    if (!this.voice) {
      this.ui.addMessage("system", "Voice is off for this app.");
      return;
    }
    if (this.listening) {
      this.voice.cancelListen();
      return;
    }
    this.listening = true;
    this.ui.setMic(true);
    this.ui.setState("listening");
    let text = "";
    try {
      text = await this.voice.listenOnce({
        onCaptureStart: () => this.ui.setMicCountdown(4),
        onCountdown: (msRemaining) => this.ui.setMicCountdown(msRemaining / 1e3),
        onServerFallback: () => {
          if (this.notedSttFallback) return;
          this.notedSttFallback = true;
          this.ui.addMessage("system", "Server voice isn't available here \u2014 using your browser's microphone instead.");
        }
      });
    } catch (e) {
      if (e instanceof VoiceError) {
        const map = {
          "no-speech": "I didn't catch that \u2014 tap the mic and try again.",
          "not-allowed": "Microphone permission denied. Allow mic access in your browser to use voice.",
          "no-mic": "No microphone was found.",
          other: "I couldn't access the microphone."
        };
        this.ui.addMessage("system", map[e.reason] ?? map.other);
      } else {
        this.ui.addMessage("system", "I couldn't access the microphone.");
      }
    } finally {
      this.listening = false;
      this.ui.setMic(false);
      this.ui.setMicCountdown(null);
      this.ui.setState("idle");
    }
    if (text.trim()) this.handleUser(text.trim());
  }
};
var instance;
var PageAssistant = {
  init(cfg) {
    if (instance) return instance;
    instance = new PageAssistantController(cfg);
    return instance;
  },
  configure(patch) {
    instance?.updateConfig(patch);
  },
  /** Tear down the widget entirely (listeners, timers, shadow host, injected nodes). */
  destroy() {
    instance?.destroy();
    instance = void 0;
  },
  openVoiceSettings: openVoiceSettingsModal,
  closeVoiceSettings: closeVoiceSettingsModal,
  mountVoiceSettingsPanel,
  openAssistantSettings: openAssistantSettingsModal,
  closeAssistantSettings: closeAssistantSettingsModal,
  mountAssistantSettingsPanel
};
async function injectDiscoveryHint(serverUrl, knowledgeUrl, isAlive = () => true) {
  if (typeof document === "undefined" || document.querySelector('link[rel="llm"]')) return;
  const base = (serverUrl || "").replace(/\/$/, "");
  const href = knowledgeUrl || `${base}/llm.txt`;
  try {
    const res = await fetch(href, { method: "HEAD" });
    if (!res.ok) return;
  } catch {
    return;
  }
  if (!isAlive()) return;
  const link = document.createElement("link");
  link.rel = "llm";
  link.href = href;
  link.dataset.paDiscovery = "1";
  document.head.appendChild(link);
  const meta = document.createElement("meta");
  meta.name = "llm-actions";
  meta.content = `${base}/.well-known/llm-actions.json`;
  meta.dataset.paDiscovery = "1";
  document.head.appendChild(meta);
}
function removeDiscoveryHint() {
  if (typeof document === "undefined") return;
  document.querySelectorAll('[data-pa-discovery="1"]').forEach((n) => n.remove());
}
function readableArgs(args) {
  const preferred = ["label", "name", "title", "text", "query", "value"];
  for (const k of preferred) {
    const v = args[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const first = Object.values(args).find((v) => typeof v === "string" && v.trim());
  return typeof first === "string" ? first.trim() : "";
}
function stripAttachmentDump(content) {
  const fileIdx = content.indexOf("\n\n--- File: ");
  const imgIdx = content.indexOf("\n\n[Attached image");
  const idx = [fileIdx, imgIdx].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (idx === void 0) return content;
  const head = content.slice(0, idx);
  const names = [];
  const re = /--- File: (.+?) ---|\[Attached image "(.+?)"/g;
  let m;
  while (m = re.exec(content)) names.push(m[1] ?? m[2]);
  return head + (names.length ? `
\u{1F4CE} ${names.join(", ")}` : "");
}
if (typeof window !== "undefined") window.PageAssistant = PageAssistant;
export {
  ASSISTANT_SETTINGS_STORAGE_KEY,
  CHAT_HISTORY_STORAGE_KEY,
  ChatHistoryStore,
  DEFAULT_MODELS,
  ELEVENLABS_VOICES,
  LocalMemoryStore,
  OPENAI_VOICES,
  PageAssistant,
  VOICE_SETTINGS_CHANGE_EVENT,
  VOICE_SETTINGS_STORAGE_KEY,
  capability,
  closeAssistantSettingsModal,
  closeVoiceSettingsModal,
  exportAnalyticsMarkdown,
  formatAttachmentsForPrompt,
  fullScan,
  getAssistantSettings,
  getLocalAnalytics,
  getVoiceSettings,
  mountAssistantSettingsPanel,
  mountVoiceSettingsPanel,
  openAssistantSettingsModal,
  openVoiceSettingsModal,
  pageActionCapabilities,
  readFileAttachment,
  scanPage,
  setAssistantSettings,
  setVoiceSettings,
  trackEvent,
  voiceOptionsFromSettings
};
//# sourceMappingURL=page-assistant.esm.js.map

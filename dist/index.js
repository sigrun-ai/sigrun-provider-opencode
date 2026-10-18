/**
 * sigrun-opencode — a sigrun provider plugin (provider plugins Task 8):
 * OpenCode's PAID Go tier (`https://opencode.ai/zen/go/v1`) as one
 * dynamic OpenAI-compatible provider. The `/zen/v1` free tier is
 * client-gated by design (FreeTierError for non-CLI requests) and is out
 * of scope.
 *
 * Structurally identical to sigrun-ollama (the Task 7 reference plugin):
 * the default export is the sigrun extension-package factory returning a
 * PROVIDER-ONLY contributor — `{ name, providers, health }` with no
 * `extension` field — consumed structurally by sigrun's loader. The only
 * intended deltas from the reference are the provider id, the base URL,
 * and the ambient env key. Credentials resolve through sigrun's auth.json
 * bridge (the stored credential arrives as `credential` on the auth
 * resolver, ambient env as `ctx.env`) with `OPENCODE_GO_API_KEY` as the
 * fallback; the plugin never reads auth.json or `process.env` itself.
 *
 * Runtime imports from pi-ai are deliberate (`createProvider` + the
 * OpenAI-completions api); the package still declares pi-ai/pi-durable as
 * devDependencies only, because sigrun (the host) ships them and
 * `syncPackages` installs with `--omit=dev` — the provider-plugins spec's
 * dependency posture.
 */
import { createProvider } from "@earendil-works/pi-ai/models";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
/** The provider id models are registered (and stamped) under. */
export const OPENCODE_PROVIDER_ID = "opencode";
/** OpenCode's paid Go tier (OpenAI-compatible endpoint). */
export const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";
/** Ambient fallback when auth.json holds no credential. */
export const OPENCODE_API_KEY_ENV = "OPENCODE_GO_API_KEY";
/**
 * Conservative placeholders for catalog entries the Go tier's `/models`
 * shape gives no metadata for (no window, no limits, no rates — entries
 * carry only id/object/created/owned_by). Same values as the reference
 * plugin and sigrun's degenerate env provider, keeping context
 * management deterministic against unknown windows.
 */
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
/**
 * Parse an OpenAI-compatible `[OI]` `/models` body into pi-ai chat
 * models. Every entry is stamped `provider: "opencode"` — pi-ai's
 * restore path drops stored models whose `provider` field differs from
 * the registered id, so an unstamped catalog silently vanishes on cold
 * boot. Malformed bodies throw (a refresh failure retains the previous
 * catalog; garbage must never publish). Extra entry fields (the live
 * endpoint serves id/object/created/owned_by) are ignored.
 */
export function parseOpencodeCatalog(body, baseUrl) {
    if (typeof body !== "object" || body === null) {
        throw new Error("opencode /models body is not a JSON object");
    }
    const data = body.data;
    if (!Array.isArray(data)) {
        throw new Error("opencode /models body has no data array");
    }
    return data.map((entry) => {
        const id = entry?.id;
        if (typeof id !== "string" || id.length === 0) {
            throw new Error("opencode /models entry without a string id");
        }
        const model = {
            id,
            name: id,
            api: "openai-completions",
            // THE stamp — see the doc comment above.
            provider: OPENCODE_PROVIDER_ID,
            baseUrl,
            // The Go tier's /models carries no modality metadata; text is
            // the safe floor (claiming image without evidence would ship
            // image parts to models that cannot read them).
            input: ["text"],
            // Unknown rates: zeroed, usage tracking stays structural.
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            reasoning: false,
            contextWindow: DEFAULT_CONTEXT_WINDOW,
            maxTokens: DEFAULT_MAX_TOKENS,
        };
        return model;
    });
}
/**
 * Build the OpenCode Go provider plus its readiness/health trackers.
 * `baseUrl` is overridable so hermetic tests drive a fixture server; the
 * default is the real Go-tier endpoint.
 */
export function createOpencodePlugin(baseUrl = OPENCODE_BASE_URL) {
    // Tracker state: seeded from credential resolution (pi-ai never
    // refreshes an unconfigured provider, so refresh outcomes alone cannot
    // express not_configured), updated per refresh outcome. Readiness and
    // health are synchronous derivations over this state.
    let credentialResolved = false;
    let lastRefreshFailed = false;
    let lastRefreshDetail;
    let lastAnnounced;
    function status() {
        if (!credentialResolved)
            return "not_configured";
        return lastRefreshFailed ? "degraded" : "ready";
    }
    /** Apply a state change; `console.warn` on transitions only. */
    function announce() {
        const next = status();
        if (next === lastAnnounced)
            return;
        console.warn(`sigrun-opencode: opencode ${lastAnnounced ?? "startup"} → ${next}` +
            (lastRefreshDetail !== undefined && next === "degraded"
                ? ` (${lastRefreshDetail})`
                : ""));
        lastAnnounced = next;
    }
    function noteCredential(resolved) {
        credentialResolved = resolved;
        announce();
    }
    function noteRefresh(ok, detail) {
        lastRefreshFailed = !ok;
        lastRefreshDetail = ok ? undefined : detail;
        announce();
    }
    const provider = createProvider({
        id: OPENCODE_PROVIDER_ID,
        name: "OpenCode Go",
        baseUrl,
        // REQUIRED baseline: createProvider iterates it (omitting throws
        // "baselineModels is not iterable"); empty = purely dynamic.
        models: [],
        auth: {
            apiKey: {
                name: "OpenCode Go API key (auth.json or OPENCODE_GO_API_KEY)",
                resolve: async ({ credential, ctx }) => {
                    // Bridged auth.json credential (sigrun's bridge: the
                    // "default" entry first, then the provider's own) wins;
                    // the env var is the ambient fallback.
                    const stored = credential?.key?.trim() || undefined;
                    if (stored !== undefined) {
                        noteCredential(true);
                        return { auth: { apiKey: stored }, source: "auth.json" };
                    }
                    const envKey = (await ctx.env(OPENCODE_API_KEY_ENV))?.trim() || undefined;
                    if (envKey !== undefined) {
                        noteCredential(true);
                        return { auth: { apiKey: envKey }, source: OPENCODE_API_KEY_ENV };
                    }
                    // Unconfigured: undefined makes pi-ai skip the refresh
                    // phase entirely and requests fail loud.
                    noteCredential(false);
                    return undefined;
                },
            },
        },
        fetchModels: async (context) => {
            // The context credential is whatever auth resolution produced —
            // for this plugin always the merged api key; narrow rather than
            // trust the union.
            const key = context.credential?.type === "api_key"
                ? context.credential.key?.trim() || undefined
                : undefined;
            if (key === undefined) {
                noteCredential(false);
                // NEVER return [] — the createProvider wrapper publishes +
                // persists whatever fetchModels returns; an empty array
                // would wipe the catalog.
                throw new Error(`sigrun-opencode: OpenCode Go is not configured ` +
                    `(no auth.json credential and no ${OPENCODE_API_KEY_ENV}); ` +
                    "refusing to publish an empty catalog");
            }
            const effectiveBase = context.baseUrl ?? baseUrl;
            // URL-join needs the trailing slash ("models" against a
            // slash-less base would resolve to the host root).
            const root = effectiveBase.endsWith("/") ? effectiveBase : `${effectiveBase}/`;
            try {
                const response = await fetch(new URL("models", root), {
                    headers: { Authorization: `Bearer ${key}` },
                    signal: context.signal,
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const models = parseOpencodeCatalog(await response.json(), effectiveBase);
                noteRefresh(true);
                return models;
            }
            catch (cause) {
                // An aborted refresh is not a failed one: pi-ai discards
                // the outcome anyway, so the tracker must not move.
                if (context.signal.aborted)
                    throw cause;
                const message = cause instanceof Error ? cause.message : String(cause);
                noteRefresh(false, message);
                throw new Error(`sigrun-opencode: OpenCode Go catalog refresh failed: ${message}`);
            }
        },
        api: openAICompletionsApi(),
    });
    return {
        provider,
        readiness: () => ({
            status: status(),
            ...(lastRefreshDetail !== undefined && status() === "degraded"
                ? { detail: lastRefreshDetail }
                : {}),
        }),
        // not_configured → ok (an unconfigured optional plugin is not a
        // degraded process); configured-and-failing → degraded; else ok.
        health: () => (status() === "degraded" ? "degraded" : "ok"),
    };
}
/**
 * The sigrun extension-package factory (provider-only contributor).
 * Arity 1 declares the host-taking signature — sigrun's loader passes the
 * seam host only to factories that declare one (`factory.length > 0`).
 * sigrun-opencode reads no scoped settings (fixed endpoint, ambient-keyed
 * auth), so the host is accepted for the reference shape and left unused.
 */
export default function sigrunOpencode(host) {
    const plugin = createOpencodePlugin();
    return {
        name: "sigrun-opencode",
        providers: [{ provider: plugin.provider, readiness: plugin.readiness }],
        health: plugin.health,
    };
}

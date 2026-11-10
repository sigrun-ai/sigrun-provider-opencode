/**
 * @sigrun/provider-opencode's declared settings (settings rework, Task 10): the
 * whole scoped surface — one key, `baseUrl` — as one JSON Schema, declared
 * through `host.settings.declare`. Core draws the settings page's form from
 * it, applies the defaults and repairs a malformed stored value back to its
 * default.
 *
 * THE POSTURE CHANGE. The deleted `resolveOpencodeBaseUrl` THREW on a
 * malformed `baseUrl`, quarantining the whole plugin on a typo. Core's
 * checked read now repairs the value to its default (a logged repair plus one
 * boot-time warning), so the plugin boots on {@link OPENCODE_BASE_URL} instead. The
 * form refuses a malformed value at save (`format: "uri"`), so only a
 * hand-edited file can reach the repair path.
 *
 * The key is `restart` (`x-sigrun-apply`): the factory reads it ONCE and bakes
 * it into the base URL every published model is stamped with, so an edited
 * value lands at the next boot — the contract this package already documents.
 */
import { Type, type Static } from "typebox";
/**
 * OpenCode's paid Go tier ([OI]-compatible endpoint): the `baseUrl` default,
 * and what a repaired value falls back to.
 */
export declare const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";
export declare const OPENCODE_SETTINGS_SCHEMA: Type.TObject<{
    baseUrl: Type.TOptional<Type.TString>;
}> & Readonly<Record<string, unknown>>;
export type OpencodeProviderSettings = Static<typeof OPENCODE_SETTINGS_SCHEMA>;

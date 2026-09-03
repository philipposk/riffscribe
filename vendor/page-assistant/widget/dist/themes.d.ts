import type { ThemeMode } from "./assistant-settings.js";
export declare const THEME_VARS: Record<Exclude<ThemeMode, "system">, Record<string, string>>;
export declare function resolveTheme(mode: ThemeMode): Exclude<ThemeMode, "system">;
export declare function themeCssVars(mode: ThemeMode): string;

import type { Capability, PageMap } from "@page-assistant/core";
/**
 * Built-in "blind mode" capabilities: real actions on any page using the scan map,
 * so the assistant can DO things even on apps that registered no custom capabilities.
 * Conservative by design — it only touches controls the scanner actually found.
 */
export declare function pageActionCapabilities(getMap: () => PageMap | undefined, rescan: () => Promise<PageMap>): Capability[];

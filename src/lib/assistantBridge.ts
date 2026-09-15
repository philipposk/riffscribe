/**
 * How the studio lends its controls to the assistant.
 *
 * The assistant is mounted above the pages (see AssistantHost) so that following
 * a link in one of its replies changes page without closing the conversation.
 * The studio's controls only exist while the studio is on screen, so the studio
 * hands them over when it mounts and takes them back when it goes. In between,
 * the studio's capabilities are switched off and the model is not told about them.
 */
import type { AssistantActions } from "@/components/Assistant";

let lent: (() => AssistantActions) | null = null;

/** Called by the studio on mount. The returned function takes the controls back. */
export function lendStudio(get: () => AssistantActions): () => void {
  lent = get;
  return () => {
    if (lent === get) lent = null;
  };
}

/** The studio's current controls, or null when the studio is not on screen. */
export function studioActions(): AssistantActions | null {
  return lent ? lent() : null;
}

/** Client-side file ingestion for chat attachments (text + optional images). */
export interface FileAttachment {
    name: string;
    mime: string;
    /** Text content or base64 data URL for images. */
    content: string;
    kind: "text" | "image";
}
/**
 * Read a file for attachment.
 *
 * Images are OFF by default: the assistant backend/core has no vision plumbing, so
 * accepting an image and only telling the model "[Attached image: x]" would be a
 * placebo (the model never sees the picture). We refuse honestly unless the host
 * explicitly opts in via `imagesEnabled` (i.e. it wired up a vision-capable backend).
 */
export declare function readFileAttachment(file: File, opts?: {
    imagesEnabled?: boolean;
}): Promise<FileAttachment | {
    error: string;
}>;
/** Format attachments for inclusion in the user message sent to the assistant. */
export declare function formatAttachmentsForPrompt(text: string, attachments: FileAttachment[]): string;

import {ChatAttachment, ChatQuote, ChatSource, Message} from "@/types/chat";

/** Shared chat aliases plus defensive normalization for server attachment rows. */
export type DialogChatQuote = ChatQuote;
export type DialogChatAttachment = ChatAttachment;
export type DialogChatSource = ChatSource;

export type DialogMessage = Message & {
    quotes?: DialogChatQuote[];
    attachments?: DialogChatAttachment[];
    attachmentIds?: string[];
    sources?: DialogChatSource[];
    searchProgress?: unknown;
    search_progress?: unknown;
};

export function asDialogMessage(message: Message): DialogMessage {
    return message as DialogMessage;
}

export function normalizeDialogAttachment(value: unknown): DialogChatAttachment | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.id !== "string" || typeof candidate.filename !== "string") return null;
    return {
        id: candidate.id,
        filename: candidate.filename,
        size_bytes: typeof candidate.size_bytes === "number" ? candidate.size_bytes : 0,
        status: candidate.status === "failed" ? "failed" : "ready",
        ...(typeof candidate.error === "string" ? {error: candidate.error} : {}),
        ...(typeof candidate.created_at === "string" ? {created_at: candidate.created_at} : {created_at: ""}),
        ...(typeof candidate.text_length === "number" ? {text_length: candidate.text_length} : {text_length: 0}),
        ...(typeof candidate.knowledge_path === "string" ? {knowledge_path: candidate.knowledge_path} : {}),
    };
}

export function normalizeDialogAttachments(value: unknown): DialogChatAttachment[] {
    const raw = Array.isArray(value)
        ? value
        : value && typeof value === "object" && Array.isArray((value as {attachments?: unknown}).attachments)
            ? (value as {attachments: unknown[]}).attachments
            : [];
    return raw.flatMap((item) => {
        const attachment = normalizeDialogAttachment(item);
        return attachment ? [attachment] : [];
    });
}

export function formatAttachmentSize(sizeBytes: number): string {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "大小未知";
    if (sizeBytes < 1024) return `${sizeBytes} B`;
    if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isDialogAttachmentReady(attachment: DialogChatAttachment): boolean {
    return attachment.status === "ready";
}

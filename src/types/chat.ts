import {GptVersion} from "@/app/constants";

export interface Dialog {
    // 头像
    avatar: string;
    // 小标题
    subTitle: string;
    // 对话最后时间
    timestamp: number;
    // 聊天头
    title: string;
    // 消息数
    count: number;
}

export interface Message {
    avatar: string;
    content: string;
    message_type: MessageType;
    time: number;
    direction?: MessageDirection;
    role: MessageRole;
    id: string;
    runId?: string;
    streaming?: boolean;
    status?: MessageStatus;
    error?: string;
    quotes?: ChatQuote[];
    attachmentIds?: string[];
    attachments?: ChatAttachment[];
    sources?: ChatSource[];
}

export interface ChatQuote { message_id: string; text: string; }
export interface ChatSource { id: number; url: string; title: string; snippet?: string; }
export interface ChatAttachment {
    id: string;
    filename: string;
    size_bytes: number;
    status: "ready" | "failed";
    error?: string | null;
    created_at: string;
    text_length: number;
    knowledge_path?: string | null;
}

export interface SessionConfig {
    gptVersion: string;
    mode?: "chat" | "research";
    budgetLimit?: number;
    thinking?: boolean;
    webSearch?: boolean;
}

export enum MessageRole {
    system = "system",
    user = "user",
    assistant = "assistant",
}

export enum MessageStatus {
    Sending = "sending",
    Error = "error",
    Cancelled = "cancelled",
}

export enum MessageType {
    Link = "link",
    Pic = "pic",
    Text = "text",
}

export enum MessageDirection {
    Send = 0,
    Receive,
}

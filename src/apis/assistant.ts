import {useAccessStore} from "@/app/store/access";

const assistantApiHost = process.env.NEXT_PUBLIC_API_HOST_URL || "http://127.0.0.1:8091";

export type AssistantTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | string;
export type AssistantConnectionStatus = "connected" | "ready" | "syncing" | "pending" | "error" | "disconnected" | "disabled" | string;

export interface AssistantDraftAttachment {
    path: string;
    content_hash: string;
    name?: string;
    content_type?: string;
}

export interface AssistantDraft {
    version: number;
    hash: string;
    to: string[];
    cc: string[];
    subject: string;
    body: string;
    attachments: AssistantDraftAttachment[];
}

export interface AssistantSource {
    path: string;
    content_hash?: string;
    line_start?: number;
    line_end?: number;
    text?: string;
    kind?: "knowledge" | "web";
    url?: string;
    title?: string;
    published_at?: string | null;
}

/** Incoming attachment metadata. Content is intentionally never exposed in the UI. */
export interface AssistantAttachment {
    name?: string;
    content_type?: string;
    size?: number;
}

export interface AssistantEvent {
    type?: string;
    status?: string;
    progress?: number;
    message?: string;
    created_at?: string;
    [key: string]: unknown;
}

export interface AssistantConnection {
    id: string;
    provider: string;
    email: string;
    status: AssistantConnectionStatus;
    last_sync_at?: string | null;
    error?: string | null;
}

export interface AssistantMail {
    body?: string;
    attachments?: AssistantAttachment[];
    content_status?: string;
    content_warning?: string;
    [key: string]: unknown;
}

export interface AssistantMailQuerySource {
    id: string;
    mail_id: string;
    connection_id?: string;
    subject?: string;
    from_address?: string;
    to?: string | string[];
    date?: string | null;
    is_sent?: boolean;
    body?: string;
    task_status?: string | null;
    content_status?: string;
    content_warning?: string;
}

export interface AssistantMailQueryResult {
    label: string;
    range_start: string | null;
    range_end: string | null;
    timezone: string;
    matched_count: number;
    source_count: number;
    partial: boolean;
    warnings: string[];
    sources: AssistantMailQuerySource[];
    sync?: AssistantMailQuerySync[];
}

export interface AssistantMailQuerySync {
    connection_id: string;
    email?: string;
    last_sync_at?: string | null;
    completed_at?: string | null;
    status?: string | null;
    has_more?: boolean;
    sent_available?: boolean;
}

export interface AssistantTask {
    detail_loaded?: boolean;
    id: string;
    kind?: string;
    query?: string;
    subject?: string;
    from_address?: string;
    status: AssistantTaskStatus;
    summary?: string;
    questions: string[];
    draft: AssistantDraft | null;
    sources: AssistantSource[];
    mail?: AssistantMail | null;
    events: AssistantEvent[];
    run_id?: string | null;
    session_id?: string | null;
    error?: string | null;
    created_at?: string;
    updated_at?: string;
    send_status?: string | null;
    model?: string | null;
    sync_status?: string | null;
    report?: string | null;
    report_markdown?: string | null;
    report_meta?: AssistantMailQueryResult | null;
    mail_query?: AssistantMailQueryResult | null;
    sync_warnings?: string[];
}

export interface AssistantSettings {
    enabled: boolean;
    monthly_budget: number;
    model: string;
    used: number;
    held: number;
}

export interface AssistantCapabilities {
    mail_configured: boolean;
    notifications_configured: boolean;
}

export interface AssistantOverview {
    connections: AssistantConnection[];
    tasks: AssistantTask[];
    settings: AssistantSettings;
    capabilities: AssistantCapabilities;
}

export type AssistantKnowledgeIndexStatus = "queued" | "indexing" | "ready" | "failed";

export interface AssistantKnowledgeDocument {
    path: string;
    content_hash: string;
    updated_at: string | null;
    index_status: AssistantKnowledgeIndexStatus;
    index_error: string | null;
    chunk_count: number;
}

export interface AssistantKnowledgeFile {
    path: string;
    content: string;
    content_hash: string;
}

export interface AssistantKnowledgeSearchSource extends AssistantSource {
    path: string;
    content_hash: string;
    line_start: number;
    line_end: number;
    text: string;
}

export interface AssistantKnowledgeCapabilities {
    web_search_available: boolean;
}

export type AssistantKnowledgeQuestionStatus = "queued" | "running" | "succeeded" | "insufficient" | "failed" | "cancelled";

export interface AssistantKnowledgeQuestionSource extends AssistantSource {
    path: string;
    content_hash: string;
    line_start: number;
    line_end: number;
    text: string;
    kind: "knowledge" | "web";
    url?: string;
    title?: string;
    published_at?: string | null;
}

export interface AssistantKnowledgeQuestion {
    id: string;
    question: string;
    status: AssistantKnowledgeQuestionStatus;
    answer: string;
    sources: AssistantKnowledgeQuestionSource[];
    web_search: boolean;
    error: string | null;
    run_id: string | null;
    created_at: string | null;
}

export interface AssistantKnowledgeQuestionsPage {
    questions: AssistantKnowledgeQuestion[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
}

export interface AssistantRule {
    path: string;
    content: string;
    content_hash: string;
}

export interface AssistantKnowledgeUpload {
    path: string;
    content?: string;
    content_base64?: string;
    expected_hash?: string;
}

export interface AssistantDraftPayload {
    version: number;
    to: string[];
    cc: string[];
    subject: string;
    body: string;
    attachments: AssistantDraftAttachment[];
}

export interface AssistantSendPayload {
    version: number;
    hash: string;
}

export interface AssistantSettingsPayload {
    enabled: boolean;
    monthly_budget: number;
    model: string;
}

export interface AssistantConnectionPayload {
    provider: string;
    email: string;
    authorization_code: string;
}

export class AssistantApiError extends Error {
    status: number;
    detail: string;

    constructor(status: number, detail: string) {
        super(detail);
        this.name = "AssistantApiError";
        this.status = status;
        this.detail = detail;
    }
}

function assistantUrl(path: string): string {
    return `${assistantApiHost}/api/v1/agent/assistant${path}`;
}

function requestHeaders(): HeadersInit {
    return {
        Authorization: useAccessStore.getState().token,
        "Content-Type": "application/json;charset=utf-8",
    };
}

async function readDetail(response: Response): Promise<string> {
    try {
        const payload = await response.json() as unknown;
        if (payload && typeof payload === "object" && "detail" in payload) {
            const detail = (payload as {detail?: unknown}).detail;
            if (typeof detail === "string" && detail) return detail;
        }
        if (typeof payload === "string" && payload) return payload;
    } catch {
        // Fall through to the status text when the server did not return JSON.
    }
    return response.statusText || `请求失败（HTTP ${response.status}）`;
}

async function assistantRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(assistantUrl(path), {
        ...init,
        headers: {...requestHeaders(), ...(init.headers || {})},
        cache: "no-store",
    });
    if (!response.ok) throw new AssistantApiError(response.status, await readDetail(response));
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
}

function normalizeAssistantKnowledgeDocument(value: unknown): AssistantKnowledgeDocument {
    const candidate = value && typeof value === "object" && "document" in value
        ? (value as {document?: unknown}).document
        : value;
    if (!candidate || typeof candidate !== "object") throw new Error("知识文档响应格式无效");
    const document = candidate as Partial<AssistantKnowledgeDocument>;
    if (typeof document.path !== "string" || typeof document.content_hash !== "string") {
        throw new Error("知识文档响应格式无效");
    }
    return {
        path: document.path,
        content_hash: document.content_hash,
        updated_at: typeof document.updated_at === "string" ? document.updated_at : null,
        index_status: document.index_status || "queued",
        index_error: typeof document.index_error === "string" ? document.index_error : null,
        chunk_count: typeof document.chunk_count === "number" ? document.chunk_count : 0,
    };
}

const ASSISTANT_KNOWLEDGE_QUESTION_STATUSES: AssistantKnowledgeQuestionStatus[] = [
    "queued",
    "running",
    "succeeded",
    "insufficient",
    "failed",
    "cancelled",
];

function normalizeAssistantKnowledgeQuestionSource(value: unknown): AssistantKnowledgeQuestionSource | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<AssistantKnowledgeQuestionSource>;
    const kind = source.kind === "web"
        || (!source.kind && typeof source.url === "string" && source.url.trim())
        ? "web"
        : "knowledge";
    const title = typeof source.title === "string" ? source.title : "";
    const url = typeof source.url === "string" ? source.url : "";
    const path = typeof source.path === "string" ? source.path : kind === "web" ? title || url : "";
    if (!path) return null;
    const lineStart = typeof source.line_start === "number" && Number.isFinite(source.line_start) ? source.line_start : 0;
    const lineEnd = typeof source.line_end === "number" && Number.isFinite(source.line_end) ? source.line_end : lineStart;
    const publishedAt = source.published_at === null
        ? null
        : typeof source.published_at === "string"
            ? source.published_at
            : source.published_at === undefined
                ? null
                : String(source.published_at);
    return {
        path,
        content_hash: typeof source.content_hash === "string" ? source.content_hash : "",
        line_start: lineStart,
        line_end: lineEnd,
        text: typeof source.text === "string" ? source.text : "",
        kind,
        ...(url ? {url} : {}),
        ...(kind === "web"
            ? {title: title || path, published_at: publishedAt}
            : {
                ...(title ? {title} : {}),
                ...(publishedAt !== null ? {published_at: publishedAt} : {}),
            }),
    };
}

function normalizeAssistantKnowledgeQuestion(value: unknown): AssistantKnowledgeQuestion {
    if (!value || typeof value !== "object") throw new Error("知识库问答响应格式无效");
    const question = value as Partial<AssistantKnowledgeQuestion>;
    if (typeof question.id !== "string" || typeof question.question !== "string" || !ASSISTANT_KNOWLEDGE_QUESTION_STATUSES.includes(question.status as AssistantKnowledgeQuestionStatus)) {
        throw new Error("知识库问答响应格式无效");
    }
    return {
        id: question.id,
        question: question.question,
        status: question.status as AssistantKnowledgeQuestionStatus,
        answer: typeof question.answer === "string" ? question.answer : "",
        sources: Array.isArray(question.sources)
            ? question.sources.flatMap(source => {
                const normalized = normalizeAssistantKnowledgeQuestionSource(source);
                return normalized ? [normalized] : [];
            })
            : [],
        web_search: question.web_search === true,
        error: typeof question.error === "string" ? question.error : null,
        run_id: typeof question.run_id === "string" ? question.run_id : null,
        created_at: typeof question.created_at === "string" ? question.created_at : null,
    };
}

export function getAssistantOverview(signal?: AbortSignal): Promise<AssistantOverview> {
    return assistantRequest<AssistantOverview>("", {method: "GET", signal});
}

export function getAssistantTask(taskId: string, signal?: AbortSignal): Promise<AssistantTask> {
    return assistantRequest<AssistantTask>(`/tasks/${encodeURIComponent(taskId)}`, {method: "GET", signal});
}

export function createAssistantTask(content: string, model?: string, signal?: AbortSignal): Promise<AssistantTask> {
    return assistantRequest<AssistantTask>("/tasks", {
        method: "POST",
        body: JSON.stringify({content, ...(model ? {model} : {})}),
        signal,
    });
}

export function answerAssistantTask(taskId: string, answer: string): Promise<AssistantTask> {
    return assistantRequest<AssistantTask>(`/tasks/${encodeURIComponent(taskId)}/answer`, {
        method: "POST",
        body: JSON.stringify({answer}),
    });
}

export function updateAssistantDraft(taskId: string, draft: AssistantDraftPayload): Promise<unknown> {
    return assistantRequest<unknown>(`/tasks/${encodeURIComponent(taskId)}/draft`, {
        method: "PUT",
        body: JSON.stringify(draft),
    });
}

export function sendAssistantTask(taskId: string, payload: AssistantSendPayload): Promise<AssistantTask> {
    return assistantRequest<AssistantTask>(`/tasks/${encodeURIComponent(taskId)}/send`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export function retryAssistantTask(taskId: string): Promise<AssistantTask> {
    return assistantRequest<AssistantTask>(`/tasks/${encodeURIComponent(taskId)}/retry`, {method: "POST"});
}

export function archiveAssistantAttachment(taskId: string, attachmentIndex: number): Promise<unknown> {
    return assistantRequest<unknown>(`/tasks/${encodeURIComponent(taskId)}/attachments/${attachmentIndex}`, {
        method: "POST",
    });
}

export function createAssistantConnection(payload: AssistantConnectionPayload): Promise<AssistantConnection> {
    return assistantRequest<AssistantConnection>("/connections", {method: "POST", body: JSON.stringify(payload)});
}

export function syncAssistantConnection(connectionId: string): Promise<AssistantConnection> {
    return assistantRequest<AssistantConnection>(`/connections/${encodeURIComponent(connectionId)}/sync`, {method: "POST"});
}

export function deleteAssistantConnection(connectionId: string): Promise<void> {
    return assistantRequest<void>(`/connections/${encodeURIComponent(connectionId)}`, {method: "DELETE"});
}

export function updateAssistantSettings(payload: AssistantSettingsPayload): Promise<AssistantSettings> {
    return assistantRequest<AssistantSettings>("/settings", {method: "PUT", body: JSON.stringify(payload)});
}

export async function getAssistantKnowledge(signal?: AbortSignal): Promise<{documents: AssistantKnowledgeDocument[]}> {
    const result = await assistantRequest<unknown>("/knowledge", {method: "GET", signal});
    if (!result || typeof result !== "object" || !Array.isArray((result as {documents?: unknown}).documents)) {
        throw new Error("知识库响应格式无效");
    }
    return {documents: (result as {documents: unknown[]}).documents.map(normalizeAssistantKnowledgeDocument)};
}

export async function getAssistantKnowledgeCapabilities(signal?: AbortSignal): Promise<AssistantKnowledgeCapabilities> {
    const result = await assistantRequest<unknown>("/knowledge/capabilities", {method: "GET", signal});
    if (!result || typeof result !== "object" || typeof (result as {web_search_available?: unknown}).web_search_available !== "boolean") {
        throw new Error("联网查询能力响应格式无效");
    }
    return {web_search_available: (result as {web_search_available: boolean}).web_search_available};
}

export async function uploadAssistantKnowledge(payload: AssistantKnowledgeUpload): Promise<AssistantKnowledgeDocument> {
    const result = await assistantRequest<unknown>("/knowledge", {method: "POST", body: JSON.stringify(payload)});
    return normalizeAssistantKnowledgeDocument(result);
}

export async function reindexAssistantKnowledge(path: string, expectedHash?: string): Promise<AssistantKnowledgeDocument> {
    const result = await assistantRequest<unknown>("/knowledge/reindex", {
        method: "POST",
        body: JSON.stringify({path, ...(expectedHash ? {expected_hash: expectedHash} : {})}),
    });
    return normalizeAssistantKnowledgeDocument(result);
}

export function getAssistantKnowledgeFile(path: string, contentHash?: string, signal?: AbortSignal): Promise<AssistantKnowledgeFile> {
    const query = new URLSearchParams({path});
    if (contentHash) query.set("hash", contentHash);
    return assistantRequest<AssistantKnowledgeFile>(`/knowledge/file?${query.toString()}`, {method: "GET", signal});
}

export function getAssistantMailSource(taskId: string, mailId: string, signal?: AbortSignal): Promise<AssistantMailQuerySource> {
    return assistantRequest<AssistantMailQuerySource>(
        `/tasks/${encodeURIComponent(taskId)}/mail-sources/${encodeURIComponent(mailId)}`,
        {method: "GET", signal},
    );
}

export function deleteAssistantKnowledgeFile(path: string, contentHash?: string): Promise<void> {
    const query = new URLSearchParams({path});
    if (contentHash) query.set("hash", contentHash);
    return assistantRequest<void>(`/knowledge/file?${query.toString()}`, {method: "DELETE"});
}

export function searchAssistantKnowledge(queryText: string, signal?: AbortSignal): Promise<{sources: AssistantKnowledgeSearchSource[]}> {
    const query = new URLSearchParams({q: queryText});
    return assistantRequest<{sources: AssistantKnowledgeSearchSource[]}>(`/knowledge/search?${query.toString()}`, {
        method: "GET",
        signal,
    });
}

export function getAssistantRules(signal?: AbortSignal): Promise<{rules: AssistantRule[]}> {
    return assistantRequest<{rules: AssistantRule[]}>("/rules", {method: "GET", signal});
}

export function createAssistantRule(text: string): Promise<AssistantRule> {
    return assistantRequest<AssistantRule>("/rules", {method: "POST", body: JSON.stringify({text})});
}

export async function createAssistantKnowledgeQuestion(
    question: string,
    requestId: string,
    signal?: AbortSignal,
    model?: string,
    webSearch = false,
): Promise<AssistantKnowledgeQuestion> {
    const result = await assistantRequest<unknown>("/knowledge/questions", {
        method: "POST",
        body: JSON.stringify({question, request_id: requestId, web_search: webSearch, ...(model ? {model} : {})}),
        signal,
    });
    return normalizeAssistantKnowledgeQuestion(result);
}

export async function getAssistantKnowledgeQuestions(signal?: AbortSignal, page = 1, pageSize = 5): Promise<AssistantKnowledgeQuestionsPage> {
    const query = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
    });
    const result = await assistantRequest<unknown>(`/knowledge/questions?${query.toString()}`, {method: "GET", signal});
    if (!result || typeof result !== "object" || !Array.isArray((result as {questions?: unknown}).questions)) {
        throw new Error("知识库问答列表响应格式无效");
    }

    const response = result as Partial<AssistantKnowledgeQuestionsPage> & {questions: unknown[]};
    const total = typeof response.total === "number" && Number.isFinite(response.total) ? Math.max(0, Math.floor(response.total)) : response.questions.length;
    const normalizedPageSize = typeof response.page_size === "number" && Number.isFinite(response.page_size) && response.page_size > 0
        ? Math.max(1, Math.floor(response.page_size))
        : Math.max(1, Math.floor(pageSize));
    const normalizedPage = typeof response.page === "number" && Number.isFinite(response.page) && response.page > 0
        ? Math.max(1, Math.floor(response.page))
        : Math.max(1, Math.floor(page));
    const totalPages = typeof response.total_pages === "number" && Number.isFinite(response.total_pages) && response.total_pages > 0
        ? Math.max(1, Math.floor(response.total_pages))
        : Math.max(1, Math.ceil(total / normalizedPageSize));
    return {
        questions: response.questions.map(normalizeAssistantKnowledgeQuestion),
        total,
        page: normalizedPage,
        page_size: normalizedPageSize,
        total_pages: totalPages,
    };
}

export async function getAssistantKnowledgeQuestion(questionId: string, signal?: AbortSignal): Promise<AssistantKnowledgeQuestion> {
    const result = await assistantRequest<unknown>(`/knowledge/questions/${encodeURIComponent(questionId)}`, {method: "GET", signal});
    return normalizeAssistantKnowledgeQuestion(result);
}

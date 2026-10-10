import {agentRequest} from "@/apis";

export const DEFAULT_RECENT_TURNS = 10;
export const MIN_RECENT_TURNS = 1;
export const MAX_RECENT_TURNS = 100;

export interface ContextSummary {
    snapshot_id: string;
    text: string;
    covered_through_seq: number;
    created_at?: string | null;
}

export interface ContextSource {
    message_id: string;
    seq: number;
    role: string;
    content: string;
}

export interface ContextUsage {
    estimated_tokens: number;
    context_window: number;
    trigger_tokens: number;
    retained_turns: number;
    compression_cost: number | string | null;
    capacity_source: string;
    status: string;
}

export interface SessionContextSnapshot {
    recent_turns: number;
    context_version: number;
    summary: ContextSummary | null;
    sources: ContextSource[];
    usage: ContextUsage | null;
}

function numberOr(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function textOr(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}

function contentText(value: unknown): string {
    if (typeof value === "string") return value;
    if (value == null) return "";
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? String(value) : serialized;
    } catch {
        return String(value);
    }
}

function normalizeSummary(value: unknown): ContextSummary | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<ContextSummary>;
    if (!candidate.snapshot_id || typeof candidate.snapshot_id !== "string") return null;
    return {
        snapshot_id: candidate.snapshot_id,
        text: contentText(candidate.text),
        covered_through_seq: numberOr(candidate.covered_through_seq, 0),
        created_at: typeof candidate.created_at === "string" ? candidate.created_at : null,
    };
}

function normalizeUsage(value: unknown): ContextUsage | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<ContextUsage>;
    return {
        estimated_tokens: numberOr(candidate.estimated_tokens, 0),
        context_window: numberOr(candidate.context_window, 0),
        trigger_tokens: numberOr(candidate.trigger_tokens, 0),
        retained_turns: numberOr(candidate.retained_turns, 0),
        compression_cost: typeof candidate.compression_cost === "number" || typeof candidate.compression_cost === "string"
            ? candidate.compression_cost
            : null,
        capacity_source: textOr(candidate.capacity_source, "unknown"),
        status: textOr(candidate.status, "unknown"),
    };
}

export function normalizeSessionContext(value: unknown): SessionContextSnapshot {
    const candidate = value && typeof value === "object" ? value as Partial<SessionContextSnapshot> : {};
    const recentTurns = numberOr(candidate.recent_turns, DEFAULT_RECENT_TURNS);
    const sources = Array.isArray(candidate.sources)
        ? candidate.sources.flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const source = item as Partial<ContextSource>;
            if (!source.message_id || typeof source.message_id !== "string") return [];
            return [{
                message_id: source.message_id,
                seq: numberOr(source.seq, 0),
                role: textOr(source.role, "user"),
                content: contentText(source.content),
            }];
        })
        : [];
    return {
        recent_turns: Math.max(MIN_RECENT_TURNS, Math.min(MAX_RECENT_TURNS, Math.round(recentTurns))),
        context_version: numberOr(candidate.context_version, 0),
        summary: normalizeSummary(candidate.summary),
        sources,
        usage: normalizeUsage(candidate.usage),
    };
}

async function contextRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await agentRequest(path, init);
    if (!response.ok) {
        let detail = "";
        try {
            detail = await response.text();
        } catch {
            // Keep the status useful even when the response body is unavailable.
        }
        let message = detail;
        if (detail) {
            try {
                const parsed = JSON.parse(detail) as {detail?: unknown; message?: unknown};
                if (typeof parsed.detail === "string") message = parsed.detail;
                else if (typeof parsed.message === "string") message = parsed.message;
            } catch {
                // The service may return plain text; keep it as-is.
            }
        }
        const error = new Error(message || `上下文请求失败（HTTP ${response.status}）`);
        (error as Error & {status?: number}).status = response.status;
        throw error;
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
}

function unwrapContext(value: unknown): SessionContextSnapshot {
    if (value && typeof value === "object" && "context" in value) {
        return normalizeSessionContext((value as {context?: unknown}).context);
    }
    return normalizeSessionContext(value);
}

export async function getContextPreferences(signal?: AbortSignal): Promise<{recent_turns: number}> {
    const result = await contextRequest<unknown>("/context-preferences", {method: "GET", signal});
    const candidate = result && typeof result === "object" ? result as {recent_turns?: unknown} : {};
    return {recent_turns: Math.max(MIN_RECENT_TURNS, Math.min(MAX_RECENT_TURNS, Math.round(numberOr(candidate.recent_turns, DEFAULT_RECENT_TURNS))))};
}

export async function updateContextPreferences(recentTurns: number, signal?: AbortSignal): Promise<{recent_turns: number}> {
    const result = await contextRequest<unknown>("/context-preferences", {
        method: "PATCH",
        signal,
        body: JSON.stringify({recent_turns: Math.max(MIN_RECENT_TURNS, Math.min(MAX_RECENT_TURNS, Math.round(recentTurns)))}),
    });
    const candidate = result && typeof result === "object" ? result as {recent_turns?: unknown} : {};
    return {recent_turns: Math.max(MIN_RECENT_TURNS, Math.min(MAX_RECENT_TURNS, Math.round(numberOr(candidate.recent_turns, recentTurns))))};
}

export async function getSessionContext(sessionId: string, signal?: AbortSignal): Promise<SessionContextSnapshot> {
    const result = await contextRequest<unknown>(`/sessions/${encodeURIComponent(sessionId)}/context`, {method: "GET", signal});
    return unwrapContext(result);
}

export async function updateSessionContext(sessionId: string, recentTurns: number, signal?: AbortSignal): Promise<SessionContextSnapshot> {
    const result = await contextRequest<unknown>(`/sessions/${encodeURIComponent(sessionId)}/context`, {
        method: "PATCH",
        signal,
        body: JSON.stringify({recent_turns: Math.max(MIN_RECENT_TURNS, Math.min(MAX_RECENT_TURNS, Math.round(recentTurns)))}),
    });
    return unwrapContext(result);
}

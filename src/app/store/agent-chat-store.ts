import {create} from "zustand";
import {nanoid} from "nanoid";
import {
    AgentMessageRecord,
    AgentMode,
    AgentRunRecord,
    AgentRunStatus,
    AgentSessionDetail,
    AgentSessionSummary,
    cancelAgentRun,
    createAgentRun,
    createAgentSession,
    deleteAgentMessage,
    deleteAgentSession,
    getAgentRunEvents,
    getAgentSession,
    listAgentSessions,
    renameAgentSession,
    resetAgentSessionContext,
} from "@/apis";
import {GptVersion, normalizeGptVersion} from "@/app/constants";
import {Message, MessageDirection, MessageRole, MessageStatus, MessageType, SessionConfig} from "@/types/chat";
import {useAccessStore} from "./access";
import {mergeRunSnapshot} from "./agent-recovery";
import {pollDurableRun, syncDurableSession} from "./agent-recovery-loop";
import {orderQueuedRuns, queueHead} from "./agent-run-queue";

export interface AgentChatSession {
    /** The server session ID is also used as the route ID. */
    id: string;
    kind?: "chat" | "knowledge";
    dialog: {
        avatar: string;
        subTitle: string;
        timestamp: number;
        title: string;
        count: number;
    };
    messages: Message[];
    config: SessionConfig;
    /** IDs returned by the server, used to prevent deleting optimistic messages. */
    serverMessageIds: Record<string, true>;
    /** Server sequence boundary; history remains visible but is excluded from new context. */
    contextResetAfterSeq: number | null;
    messageSeqs: Record<string, number>;
    /** All known runs, including queued runs returned by the session detail endpoint. */
    runs: AgentRunRecord[];
    activeRunId?: string | null;
    activeRun?: AgentRunRecord;
    latestRun?: AgentRunRecord;
    createdAt?: string;
    updatedAt?: string;
}

interface AgentChatStore {
    accountKey: string;
    sessions: AgentChatSession[];
    currentSessionIndex: number;
    loading: boolean;
    error?: string;
    loadSessions: () => Promise<void>;
    loadSession: (sessionId: string) => Promise<void>;
    openSession: (dialog?: {avatar?: string; title?: string}) => Promise<AgentChatSession>;
    selectSession: (index: number) => void;
    selectSessionById: (sessionId: string) => void;
    deleteSession: (index: number) => Promise<void>;
    renameSession: (sessionId: string, title: string) => Promise<void>;
    currentSession: () => AgentChatSession;
    onSendMessage: (newMessage: Message) => Promise<void>;
    updateCurrentSession: (updater: (session: AgentChatSession) => void) => void;
    resetContext: (sessionId?: string) => Promise<void>;
    cancelGeneration: (sessionId?: string) => Promise<void>;
    cancelRun: (runId: string, sessionId?: string) => Promise<void>;
    onRetry: (messageId?: string) => Promise<void>;
    deleteMessage: (message: Message) => Promise<void>;
    createNewMessage: (value: string, role?: MessageRole) => Message;
}

export const CHAT_REQUEST_FINISHED_EVENT = "llm-market:chat-request-finished";

const AVATAR = "/role/wali.png";
const USER_AVATAR = "/role/runny-nose.png";
const TERMINAL_STATES = new Set<AgentRunStatus>([
    "succeeded",
    "failed",
    "cancelled",
    "budget_exhausted",
    "interrupted",
]);

type Poller = {promise: Promise<void>};
const pollers = new Map<string, Poller>();

function accountKey(): string {
    const {token, username} = useAccessStore.getState();
    return token ? `${username}:${token}` : "";
}

function parseTime(value?: string): number {
    if (!value) return Date.now();
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
}

function runSortTime(run: AgentRunRecord): number {
    const timestamp = (value?: string) => {
        if (!value) return 0;
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    return Math.max(
        timestamp(run.created_at),
        timestamp(run.updated_at),
        timestamp(run.started_at || undefined),
        timestamp(run.finished_at || undefined),
    );
}

function latestRun(runs: AgentRunRecord[]): AgentRunRecord | undefined {
    return runs.reduce<AgentRunRecord | undefined>((latest, candidate) => {
        if (!latest || runSortTime(candidate) >= runSortTime(latest)) return candidate;
        return latest;
    }, undefined);
}

function hasMessagesAfterContextReset(session: AgentChatSession): boolean {
    return Object.values(session.messageSeqs).some((seq) =>
        session.contextResetAfterSeq == null || seq > session.contextResetAfterSeq,
    );
}

function statusForMessage(status?: string, content = ""): MessageStatus | undefined {
    if (status === "queued" || status === "running" || status === "streaming") return MessageStatus.Sending;
    if (status === "failed" || status === "interrupted" || status === "budget_exhausted") return MessageStatus.Error;
    if (status === "cancelled") return MessageStatus.Cancelled;
    return content ? undefined : undefined;
}

function messageText(value: unknown): string {
    if (typeof value === "string") return value;
    if (value == null) return "";
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function errorForRun(status: AgentRunStatus, error?: string | null): string | undefined {
    if (error) return error;
    if (status === "interrupted") return "服务中断，可重试";
    if (status === "budget_exhausted") return "可用预算或余额不足以继续，已保留生成内容";
    if (status === "cancelled") return "已停止运行";
    if (status === "failed") return "运行失败，请重试";
    return undefined;
}

function isActiveRunConflict(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || "");
    return /(?:HTTP\s*)?409|active run|already has an active run/i.test(message);
}

function messageFromRecord(record: AgentMessageRecord): Message | null {
    // Server history intentionally hides system/tool messages from chat bubbles.
    if (record.role !== MessageRole.user && record.role !== MessageRole.assistant) return null;
    const content = messageText(record.content);
    const status = statusForMessage(record.status, content);
    return {
        id: record.message_id || nanoid(),
        content,
        message_type: MessageType.Text,
        time: parseTime(record.created_at),
        direction: record.role === MessageRole.user ? MessageDirection.Send : MessageDirection.Receive,
        role: record.role,
        avatar: record.role === MessageRole.user ? USER_AVATAR : AVATAR,
        ...(status ? {status} : {}),
        ...(record.status && status && status !== MessageStatus.Sending ? {error: errorForRun(record.status as AgentRunStatus)} : {}),
        ...(record.run_id ? {runId: record.run_id} : {}),
        quotes: record.quotes,
        attachments: record.attachments,
        attachmentIds: record.attachments?.map((item) => item.id),
        sources: record.role === MessageRole.assistant ? record.sources : [],
    };
}

function mergeMessageSnapshot(previous: Message, next: Message): Message {
    const sameRun = Boolean(previous.runId && next.runId && previous.runId === next.runId);
    const previousContent = typeof previous.content === "string" ? previous.content : "";
    const nextContent = typeof next.content === "string" ? next.content : "";
    const content = sameRun && previousContent.length > nextContent.length ? previousContent : nextContent;
    // A response that was fetched before a terminal update must not make a
    // completed message look like it is still streaming.
    const staleStreamingStatus = previous.status && previous.status !== MessageStatus.Sending
        && next.status === MessageStatus.Sending;
    return {
        ...next,
        content,
        ...(staleStreamingStatus ? {status: previous.status, error: previous.error} : {}),
    };
}

function defaultConfig(): SessionConfig {
    return {gptVersion: GptVersion.DEEPSEEK_FLASH, mode: "chat", budgetLimit: 0.25, thinking: false, webSearch: false};
}

function webSearchStorageKey(sessionId: string): string {
    return `llm-market:web-search:${encodeURIComponent(useAccessStore.getState().username || "")}:${sessionId}`;
}

function webSearchPreference(sessionId: string, fallback = false): boolean {
    try {
        if (typeof window === "undefined") return fallback;
        const value = window.localStorage.getItem(webSearchStorageKey(sessionId));
        return value === null ? fallback : value === "true";
    } catch { return fallback; }
}

function summaryToSession(summary: AgentSessionSummary): AgentChatSession {
    const timestamp = parseTime(summary.updated_at || summary.created_at);
    return {
        id: summary.session_id,
        kind: summary.kind,
        dialog: {
            avatar: AVATAR,
            title: summary.title || "新的对话",
            count: 0,
            subTitle: summary.active_run_id ? "正在运行…" : "开始一段新的对话",
            timestamp,
        },
        messages: [],
        config: {...defaultConfig(), webSearch: webSearchPreference(summary.session_id)},
        serverMessageIds: {},
        contextResetAfterSeq: summary.context_reset_after_seq ?? null,
        messageSeqs: {},
        runs: [],
        activeRunId: summary.active_run_id || null,
        createdAt: summary.created_at,
        updatedAt: summary.updated_at,
    };
}

function detailToSession(detail: AgentSessionDetail, previous?: AgentChatSession): AgentChatSession {
    const summary = detail.session;
    const serverMessageIds: Record<string, true> = {};
    const messageSeqs: Record<string, number> = {};
    for (const record of detail.messages) {
        if (record.message_id) serverMessageIds[record.message_id] = true;
        if (record.message_id && typeof record.seq === "number" && Number.isFinite(record.seq)) {
            messageSeqs[record.message_id] = record.seq;
        }
    }
    const previousMessages = previous?.messages || [];
    const usedPreviousMessages = new Set<number>();
    const messages = detail.messages.map((record) => {
        const next = messageFromRecord(record);
        if (!next) return null;
        let previousIndex = previousMessages.findIndex((candidate, index) =>
            !usedPreviousMessages.has(index) && candidate.id === next.id,
        );
        if (previousIndex < 0 && next.role === MessageRole.assistant && next.runId) {
            previousIndex = previousMessages.findIndex((candidate, index) =>
                !usedPreviousMessages.has(index) && candidate.role === MessageRole.assistant
                    && (candidate.runId === next.runId || (!candidate.runId && candidate.status === MessageStatus.Sending)),
            );
        }
        if (previousIndex < 0 && next.role === MessageRole.user) {
            // The optimistic user message has a client ID, while history has
            // the server ID. Matching its content prevents a refresh from
            // briefly rendering the same prompt twice.
            previousIndex = previousMessages.findIndex((candidate, index) =>
                !usedPreviousMessages.has(index) && candidate.role === MessageRole.user
                    && candidate.content === next.content,
            );
        }
        if (previousIndex >= 0) {
            usedPreviousMessages.add(previousIndex);
            return mergeMessageSnapshot(previousMessages[previousIndex], next);
        }
        return next;
    }).filter((message): message is Message => Boolean(message));

    // Preserve optimistic messages while their create-run request is in
    // flight. Once the server assigns a message ID, the content matching
    // above replaces the optimistic copy with its durable record.
    for (let index = 0; index < previousMessages.length; index += 1) {
        const message = previousMessages[index];
        if (usedPreviousMessages.has(index) || previous?.serverMessageIds[message.id]) continue;
        messages.push({...message});
    }

    // Partial output stays readable after reload, together with the persisted
    // run's reason for stopping (including a budget-limited output length).
    const runsById = new Map<string, AgentRunRecord>();
    for (const run of previous?.runs || []) runsById.set(run.run_id, run);
    for (const run of detail.runs) {
        runsById.set(run.run_id, mergeRunSnapshot(runsById.get(run.run_id), run) as AgentRunRecord);
    }
    for (const run of [previous?.activeRun, previous?.latestRun]) {
        if (!run) continue;
        runsById.set(run.run_id, mergeRunSnapshot(runsById.get(run.run_id), run) as AgentRunRecord);
    }
    const runs = Array.from(runsById.values());
    for (const message of messages) {
        const run = message.runId ? runsById.get(message.runId) : undefined;
        if (message.role !== MessageRole.assistant || !run) continue;
        if (run.sources) message.sources = run.sources;
        if (typeof run.output === "string" && run.output.length > message.content.length) {
            message.content = run.output;
        }
        if (TERMINAL_STATES.has(run.status)) {
            if (run.status === "succeeded") {
                delete message.status;
                delete message.error;
            } else {
                message.status = run.status === "cancelled" ? MessageStatus.Cancelled : MessageStatus.Error;
                message.error = errorForRun(run.status, run.error);
            }
        } else {
            message.status = MessageStatus.Sending;
            delete message.error;
        }
    }
    const newestRun = latestRun(runs);
    const activeRuns = orderQueuedRuns(runs.filter((run) => !TERMINAL_STATES.has(run.status)));
    const summaryRun = summary.active_run_id ? runsById.get(summary.active_run_id) : undefined;
    const declaredHead = queueHead(activeRuns, summary.active_run_id);
    const activeRun = declaredHead
        || (summaryRun && !TERMINAL_STATES.has(summaryRun.status) ? summaryRun : undefined);
    const activeRunId = activeRun?.run_id
        || (summary.active_run_id && (!summaryRun || !TERMINAL_STATES.has(summaryRun.status)) ? summary.active_run_id : null);
    const unboundOptimisticAssistants = messages.filter((message) =>
        message.role === MessageRole.assistant && message.status === MessageStatus.Sending && !message.runId,
    );
    for (const queuedRun of activeRuns) {
        if (messages.some((message) => message.runId === queuedRun.run_id && message.role === MessageRole.assistant)) continue;
        const optimisticAssistant = unboundOptimisticAssistants.shift();
        if (optimisticAssistant) {
            optimisticAssistant.runId = queuedRun.run_id;
            if ((queuedRun.output || "").length >= optimisticAssistant.content.length) {
                optimisticAssistant.content = queuedRun.output || "";
            }
            continue;
        }
        messages.push({
            id: nanoid(),
            content: queuedRun.output || "",
            message_type: MessageType.Text,
            time: parseTime(queuedRun.created_at),
            direction: MessageDirection.Receive,
            role: MessageRole.assistant,
            avatar: AVATAR,
            status: MessageStatus.Sending,
            runId: queuedRun.run_id,
        });
    }
    const last = messages[messages.length - 1];
    return {
        ...(previous || summaryToSession(summary)),
        id: summary.session_id,
        kind: summary.kind,
        dialog: {
            avatar: previous?.dialog.avatar || AVATAR,
            title: summary.title || previous?.dialog.title || "新的对话",
            count: messages.length,
            subTitle: activeRun ? (activeRun.status === "queued" ? "等待运行…" : "正在运行…") : (last?.content?.slice(0, 80) || "开始一段新的对话"),
            timestamp: parseTime(summary.updated_at || summary.created_at),
        },
        messages,
        config: {...(previous?.config || defaultConfig()),
            webSearch: webSearchPreference(summary.session_id, previous?.config.webSearch ?? newestRun?.web_search ?? false)},
        serverMessageIds,
        contextResetAfterSeq: Object.prototype.hasOwnProperty.call(summary, "context_reset_after_seq")
            ? (summary.context_reset_after_seq ?? null)
            : (previous?.contextResetAfterSeq ?? null),
        messageSeqs,
        runs,
        activeRunId,
        activeRun,
        latestRun: newestRun || previous?.latestRun,
        createdAt: summary.created_at,
        updatedAt: summary.updated_at,
    };
}

function emptySession(): AgentChatSession {
    return {
        id: "",
        dialog: {avatar: AVATAR, title: "新的对话", count: 0, subTitle: "开始一段新的对话", timestamp: Date.now()},
        messages: [],
        config: defaultConfig(),
        serverMessageIds: {},
        contextResetAfterSeq: null,
        messageSeqs: {},
        runs: [],
        activeRunId: null,
    };
}

function makeMessage(value: string, role: MessageRole = MessageRole.user): Message {
    return {
        avatar: role === MessageRole.user ? USER_AVATAR : AVATAR,
        content: value,
        message_type: MessageType.Text,
        time: Date.now(),
        direction: role === MessageRole.user ? MessageDirection.Send : MessageDirection.Receive,
        role,
        id: nanoid(),
    };
}

export function createNewMessage(value: string, role: MessageRole = MessageRole.user): Message {
    return makeMessage(value, role);
}

type WakeListener = () => void;
const recoveryWakeListeners = new Set<WakeListener>();
let recoveryWakeListenersInstalled = false;

function wakeRecoveryLoops(): void {
    for (const listener of Array.from(recoveryWakeListeners)) listener();
}

function waitForRecoveryWake(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
            if (settled) return;
            settled = true;
            if (timer !== undefined) clearTimeout(timer);
            recoveryWakeListeners.delete(finish);
            resolve();
        };
        recoveryWakeListeners.add(finish);
        timer = setTimeout(finish, Math.max(0, milliseconds));
    });
}

function installRecoveryWakeListeners(): void {
    if (recoveryWakeListenersInstalled || typeof window === "undefined") return;
    recoveryWakeListenersInstalled = true;
    window.addEventListener("online", wakeRecoveryLoops);
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") wakeRecoveryLoops();
        });
    }
}

function scopedRecoveryKey(account: string, id: string): string {
    return `${account}\u0000${id}`;
}

export const userChatStore = create<AgentChatStore>((set, get) => {
    installRecoveryWakeListeners();
    const sessionRequestVersions = new Map<string, number>();
    const sessionRevisions = new Map<string, number>();
    const sessionSyncers = new Map<string, Promise<void>>();
    const initialRecoveryLoops = new Map<string, Promise<void>>();
    const unavailableSessions = new Set<string>();
    let sessionsRequestVersion = 0;
    let selectionVersion = 0;

    const currentAccountIs = (key: string): boolean =>
        Boolean(key) && key === accountKey() && (!get().accountKey || key === get().accountKey);

    const nextSessionRequestVersion = (sessionId: string, key = accountKey()): number => {
        const scoped = scopedRecoveryKey(key, sessionId);
        const version = (sessionRequestVersions.get(scoped) || 0) + 1;
        sessionRequestVersions.set(scoped, version);
        return version;
    };

    const bumpSessionRevision = (sessionId: string, key = accountKey()): number => {
        const scoped = scopedRecoveryKey(key, sessionId);
        const revision = (sessionRevisions.get(scoped) || 0) + 1;
        sessionRevisions.set(scoped, revision);
        return revision;
    };

    const currentSessionRevision = (sessionId: string, key = accountKey()): number =>
        sessionRevisions.get(scopedRecoveryKey(key, sessionId)) || 0;

    const requestStillCurrent = (sessionId: string, requestVersion: number, key: string, revision: number): boolean =>
        requestVersion === sessionRequestVersions.get(scopedRecoveryKey(key, sessionId))
        && revision === currentSessionRevision(sessionId, key)
        && currentAccountIs(key);

    const updateSessionById = (sessionId: string, updater: (session: AgentChatSession) => void): boolean => {
        const state = get();
        const index = state.sessions.findIndex((session) => session.id === sessionId);
        if (index < 0) return false;
        const next = {
            ...state.sessions[index],
            dialog: {...state.sessions[index].dialog},
            config: {...state.sessions[index].config},
            messages: state.sessions[index].messages.slice(),
            serverMessageIds: {...state.sessions[index].serverMessageIds},
            messageSeqs: {...state.sessions[index].messageSeqs},
            runs: state.sessions[index].runs.slice(),
        };
        updater(next);
        if (next.config.webSearch !== state.sessions[index].config.webSearch) {
            try { window.localStorage.setItem(webSearchStorageKey(sessionId), String(Boolean(next.config.webSearch))); }
            catch { /* Storage restrictions must not prevent chatting. */ }
        }
        const sessions = state.sessions.slice();
        sessions[index] = next;
        set({sessions});
        return true;
    };

    const updateMessageById = (sessionId: string, messageId: string, updater: (message: Message) => void) =>
        updateSessionById(sessionId, (session) => {
            const message = session.messages.find((item) => item.id === messageId);
            if (message) updater(message);
        });

    const replaceSessionDetail = (sessionId: string, detail: AgentSessionDetail): AgentChatSession | undefined => {
        // An explicit mutation response is authoritative. Invalidate any
        // detail request that started before that mutation completed.
        nextSessionRequestVersion(sessionId);
        const previous = get().sessions.find((item) => item.id === sessionId);
        const hydrated = detailToSession(detail, previous);
        set((state) => ({
            sessions: state.sessions.map((item) => item.id === sessionId ? hydrated : item),
            error: undefined,
        }));
        return hydrated;
    };

    const applyRun = (sessionId: string, run: AgentRunRecord, assistantMessageId?: string) => {
        let becameTerminal = false;
        updateSessionById(sessionId, (session) => {
            const previousRun = session.runs.find((candidate) => candidate.run_id === run.run_id)
                || (session.activeRun?.run_id === run.run_id ? session.activeRun : undefined)
                || (session.latestRun?.run_id === run.run_id ? session.latestRun : undefined);
            const effectiveRun = mergeRunSnapshot(previousRun, run) as AgentRunRecord;
            const knownRuns = new Map(session.runs.map((candidate) => [candidate.run_id, candidate]));
            knownRuns.set(effectiveRun.run_id, effectiveRun);
            session.runs = Array.from(knownRuns.values());
            let message = assistantMessageId
                ? session.messages.find((item) => item.id === assistantMessageId)
                : session.messages.find((item) => item.runId === effectiveRun.run_id && item.role === MessageRole.assistant);
            if (!message) {
                message = session.messages.slice().reverse().find((item) => item.role === MessageRole.assistant && item.status === MessageStatus.Sending);
            }
            if (message) {
                message.runId = effectiveRun.run_id;
                if (effectiveRun.sources) message.sources = effectiveRun.sources;
                if ((effectiveRun.output || "").length >= message.content.length) message.content = effectiveRun.output || "";
                if (TERMINAL_STATES.has(effectiveRun.status)) {
                    if (effectiveRun.status === "succeeded") {
                        delete message.status;
                        delete message.error;
                    } else {
                        message.status = effectiveRun.status === "cancelled" ? MessageStatus.Cancelled : MessageStatus.Error;
                        message.error = errorForRun(effectiveRun.status, effectiveRun.error);
                    }
                } else {
                    message.status = MessageStatus.Sending;
                    delete message.error;
                }
            }
            becameTerminal = !previousRun || !TERMINAL_STATES.has(previousRun.status);
            session.latestRun = latestRun(session.runs) || effectiveRun;
            const activeRuns = orderQueuedRuns(session.runs.filter((candidate) => !TERMINAL_STATES.has(candidate.status)));
            session.activeRun = queueHead(activeRuns, session.activeRunId);
            session.activeRunId = session.activeRun?.run_id || null;
            session.dialog.subTitle = session.activeRun
                ? (session.activeRun.status === "queued" ? "等待运行…" : "正在运行…")
                : (message?.content?.slice(0, 80) || "开始一段新的对话");
            session.dialog.timestamp = Date.now();
        });
        if (becameTerminal && TERMINAL_STATES.has(run.status) && typeof window !== "undefined") {
            window.dispatchEvent(new Event(CHAT_REQUEST_FINISHED_EVENT));
        }
    };

    const hydrateSession = async (sessionId: string): Promise<AgentChatSession | undefined> => {
        const key = accountKey();
        if (!sessionId || !key) return undefined;
        const requestVersion = nextSessionRequestVersion(sessionId);
        const revision = currentSessionRevision(sessionId, key);
        let detail: AgentSessionDetail;
        try {
            detail = await getAgentSession(sessionId);
        } catch (error) {
            // A superseded request must not surface an error from a route the
            // user has already left.
            if (!requestStillCurrent(sessionId, requestVersion, key, revision)) return undefined;
            throw error;
        }
        if (!requestStillCurrent(sessionId, requestVersion, key, revision)) return undefined;
        const previous = get().sessions.find((item) => item.id === sessionId);
        const hydrated = detailToSession(detail, previous);
        if (!requestStillCurrent(sessionId, requestVersion, key, revision)) return undefined;
        unavailableSessions.delete(scopedRecoveryKey(key, sessionId));
        set((state) => ({
            sessions: state.sessions.some((item) => item.id === sessionId)
                ? state.sessions.map((item) => item.id === sessionId ? hydrated : item)
                : state.sessions.concat(hydrated),
            error: undefined,
        }));
        for (const run of hydrated.runs.filter((candidate) => !TERMINAL_STATES.has(candidate.status))) {
            void pollRun(sessionId, run);
        }
        return hydrated;
    };

    const startSessionSync = (sessionId: string): Promise<void> => {
        const key = accountKey();
        const syncKey = scopedRecoveryKey(key, sessionId);
        const existing = sessionSyncers.get(syncKey);
        if (existing) return existing;
        const promise = syncDurableSession<AgentChatSession>({
            getSession: () => get().sessions.find((item) => item.id === sessionId),
            isCurrent: () => currentAccountIs(key),
            shouldRefresh: (session) => {
                const visible = get().currentSession().id === sessionId
                    && (typeof document === "undefined" || document.visibilityState !== "hidden");
                return visible || Boolean(session.activeRunId);
            },
            wait: waitForRecoveryWake,
            delayFor: (session) => {
                const visible = get().currentSession().id === sessionId
                    && (typeof document === "undefined" || document.visibilityState !== "hidden");
                return session.activeRunId ? 1000 : visible ? 2200 : 5000;
            },
            refresh: () => hydrateSession(sessionId),
            onSession: () => {},
        }).finally(() => sessionSyncers.delete(syncKey));
        sessionSyncers.set(syncKey, promise);
        return promise;
    };

    const pollRun = (sessionId: string, run: AgentRunRecord, assistantMessageId?: string): Promise<void> => {
        const key = accountKey();
        const pollerKey = scopedRecoveryKey(key, run.run_id);
        const existing = pollers.get(pollerKey);
        if (existing) return existing.promise;
        const promise = pollDurableRun<AgentRunRecord>({
            initialRun: run,
            readEvents: getAgentRunEvents,
            isCurrent: () => currentAccountIs(key),
            wait: waitForRecoveryWake,
            isTerminal: (status) => TERMINAL_STATES.has(status as AgentRunStatus),
            onSnapshot: async (snapshot) => {
                applyRun(sessionId, snapshot, assistantMessageId);
                if (TERMINAL_STATES.has(snapshot.status)) {
                    try {
                        await hydrateSession(sessionId);
                    } catch {
                        // The run state and latest output remain useful if the detail refresh races shutdown.
                    }
                }
            },
        }).finally(() => pollers.delete(pollerKey));
        pollers.set(pollerKey, {promise});
        return promise;
    };

    const startInitialRecovery = (key: string): Promise<void> => {
        const existing = initialRecoveryLoops.get(key);
        if (existing) return existing;
        const promise = (async () => {
            while (currentAccountIs(key) && !get().sessions.length) {
                // Online and visible-tab events wake this immediately; the
                // timeout also covers a network that recovered silently.
                await waitForRecoveryWake(5000);
                if (!currentAccountIs(key) || get().sessions.length) return;
                await get().loadSessions();
            }
        })().finally(() => initialRecoveryLoops.delete(key));
        initialRecoveryLoops.set(key, promise);
        return promise;
    };

    return {
        accountKey: "",
        sessions: [],
        currentSessionIndex: 0,
        loading: false,
        async loadSessions() {
            const requestVersion = ++sessionsRequestVersion;
            const key = accountKey();
            if (!key) {
                set({accountKey: "", sessions: [], currentSessionIndex: 0, loading: false});
                return;
            }
            set({accountKey: key, loading: true, error: undefined, sessions: [], currentSessionIndex: 0});
            try {
                let summaries = await listAgentSessions();
                if (!summaries.length) summaries = [await createAgentSession()];
                if (requestVersion !== sessionsRequestVersion || key !== accountKey()) return;
                const sessions = summaries.map(summaryToSession);
                set({accountKey: key, sessions, currentSessionIndex: 0, loading: false});
                await get().loadSession(sessions[0].id);
            } catch (error) {
                if (requestVersion === sessionsRequestVersion && key === accountKey()) {
                    set({loading: false, error: error instanceof Error ? error.message : "无法读取服务器会话"});
                    void startInitialRecovery(key);
                }
            }
        },
        async loadSession(sessionId) {
            if (!sessionId || !accountKey()) return;
            try {
                const hydrated = await hydrateSession(sessionId);
                if (hydrated) startSessionSync(sessionId);
            } catch (error) {
                const key = accountKey();
                if (currentAccountIs(key)) {
                    const unavailable = error instanceof Error && /HTTP 404/.test(error.message);
                    if (unavailable) {
                        unavailableSessions.add(scopedRecoveryKey(key, sessionId));
                    } else {
                        // The session summary is still usable when its detail
                        // request was interrupted. Keep a watcher attached so
                        // an online/visibility wake or the next timer retries
                        // hydration instead of leaving this session stale.
                        void startSessionSync(sessionId);
                    }
                    set({error: error instanceof Error ? error.message : "无法读取服务器会话"});
                }
            }
        },
        async openSession(dialog) {
            const key = accountKey();
            if (!key) throw new Error("登录状态已失效，请重新登录");
            const summary = await createAgentSession(dialog?.title);
            if (!currentAccountIs(key)) throw new Error("账号已切换，请重试");
            const session = summaryToSession(summary);
            set((state) => ({sessions: [session, ...state.sessions], currentSessionIndex: 0, error: undefined}));
            wakeRecoveryLoops();
            await get().loadSession(session.id);
            return get().sessions.find((item) => item.id === session.id) || session;
        },
        selectSession(index) {
            const session = get().sessions[index];
            if (!session) return;
            selectionVersion += 1;
            set({currentSessionIndex: index, error: undefined});
            wakeRecoveryLoops();
            void get().loadSession(session.id);
        },
        selectSessionById(sessionId) {
            const key = accountKey();
            if (!key || unavailableSessions.has(scopedRecoveryKey(key, sessionId))) return;
            const index = get().sessions.findIndex((session) => session.id === sessionId);
            if (index >= 0) {
                get().selectSession(index);
                return;
            }
            const requestedSelection = ++selectionVersion;
            wakeRecoveryLoops();
            void get().loadSession(sessionId).then(() => {
                if (requestedSelection !== selectionVersion) return;
                const loadedIndex = get().sessions.findIndex((session) => session.id === sessionId);
                if (loadedIndex >= 0) set({currentSessionIndex: loadedIndex, error: undefined});
            });
        },
        async deleteSession(index) {
            const session = get().sessions[index];
            if (!session) return;
            if (session.activeRunId) throw new Error("运行中的会话不能删除");
            await deleteAgentSession(session.id);
            const sessions = get().sessions.filter((_, itemIndex) => itemIndex !== index);
            if (!sessions.length) {
                const created = summaryToSession(await createAgentSession());
                set({sessions: [created], currentSessionIndex: 0});
                await get().loadSession(created.id);
                return;
            }
            const currentIndex = get().currentSessionIndex;
            const nextIndex = Math.max(0, Math.min(
                currentIndex - Number(index < currentIndex),
                sessions.length - 1,
            ));
            set({sessions, currentSessionIndex: nextIndex, error: undefined});
        },
        async renameSession(sessionId, title) {
            if (!get().sessions.some((session) => session.id === sessionId)) return;
            bumpSessionRevision(sessionId);
            const summary = await renameAgentSession(sessionId, title.trim() || "新的对话");
            updateSessionById(sessionId, (session) => {
                session.dialog.title = summary.title;
                session.updatedAt = summary.updated_at;
            });
        },
        currentSession() {
            const sessions = get().sessions;
            if (!sessions.length) return emptySession();
            const index = Math.max(0, Math.min(get().currentSessionIndex, sessions.length - 1));
            if (index !== get().currentSessionIndex) set({currentSessionIndex: index});
            return sessions[index];
        },
        async onSendMessage(newMessage) {
            let session = get().currentSession();
            if (!session.id) {
                try {
                    session = await get().openSession();
                } catch {
                    return;
                }
            }
            const key = accountKey();
            if (!currentAccountIs(key)) return;
            bumpSessionRevision(session.id);
            const optimisticUser = {...newMessage, id: newMessage.id || nanoid()};
            const assistantMessage = makeMessage("", MessageRole.assistant);
            assistantMessage.status = MessageStatus.Sending;
            updateSessionById(session.id, (target) => {
                target.messages.push(optimisticUser, assistantMessage);
                target.dialog.count = target.messages.length;
                target.dialog.subTitle = "正在运行…";
                target.dialog.timestamp = Date.now();
            });
            const latest = get().sessions.find((item) => item.id === session.id);
            if (!latest) return;
            try {
                const mode: AgentMode = latest.config.mode || "chat";
                const budget = latest.config.budgetLimit ?? (mode === "research" ? 1 : 0.25);
                const run = await createAgentRun(session.id, {
                    content: newMessage.content,
                    model: normalizeGptVersion(latest.config.gptVersion),
                    mode,
                    request_id: nanoid(32),
                    budget_limit: budget,
                    thinking: Boolean(latest.config.thinking),
                    web_search: Boolean(latest.config.webSearch),
                    attachment_ids: newMessage.attachmentIds || [],
                    quotes: newMessage.quotes || [],
                });
                if (!currentAccountIs(key)) return;
                applyRun(session.id, run, assistantMessage.id);
                void pollRun(session.id, run, assistantMessage.id);
            } catch (error) {
                if (!currentAccountIs(key)) return;
                if (isActiveRunConflict(error)) {
                    updateSessionById(session.id, (target) => {
                        target.messages = target.messages.filter((message) =>
                            message.id !== optimisticUser.id && message.id !== assistantMessage.id,
                        );
                        target.dialog.count = target.messages.length;
                    });
                    try {
                        await hydrateSession(session.id);
                    } catch {
                        // The active run will be found by the session watcher.
                    }
                    return;
                }
                updateMessageById(session.id, assistantMessage.id, (message) => {
                    message.status = MessageStatus.Error;
                    message.error = error instanceof Error ? error.message : "启动运行失败，请重试";
                });
            }
        },
        updateCurrentSession(updater) {
            const session = get().currentSession();
            if (session.id) updateSessionById(session.id, updater);
        },
        async resetContext(sessionId) {
            const session = sessionId
                ? get().sessions.find((item) => item.id === sessionId)
                : get().currentSession();
            if (!session?.id || session.activeRunId || !hasMessagesAfterContextReset(session)) return;
            bumpSessionRevision(session.id);
            try {
                const detail = await resetAgentSessionContext(session.id);
                const hydrated = replaceSessionDetail(session.id, detail);
                if (hydrated) {
                    for (const run of hydrated.runs.filter((candidate) => !TERMINAL_STATES.has(candidate.status))) {
                        void pollRun(session.id, run);
                    }
                }
            } catch (error) {
                set({error: error instanceof Error ? error.message : "重置上下文失败"});
                throw error;
            }
        },
        async cancelGeneration(sessionId) {
            const session = sessionId
                ? get().sessions.find((item) => item.id === sessionId)
                : get().currentSession();
            if (!session?.activeRunId) return;
            await get().cancelRun(session.activeRunId, session.id);
        },
        async cancelRun(runId, sessionId) {
            const session = sessionId
                ? get().sessions.find((item) => item.id === sessionId)
                : get().sessions.find((item) => item.runs.some((run) => run.run_id === runId));
            if (!session || !runId) return;
            try {
                const result = await cancelAgentRun(runId);
                if (result) {
                    applyRun(session.id, result);
                } else {
                    try {
                        await hydrateSession(session.id);
                    } catch {
                        // The session synchronizer will observe a 204 cancellation response.
                    }
                }
            } catch (error) {
                set({error: error instanceof Error ? error.message : "停止运行失败"});
            }
        },
        async onRetry(messageId) {
            const session = get().currentSession();
            if (!messageId || !session.id) return;
            const index = session.messages.findIndex((message) => message.id === messageId);
            const failed = session.messages[index];
            if (!failed || (failed.status !== MessageStatus.Error && failed.status !== MessageStatus.Cancelled)) return;
            const previousUser = session.messages.slice(0, index).reverse().find((message) => message.role === MessageRole.user);
            if (!previousUser) return;
            const retryUserMessage = makeMessage(previousUser.content, MessageRole.user);
            retryUserMessage.quotes = previousUser.quotes;
            retryUserMessage.attachments = previousUser.attachments;
            retryUserMessage.attachmentIds = previousUser.attachmentIds;
            const assistantMessage = makeMessage("", MessageRole.assistant);
            assistantMessage.status = MessageStatus.Sending;
            bumpSessionRevision(session.id);
            const key = accountKey();
            if (!currentAccountIs(key)) return;
            updateSessionById(session.id, (target) => {
                target.messages.push(retryUserMessage, assistantMessage);
                target.dialog.count = target.messages.length;
                target.dialog.subTitle = "正在运行…";
                target.dialog.timestamp = Date.now();
            });
            try {
                const mode = session.config.mode || "chat";
                const run = await createAgentRun(session.id, {
                    content: previousUser.content,
                    model: normalizeGptVersion(session.config.gptVersion),
                    mode,
                    request_id: nanoid(32),
                    budget_limit: session.config.budgetLimit ?? (mode === "research" ? 1 : 0.25),
                    thinking: Boolean(session.config.thinking),
                    web_search: Boolean(session.config.webSearch),
                    attachment_ids: previousUser.attachmentIds || [],
                    quotes: previousUser.quotes || [],
                });
                if (!currentAccountIs(key)) return;
                applyRun(session.id, run, assistantMessage.id);
                void pollRun(session.id, run, assistantMessage.id);
            } catch (error) {
                if (!currentAccountIs(key)) return;
                if (isActiveRunConflict(error)) {
                    updateSessionById(session.id, (target) => {
                        target.messages = target.messages.filter((message) =>
                            message.id !== retryUserMessage.id && message.id !== assistantMessage.id,
                        );
                        target.dialog.count = target.messages.length;
                    });
                    try {
                        await hydrateSession(session.id);
                    } catch {
                        // The active run will be found by the session watcher.
                    }
                    return;
                }
                updateMessageById(session.id, assistantMessage.id, (message) => {
                    message.status = MessageStatus.Error;
                    message.error = error instanceof Error ? error.message : "重试失败，请稍后再试";
                });
            }
        },
        async deleteMessage(message) {
            const session = get().currentSession();
            if (!session.id || session.activeRunId || !session.serverMessageIds[message.id]) return;
            bumpSessionRevision(session.id);
            try {
                const detail = await deleteAgentMessage(session.id, message.id);
                const hydrated = replaceSessionDetail(session.id, detail);
                if (hydrated) {
                    for (const run of hydrated.runs.filter((candidate) => !TERMINAL_STATES.has(candidate.status))) {
                        void pollRun(session.id, run);
                    }
                }
            } catch (error) {
                set({error: error instanceof Error ? error.message : "删除消息失败"});
                throw error;
            }
        },
        createNewMessage: makeMessage,
    };
});

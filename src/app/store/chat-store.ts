import {create} from "zustand";
import {persist} from "zustand/middleware";
import {
    Dialog,
    Message,
    MessageDirection,
    MessageRole,
    MessageStatus,
    MessageType,
    SessionConfig,
} from "@/types/chat";
import {GptVersion, normalizeGptVersion} from "@/app/constants";
import {nanoid} from "nanoid";
import {completions} from "@/apis";
import {useAccessStore} from "./access";
import {ChatStreamParser, extractErrorMessage} from "./chat-stream";

interface ChatStore {
    id: number;
    sessions: ChatSession[];
    currentSessionIndex: number;
    openSession: (dialog?: { avatar?: string; title?: string }) => ChatSession;
    selectSession: (index: number) => void;
    deleteSession: (index: number) => void;
    currentSession: () => ChatSession;
    onSendMessage: (newMessage: Message) => Promise<void>;
    updateCurrentSession: (updater: (session: ChatSession) => void) => void;
    cancelGeneration: (sessionId?: number) => void;
    onRetry: (messageId?: string) => Promise<void>;
    deleteMessage: (message: Message) => void;
    createNewMessage: (value: string) => Message;
}

export interface ChatSession {
    // 会话ID
    id: number;
    // 对话框体
    dialog: Dialog;
    // 对话消息
    messages: Message[];
    // 会话配置
    config: SessionConfig;
    // 清除会话的索引
    clearContextIndex?: number;
}

type PersistedChatSession = Omit<ChatSession, "config"> & {
    config?: Partial<SessionConfig>;
};

type PersistedChatState = {
    id?: number;
    sessions?: PersistedChatSession[];
    currentSessionIndex?: number;
};

type ActiveGeneration = {
    sessionId: number;
    assistantMessageId: string;
    controller: AbortController;
    delivered: boolean;
};

export const CHAT_REQUEST_FINISHED_EVENT = "llm-market:chat-request-finished";

const activeGenerations = new Map<number, ActiveGeneration>();

function durableMessage(message: Message): Message {
    const {status, error, streaming, ...durable} = message;
    return durable;
}

function migrateChatState(persistedState: unknown): ChatStore {
    if (!persistedState || typeof persistedState !== "object") {
        return {} as ChatStore;
    }

    const state = persistedState as PersistedChatState;
    const sessions = Array.isArray(state.sessions)
        ? state.sessions.map((session) => ({
            ...session,
            messages: Array.isArray(session.messages)
                ? session.messages.map(durableMessage)
                : [],
            config: {
                ...session.config,
                gptVersion: normalizeGptVersion(session.config?.gptVersion),
            },
        }))
        : undefined;

    return {
        ...state,
        ...(sessions ? {sessions} : {}),
    } as ChatStore;
}

function createChatSession(dialog?: {
    avatar?: string;
    title?: string;
}): ChatSession {
    return {
        id: 0,
        dialog: {
            avatar: dialog?.avatar || "/role/wali.png",
            title: dialog?.title || "新的对话",
            count: 0,
            subTitle: "请问有什么需要帮助的吗？",
            timestamp: new Date().getTime(),
        },
        messages: [
            {
                avatar: dialog?.avatar || "/role/wali.png",
                content: "请问有什么需要帮助的吗？",
                message_type: MessageType.Text,
                time: Date.now(),
                direction: MessageDirection.Receive,
                role: MessageRole.system,
                id: nanoid()
            }
        ],
        clearContextIndex: undefined,
        config: {
            gptVersion: GptVersion.DEEPSEEK_FLASH,
        }
    };
}

function formatMessages(messages: Message[]) {
    // Failed and cancelled assistant messages are local request state, not API context.
    const latestMessages = messages.length > 3 ? messages.slice(-3) : messages;
    return latestMessages
        .filter((message) => (
            message.status !== MessageStatus.Error &&
            message.status !== MessageStatus.Cancelled &&
            message.status !== MessageStatus.Sending
        ))
        .map(({content, role}) => ({content, role}));
}

export function createNewMessage(value: string, role: MessageRole = MessageRole.user): Message {
    return {
        avatar: role === MessageRole.user ? "/role/runny-nose.png" : "/role/wali.png",
        content: value,
        message_type: MessageType.Text,
        time: Date.now(),
        role,
        id: nanoid(),
    };
}

class ChatCompletionError extends Error {
    constructor(message: string, public readonly status?: number) {
        super(message);
        this.name = "ChatCompletionError";
    }
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

function makeAbortError(): Error {
    return new DOMException("生成已停止", "AbortError");
}

function getErrorMessage(error: unknown): string {
    if (error instanceof ChatCompletionError) return error.message;
    if (error instanceof Error && error.message) return error.message;
    return "生成失败，请重试";
}

export const userChatStore = create<ChatStore>()(
    persist(
        (set, get) => {
            const updateSessionById = (
                sessionId: number,
                updater: (session: ChatSession) => void,
            ): boolean => {
                const state = get();
                const index = state.sessions.findIndex((session) => session.id === sessionId);
                if (index < 0) return false;

                const session = state.sessions[index];
                const nextSession: ChatSession = {
                    ...session,
                    dialog: {...session.dialog},
                    config: {...session.config},
                    messages: session.messages.slice(),
                };
                updater(nextSession);

                const sessions = state.sessions.slice();
                sessions[index] = nextSession;
                set({sessions});
                return true;
            };

            const updateMessageById = (
                sessionId: number,
                messageId: string,
                updater: (message: Message) => void,
            ): boolean => updateSessionById(sessionId, (session) => {
                const message = session.messages.find((item) => item.id === messageId);
                if (message) updater(message);
            });

            const appendAssistantText = (
                generation: ActiveGeneration,
                text: string,
            ) => {
                if (!text || generation.controller.signal.aborted) return;
                generation.delivered = true;
                updateMessageById(
                    generation.sessionId,
                    generation.assistantMessageId,
                    (message) => {
                        message.content += text;
                    },
                );
            };

            const setAssistantState = (
                generation: ActiveGeneration,
                status?: MessageStatus,
                error?: string,
            ) => updateMessageById(
                generation.sessionId,
                generation.assistantMessageId,
                (message) => {
                    if (status) {
                        message.status = status;
                    } else {
                        delete message.status;
                    }
                    if (error) {
                        message.error = error;
                    } else {
                        delete message.error;
                    }
                },
            );

            const runGeneration = async (args: {
                sessionId: number;
                assistantMessageId: string;
                messages: {content: string; role: MessageRole}[];
                model: string;
                requestId: string;
            }): Promise<void> => {
                const generation: ActiveGeneration = {
                    sessionId: args.sessionId,
                    assistantMessageId: args.assistantMessageId,
                    controller: new AbortController(),
                    delivered: false,
                };
                activeGenerations.set(args.sessionId, generation);
                const parser = new ChatStreamParser();

                try {
                    const response = await completions(
                        {
                            messages: args.messages,
                            model: args.model,
                            requestId: args.requestId,
                        },
                        generation.controller.signal,
                    );

                    if (!response.ok) {
                        const body = await response.text();
                        const unauthorized = response.status === 401 && body.trim() === "0003";
                        if (unauthorized) {
                            useAccessStore.getState().goToLogin();
                        }
                        throw new ChatCompletionError(
                            unauthorized
                                ? "登录已过期，请重新登录"
                                : extractErrorMessage(body) || `请求失败（HTTP ${response.status}）`,
                            response.status,
                        );
                    }

                    if (!response.body) {
                        throw new ChatCompletionError("服务未返回可读取的内容");
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    while (true) {
                        const {done, value} = await reader.read();
                        if (done) break;

                        const result = parser.push(decoder.decode(value, {stream: true}));
                        appendAssistantText(generation, result.text);
                    }

                    const flushed = parser.push(decoder.decode());
                    appendAssistantText(generation, flushed.text);
                    const result = parser.finish();
                    appendAssistantText(generation, result.text);

                    if (generation.controller.signal.aborted) {
                        throw makeAbortError();
                    }

                    const streamError = parser.getErrorMessage() || result.error;
                    if (streamError) {
                        throw new ChatCompletionError(streamError);
                    }

                    setAssistantState(generation);
                } catch (error) {
                    if (generation.controller.signal.aborted || isAbortError(error)) {
                        setAssistantState(generation, MessageStatus.Cancelled, "已停止生成");
                    } else {
                        setAssistantState(generation, MessageStatus.Error, getErrorMessage(error));
                    }
                } finally {
                    if (activeGenerations.get(args.sessionId) === generation) {
                        activeGenerations.delete(args.sessionId);
                    }
                    if (typeof window !== "undefined") {
                        window.dispatchEvent(new Event(CHAT_REQUEST_FINISHED_EVENT));
                    }
                }
            };

            return {
            id: 0,
            sessions: [createChatSession()],
            currentSessionIndex: 0,

            openSession(dialog?: {avatar?: string; title?: string}) {
                const session = createChatSession(dialog);
                const id = get().id + 1;
                session.id = id;
                set((state) => ({
                    id,
                    currentSessionIndex: 0,
                    sessions: [session].concat(state.sessions),
                }));
                return session;
            },

            // 选择会话
            selectSession(index: number) {
                set({
                    currentSessionIndex: index,
                });
            },

            deleteSession(index: number) {
                const state = get();
                const session = state.sessions[index];
                if (!session) return;

                get().cancelGeneration(session.id);
                const sessions = get().sessions.slice();
                sessions.splice(index, 1);

                const currentIndex = get().currentSessionIndex;
                let nextIndex = Math.min(
                    currentIndex - Number(index < currentIndex),
                    sessions.length - 1,
                );

                if (state.sessions.length === 1) {
                    nextIndex = 0;
                    sessions.push(createChatSession());
                }

                set({currentSessionIndex: nextIndex, sessions});
            },

            currentSession() {
                const sessions = get().sessions;
                if (sessions.length === 0) {
                    const session = createChatSession();
                    set({sessions: [session], currentSessionIndex: 0});
                    return session;
                }

                let index = get().currentSessionIndex;
                if (index < 0 || index >= sessions.length) {
                    index = Math.min(sessions.length - 1, Math.max(0, index));
                    set({currentSessionIndex: index});
                }
                return sessions[index];
            },

            async onSendMessage(newMessage: Message) {
                const session = get().currentSession();
                if (activeGenerations.has(session.id)) return;

                const assistantMessage = createNewMessage("", MessageRole.assistant);
                assistantMessage.status = MessageStatus.Sending;
                const added = updateSessionById(session.id, (target) => {
                    target.messages = target.messages.concat(newMessage, assistantMessage);
                });
                if (!added) return;

                const latestSession = get().sessions.find((item) => item.id === session.id);
                if (!latestSession) return;
                const activeMessages = latestSession.messages.slice(latestSession.clearContextIndex ?? 0);

                await runGeneration({
                    sessionId: session.id,
                    assistantMessageId: assistantMessage.id,
                    messages: formatMessages(activeMessages),
                    model: normalizeGptVersion(latestSession.config.gptVersion),
                    requestId: nanoid(32),
                });
            },

            updateCurrentSession(updater) {
                const session = get().currentSession();
                updateSessionById(session.id, updater);
            },

            cancelGeneration(sessionId?: number) {
                const targetSessionId = sessionId ?? get().currentSession().id;
                const generation = activeGenerations.get(targetSessionId);
                if (!generation) return;

                generation.controller.abort();
                setAssistantState(generation, MessageStatus.Cancelled, "已停止生成");
            },

            async onRetry(messageId?: string) {
                const session = get().currentSession();
                if (!messageId || activeGenerations.has(session.id)) return;

                const index = session.messages.findIndex((message) => message.id === messageId);
                const failedMessage = session.messages[index];
                if (!failedMessage || (
                    failedMessage.status !== MessageStatus.Error &&
                    failedMessage.status !== MessageStatus.Cancelled
                )) {
                    return;
                }

                const activeMessages = session.messages.slice(
                    session.clearContextIndex ?? 0,
                    index,
                );
                const reset = updateMessageById(session.id, messageId, (message) => {
                    message.content = "";
                    message.status = MessageStatus.Sending;
                    delete message.error;
                });
                if (!reset) return;

                await runGeneration({
                    sessionId: session.id,
                    assistantMessageId: messageId,
                    messages: formatMessages(activeMessages),
                    model: normalizeGptVersion(session.config.gptVersion),
                    requestId: nanoid(32),
                });
            },

            deleteMessage(message: Message) {
                const session = get().currentSession();
                if (activeGenerations.has(session.id)) {
                    get().cancelGeneration(session.id);
                }
                updateSessionById(session.id, (target) => {
                    const index = target.messages.findIndex((item) => item.id === message.id);
                    if (index >= 0) target.messages.splice(index, 1);
                });
            },

            createNewMessage(value: string, role?: MessageRole) {
                return createNewMessage(value, role);
            },
        };
        },
        {
            name: "chat-store",
            version: 3,
            migrate: migrateChatState,
            partialize: (state) => ({
                id: state.id,
                currentSessionIndex: state.currentSessionIndex,
                sessions: state.sessions.map((session) => ({
                    ...session,
                    messages: session.messages.map(durableMessage),
                })),
            }),
        }
    ),
);

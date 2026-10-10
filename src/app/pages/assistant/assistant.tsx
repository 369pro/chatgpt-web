"use client";

import {
    ArrowRightOutlined,
    BookOutlined,
    CheckCircleFilled,
    CloudUploadOutlined,
    CloseOutlined,
    DeleteOutlined,
    FileTextOutlined,
    InboxOutlined,
    LinkOutlined,
    LoadingOutlined,
    LockOutlined,
    MailOutlined,
    PlusOutlined,
    ReloadOutlined,
    RobotOutlined,
    SaveOutlined,
    SearchOutlined,
    SendOutlined,
    SettingOutlined,
    SyncOutlined,
    WarningOutlined,
} from "@ant-design/icons";
import {useNavigate, useParams} from "react-router-dom";
import {ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState} from "react";
import ReactMarkdown from "react-markdown";
import RemarkGfm from "remark-gfm";
import {getModelCatalog} from "@/apis";
import {ChatModelOption} from "@/app/constants";
import {useAccessStore} from "@/app/store/access";
import {
    answerAssistantTask,
    archiveAssistantAttachment,
    AssistantApiError,
    AssistantConnection,
    AssistantDraft,
    AssistantDraftAttachment,
    AssistantEvent,
    AssistantKnowledgeDocument,
    AssistantKnowledgeSearchSource,
    AssistantMailQueryResult,
    AssistantMailQuerySource,
    AssistantMailQuerySync,
    AssistantOverview,
    AssistantRule,
    AssistantSource,
    AssistantTask,
    createAssistantConnection,
    createAssistantRule,
    createAssistantTask,
    deleteAssistantConnection,
    deleteAssistantKnowledgeFile,
    getAssistantKnowledge,
    getAssistantKnowledgeFile,
    getAssistantMailSource,
    getAssistantOverview,
    getAssistantRules,
    getAssistantTask,
    retryAssistantTask,
    reindexAssistantKnowledge,
    searchAssistantKnowledge,
    sendAssistantTask,
    syncAssistantConnection,
    updateAssistantDraft,
    updateAssistantSettings,
    uploadAssistantKnowledge,
} from "@/apis/assistant";
import styles from "./assistant.module.scss";
import KnowledgeQa from "./knowledge-qa";
import {SessionContextPanel} from "@/app/components/dialog/session-context-panel";

type AssistantTab = "tasks" | "knowledge" | "connections";
type Provider = "qq" | "163" | "126";

interface LocalDraftState {
    draft: AssistantDraft | null;
    dirty: boolean;
    conflict?: string;
}

interface ViewerState {
    source: AssistantSource;
    content: string;
    loading: boolean;
    error?: string;
}

interface MailSourceViewerState {
    source: AssistantMailQuerySource;
    loading: boolean;
    error?: string;
}

interface SettingsForm {
    enabled: boolean;
    monthly_budget: string;
    model: string;
}

interface ConnectionForm {
    provider: Provider;
    email: string;
    authorization_code: string;
}

const PROVIDERS: Array<{value: Provider; label: string; hint: string}> = [
    {value: "qq", label: "QQ 邮箱", hint: "mail.qq.com"},
    {value: "163", label: "网易 163", hint: "mail.163.com"},
    {value: "126", label: "网易 126", hint: "mail.126.com"},
];

const STATUS_LABELS: Record<string, string> = {
    queued: "排队中",
    run_queued: "模型排队中",
    analyzing: "分析中",
    running: "处理中",
    waiting_for_input: "等待补充",
    draft_ready: "草稿待确认",
    send_queued: "发送排队中",
    sending: "发送中",
    sent: "已发送",
    ignored: "已忽略",
    budget_paused: "预算暂停",
    delivery_unknown: "发送结果待核对",
    send_failed: "发送失败",
    partial: "部分完成",
    succeeded: "已完成",
    completed: "已完成",
    failed: "需要处理",
    cancelled: "已取消",
    connected: "已连接",
    ready: "已连接",
    syncing: "同步中",
    pending: "验证中",
    error: "连接异常",
    disconnected: "已断开",
    disabled: "未启用",
};

const PENDING_TASK_STATUSES = new Set([
    "waiting_for_input",
    "draft_ready",
    "send_failed",
    "failed",
    "budget_paused",
    "queued",
    "analyzing",
    "send_queued",
    "sending",
]);

function isPendingTask(task: AssistantTask): boolean {
    return PENDING_TASK_STATUSES.has(task.status);
}

function cloneDraft(draft: AssistantDraft | null | undefined): AssistantDraft | null {
    if (!draft) return null;
    return {
        ...draft,
        to: Array.isArray(draft.to) ? [...draft.to] : [],
        cc: Array.isArray(draft.cc) ? [...draft.cc] : [],
        attachments: Array.isArray(draft.attachments)
            ? draft.attachments
                .filter((attachment): attachment is AssistantDraftAttachment => Boolean(attachment && typeof attachment.path === "string" && typeof attachment.content_hash === "string"))
                .map(attachment => ({...attachment}))
            : [],
    };
}

function normalizeTask(task: AssistantTask): AssistantTask {
    return {
        ...task,
        questions: Array.isArray(task.questions) ? task.questions : [],
        sources: Array.isArray(task.sources) ? task.sources : [],
        events: Array.isArray(task.events) ? task.events : [],
        draft: cloneDraft(task.draft),
    };
}

function statusLabel(status?: string): string {
    return STATUS_LABELS[status || ""] || status || "待处理";
}

function statusClass(status?: string): string {
    if (["succeeded", "completed", "connected", "ready", "draft_ready", "sent"].includes(status || "")) return styles.statusSuccess;
    if (["failed", "error", "disconnected", "delivery_unknown", "send_failed"].includes(status || "")) return styles.statusDanger;
    if (["running", "analyzing", "syncing", "pending", "waiting_for_input", "send_queued", "sending", "budget_paused", "partial", "run_queued"].includes(status || "")) return styles.statusActive;
    return styles.statusQuiet;
}

function isTerminalTaskStatus(status?: string): boolean {
    return ["succeeded", "completed", "failed", "cancelled", "sent", "ignored", "send_failed", "delivery_unknown"].includes(status || "");
}

function isMailQueryTask(task?: AssistantTask | null): boolean {
    return task?.kind === "mail_query" || Boolean(task?.mail_query || task?.report_meta) || typeof task?.report === "string" || typeof task?.report_markdown === "string";
}

function mailQueryResult(task: AssistantTask): AssistantMailQueryResult | null {
    return task.mail_query || task.report_meta || null;
}

function mailQueryTitle(task: AssistantTask): string {
    return task.query || task.subject || "邮件查询报告";
}

function formatBeijingDate(value?: string | null): string {
    if (!value) return "未提供";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

function formatMailQueryRange(result?: AssistantMailQueryResult | null): string {
    if (!result) return "时间范围未提供";
    if (!result.range_start && !result.range_end) return "时间范围未提供";
    return `${formatBeijingDate(result.range_start)} 至 ${formatBeijingDate(result.range_end)}（北京时间）`;
}

function mailSyncStatusLabel(sync: AssistantMailQuerySync): string {
    const status = (sync.status || "").toLowerCase();
    if (sync.has_more || ["syncing", "pending", "waiting", "running"].includes(status)) return "未完成";
    if (status === "error" || status === "failed") return "同步异常";
    const completedAt = sync.completed_at || sync.last_sync_at;
    return completedAt ? `最近同步 ${formatBeijingDate(completedAt)}` : "未同步";
}

function mailRecipients(value: string | string[] | undefined): string {
    if (Array.isArray(value)) return value.filter(Boolean).join("、") || "未提供";
    return value || "未提供";
}

function mailContentWarning(value?: {content_status?: string; content_warning?: string} | null): string | null {
    if (!value) return null;
    return value.content_warning
        || (value.content_status === "metadata_only" ? "邮件正文和附件未导入，仅同步基本信息" : null);
}

function mailQueryReportText(task: AssistantTask): string {
    return task.report_markdown || task.report || "";
}

function linkifyMailSourceCitations(markdown: string): string {
    return markdown.replace(/\[(M\d+)\](?!\()/g, "[$1](#assistant-mail-source-$1)");
}

function formatDate(value?: string | null): string {
    if (!value) return "尚未同步";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("zh-CN", {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"}).format(date);
}

function taskProgress(task: AssistantTask): number {
    if (["succeeded", "completed", "failed", "cancelled", "sent", "ignored", "send_failed", "delivery_unknown"].includes(task.status)) return 100;
    const progressEvent = [...task.events].reverse().find((event: AssistantEvent) => typeof event.progress === "number");
    if (progressEvent?.progress !== undefined) return Math.max(0, Math.min(100, progressEvent.progress));
    if (["send_queued", "sending"].includes(task.status)) return 92;
    if (task.status === "draft_ready") return 84;
    if (task.status === "waiting_for_input") return 67;
    if (task.status === "running") return 58;
    if (task.status === "analyzing") return 44;
    if (task.status === "budget_paused") return 27;
    return 16;
}

function providerLabel(provider: string): string {
    return PROVIDERS.find(item => item.value === provider)?.label || provider || "邮箱";
}

function parseRecipients(value: string): string[] {
    return value.split(/[\n,;，；]+/).map(item => item.trim()).filter(Boolean);
}

function attachmentKey(attachment: Pick<AssistantDraftAttachment, "path" | "content_hash">): string {
    return `${attachment.path}\u0000${attachment.content_hash}`;
}

function isAttachableKnowledgeDocument(document: AssistantKnowledgeDocument): boolean {
    const path = document.path.toLowerCase();
    return path.endsWith(".md") || path.endsWith(".txt");
}

function shortHash(value: string): string {
    return value ? value.slice(0, 8) : "未知 hash";
}

const KNOWLEDGE_STATUS_LABELS: Record<AssistantKnowledgeDocument["index_status"], string> = {
    queued: "等待索引",
    indexing: "索引中",
    ready: "可检索",
    failed: "索引失败",
};

function knowledgeStatusLabel(status: AssistantKnowledgeDocument["index_status"]): string {
    return KNOWLEDGE_STATUS_LABELS[status] || "等待索引";
}

function knowledgeStatusClass(status: AssistantKnowledgeDocument["index_status"]): string {
    if (status === "ready") return styles.statusSuccess;
    if (status === "failed") return styles.statusDanger;
    if (status === "indexing") return styles.statusActive;
    return styles.statusQuiet;
}

function draftFromResponse(value: unknown): AssistantDraft | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as {draft?: unknown; task?: {draft?: unknown}; version?: unknown; hash?: unknown; to?: unknown; subject?: unknown; body?: unknown};
    const raw = candidate.draft || candidate.task?.draft || value;
    if (!raw || typeof raw !== "object") return null;
    const draft = raw as {version?: unknown; hash?: unknown; to?: unknown; cc?: unknown; subject?: unknown; body?: unknown; attachments?: unknown};
    if (typeof draft.version !== "number" || typeof draft.hash !== "string" || typeof draft.subject !== "string" || typeof draft.body !== "string") return null;
    const attachments = Array.isArray(draft.attachments)
        ? draft.attachments
            .filter((attachment): attachment is {path: string; content_hash: string; name?: string; content_type?: string} => Boolean(
                attachment
                && typeof attachment === "object"
                && typeof (attachment as {path?: unknown}).path === "string"
                && typeof (attachment as {content_hash?: unknown}).content_hash === "string",
            ))
            .map(attachment => ({
                path: attachment.path,
                content_hash: attachment.content_hash,
                ...(typeof attachment.name === "string" ? {name: attachment.name} : {}),
                ...(typeof attachment.content_type === "string" ? {content_type: attachment.content_type} : {}),
            }))
        : [];
    return {
        version: draft.version,
        hash: draft.hash,
        to: Array.isArray(draft.to) ? draft.to.filter((item): item is string => typeof item === "string") : [],
        cc: Array.isArray(draft.cc) ? draft.cc.filter((item): item is string => typeof item === "string") : [],
        subject: draft.subject,
        body: draft.body,
        attachments,
    };
}

function taskFromResponse(value: unknown): AssistantTask | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as {task?: unknown; id?: unknown; status?: unknown};
    const raw = candidate.task || value;
    if (!raw || typeof raw !== "object" || typeof (raw as {id?: unknown}).id !== "string" || typeof (raw as {status?: unknown}).status !== "string") return null;
    return normalizeTask(raw as AssistantTask);
}

async function fileToBase64(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return window.btoa(binary);
}

function errorMessage(error: unknown): string {
    if (error instanceof AssistantApiError) return error.detail;
    if (error instanceof Error) return error.message;
    return "请求失败，请稍后重试";
}

function isAbortError(error: unknown): boolean {
    return (error instanceof DOMException && error.name === "AbortError")
        || (error instanceof Error && error.name === "AbortError");
}

export function Assistant() {
    const {id: routeTaskId} = useParams<{id?: string}>();
    const navigate = useNavigate();
    const token = useAccessStore(state => state.token);
    const username = useAccessStore(state => state.username);
    const accountKey = `${username}:${token}`;
    const [activeTab, setActiveTab] = useState<AssistantTab>("tasks");
    const [overview, setOverview] = useState<AssistantOverview | null>(null);
    const [detailTask, setDetailTask] = useState<AssistantTask | null>(null);
    const [selectedTaskId, setSelectedTaskId] = useState(routeTaskId || "");
    const [localDrafts, setLocalDrafts] = useState<Record<string, LocalDraftState>>({});
    const localDraftsRef = useRef<Record<string, LocalDraftState>>({});
    const overviewSequence = useRef(0);
    const detailLoadedRef = useRef("");
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [pageError, setPageError] = useState("");
    const [notice, setNotice] = useState("");
    const [actionBusy, setActionBusy] = useState("");
    const [answer, setAnswer] = useState("");
    const [answerQuestion, setAnswerQuestion] = useState("");
    const [reviewOpen, setReviewOpen] = useState(false);
    const [viewer, setViewer] = useState<ViewerState | null>(null);
    const [mailSourceViewer, setMailSourceViewer] = useState<MailSourceViewerState | null>(null);
    const [knowledgeDocuments, setKnowledgeDocuments] = useState<AssistantKnowledgeDocument[]>([]);
    const sourceControllerRef = useRef<AbortController | null>(null);
    const mailSourceControllerRef = useRef<AbortController | null>(null);
    const mailSourceGenerationRef = useRef(0);

    useEffect(() => {
        sourceControllerRef.current?.abort();
        mailSourceControllerRef.current?.abort();
        mailSourceGenerationRef.current += 1;
        setMailSourceViewer(null);
        return () => {
            sourceControllerRef.current?.abort();
            mailSourceControllerRef.current?.abort();
        };
    }, [accountKey]);

    useEffect(() => {
        sourceControllerRef.current?.abort();
        mailSourceControllerRef.current?.abort();
        mailSourceGenerationRef.current += 1;
        setMailSourceViewer(null);
    }, [selectedTaskId]);

    useEffect(() => {
        const controller = new AbortController();
        setKnowledgeDocuments([]);
        getAssistantKnowledge(controller.signal).then(result => {
            if (!controller.signal.aborted) setKnowledgeDocuments(Array.isArray(result.documents) ? result.documents : []);
        }).catch(error => {
            if (!controller.signal.aborted && !isAbortError(error)) setKnowledgeDocuments([]);
        });
        return () => controller.abort();
    }, [accountKey]);

    const updateLocalDrafts = useCallback((updater: (previous: Record<string, LocalDraftState>) => Record<string, LocalDraftState>) => {
        setLocalDrafts(previous => {
            const next = updater(previous);
            localDraftsRef.current = next;
            return next;
        });
    }, []);

    const hydrateDraft = useCallback((task: AssistantTask) => {
        updateLocalDrafts(previous => {
            if (previous[task.id]?.dirty) return previous;
            return {...previous, [task.id]: {draft: cloneDraft(task.draft), dirty: false}};
        });
    }, [updateLocalDrafts]);

    const applyTask = useCallback((incoming: AssistantTask) => {
        const task = normalizeTask(incoming);
        const local = localDraftsRef.current[task.id];
        setDetailTask(local?.dirty && local.draft ? {...task, draft: cloneDraft(local.draft)} : task);
        if (!local?.dirty) hydrateDraft(task);
    }, [hydrateDraft]);

    const mergeOverview = useCallback((incoming: AssistantOverview) => {
        const tasks = Array.isArray(incoming.tasks) ? incoming.tasks.map(normalizeTask) : [];
        setOverview({...incoming, tasks});
        updateLocalDrafts(previous => {
            const next = {...previous};
            tasks.forEach(task => {
                if (task.detail_loaded === false) return;
                if (!next[task.id]?.dirty) next[task.id] = {draft: cloneDraft(task.draft), dirty: false};
            });
            return next;
        });
    }, [updateLocalDrafts]);

    const refreshOverview = useCallback(async (signal: AbortSignal, initial = false) => {
        const sequence = overviewSequence.current + 1;
        overviewSequence.current = sequence;
        if (initial) setLoading(true);
        try {
            const result = await getAssistantOverview(signal);
            if (signal.aborted || sequence !== overviewSequence.current) return;
            mergeOverview(result);
            setPageError("");
        } catch (error) {
            if (!signal.aborted && !isAbortError(error) && sequence === overviewSequence.current) setPageError(errorMessage(error));
        } finally {
            if (initial && !signal.aborted) setLoading(false);
        }
    }, [mergeOverview]);

    useEffect(() => {
        const controller = new AbortController();
        localDraftsRef.current = {};
        setLocalDrafts({});
        setOverview(null);
        setDetailTask(null);
        setSelectedTaskId("");
        setPageError("");
        setNotice("");
        setViewer(null);
        setReviewOpen(false);
        void refreshOverview(controller.signal, true);
        const timer = window.setInterval(() => void refreshOverview(controller.signal), 3000);
        return () => {
            controller.abort();
            window.clearInterval(timer);
        };
    }, [accountKey, refreshOverview]);

    useEffect(() => {
        setSelectedTaskId(routeTaskId || "");
    }, [accountKey, routeTaskId]);

    useEffect(() => {
        if (!routeTaskId && !selectedTaskId && overview?.tasks[0]) setSelectedTaskId(overview.tasks[0].id);
    }, [overview?.tasks, routeTaskId, selectedTaskId]);

    const shouldPollSelectedTask = Boolean(selectedTaskId)
        && (!detailTask || detailTask.id !== selectedTaskId || !isTerminalTaskStatus(detailTask.status));

    useEffect(() => {
        if (!selectedTaskId) {
            setDetailTask(null);
            detailLoadedRef.current = "";
            setDetailLoading(false);
            return;
        }
        const controller = new AbortController();
        const detailKey = `${accountKey}:${selectedTaskId}`;
        const needsInitialLoading = detailLoadedRef.current !== detailKey;
        let sequence = 0;
        if (needsInitialLoading) setDetailLoading(true);
        const load = async () => {
            const currentSequence = sequence + 1;
            sequence = currentSequence;
            try {
                const result = await getAssistantTask(selectedTaskId, controller.signal);
                if (!controller.signal.aborted && currentSequence === sequence) {
                    detailLoadedRef.current = detailKey;
                    applyTask(result);
                    setPageError("");
                    setDetailLoading(false);
                }
            } catch (error) {
                if (!controller.signal.aborted && !isAbortError(error)) {
                    if (needsInitialLoading && currentSequence === sequence) setDetailLoading(false);
                    setPageError(errorMessage(error));
                }
            } finally {
                if (!controller.signal.aborted && needsInitialLoading && currentSequence === sequence && detailLoadedRef.current !== detailKey) setDetailLoading(false);
            }
        };
        void load();
        const timer = shouldPollSelectedTask ? window.setInterval(() => void load(), 3000) : null;
        return () => {
            controller.abort();
            if (timer !== null) window.clearInterval(timer);
        };
    }, [accountKey, applyTask, selectedTaskId, shouldPollSelectedTask]);

    const tasks = overview?.tasks || [];
    const pendingTaskCount = tasks.filter(isPendingTask).length;
    const activeTask = detailTask?.id === selectedTaskId
        ? detailTask
        : tasks.find(task => task.id === selectedTaskId && task.detail_loaded !== false) || null;
    const activeLocalDraft = selectedTaskId ? localDrafts[selectedTaskId] : undefined;
    const activeDraft = activeLocalDraft?.draft || activeTask?.draft || null;

    function selectTask(taskId: string) {
        setSelectedTaskId(taskId);
        navigate(`/assistant/${encodeURIComponent(taskId)}`);
    }

    function setTab(tab: AssistantTab) {
        setActiveTab(tab);
        setNotice("");
    }

    async function handleCreateManualTask(content: string, model: string) {
        const trimmedContent = content.trim();
        if (!trimmedContent || !model || actionBusy) return;
        setActionBusy("create-manual-task");
        setPageError("");
        try {
            const task = normalizeTask(await createAssistantTask(trimmedContent, model));
            setOverview(previous => previous ? {...previous, tasks: [task, ...previous.tasks.filter(item => item.id !== task.id)]} : previous);
            hydrateDraft(task);
            selectTask(task.id);
            setNotice("邮件查询已提交，正在同步邮箱并排队处理；结果不保证立即完成");
        } catch (error) {
            setPageError(errorMessage(error));
        } finally {
            setActionBusy("");
        }
    }

    async function handleAnswer(event: FormEvent) {
        event.preventDefault();
        if (!selectedTaskId || !answer.trim()) return;
        setActionBusy("answer");
        try {
            const updated = await answerAssistantTask(selectedTaskId, answer.trim());
            applyTask(updated);
            setAnswer("");
            setAnswerQuestion("");
            setNotice("补充信息已提交");
        } catch (error) {
            setPageError(errorMessage(error));
        } finally {
            setActionBusy("");
        }
    }

    function updateDraftField(field: "to" | "cc" | "subject" | "body", value: string) {
        if (!selectedTaskId || !activeDraft) return;
        const nextDraft = {...activeDraft, [field]: field === "to" || field === "cc" ? parseRecipients(value) : value};
        updateLocalDrafts(previous => ({
            ...previous,
            [selectedTaskId]: {draft: nextDraft, dirty: true},
        }));
        setDetailTask(previous => previous && previous.id === selectedTaskId ? {...previous, draft: nextDraft} : previous);
    }

    function updateDraftAttachments(attachments: AssistantDraftAttachment[]) {
        if (!selectedTaskId || !activeDraft) return;
        const nextDraft = {
            ...activeDraft,
            attachments: attachments.map(attachment => ({...attachment})),
        };
        updateLocalDrafts(previous => ({
            ...previous,
            [selectedTaskId]: {draft: nextDraft, dirty: true},
        }));
        setDetailTask(previous => previous && previous.id === selectedTaskId ? {...previous, draft: nextDraft} : previous);
    }

    async function handleSaveDraft() {
        if (!selectedTaskId || !activeDraft) return;
        const draft = cloneDraft(activeDraft);
        if (!draft) return;
        setActionBusy("save-draft");
        setPageError("");
        try {
            const result = await updateAssistantDraft(selectedTaskId, {
                version: draft.version,
                to: draft.to,
                cc: draft.cc,
                subject: draft.subject,
                body: draft.body,
                attachments: draft.attachments,
            });
            const savedTask = taskFromResponse(result);
            const savedDraft = draftFromResponse(result) || draft;
            if (savedTask) {
                const savedServerDraft = cloneDraft(savedTask.draft) || savedDraft;
                updateLocalDrafts(previous => ({...previous, [selectedTaskId]: {draft: savedServerDraft, dirty: false}}));
                setDetailTask({...savedTask, draft: savedServerDraft});
            } else {
                updateLocalDrafts(previous => ({...previous, [selectedTaskId]: {draft: savedDraft, dirty: false}}));
                setDetailTask(previous => previous && previous.id === selectedTaskId ? {...previous, draft: savedDraft} : previous);
            }
            setNotice("草稿已保存，可打开最终版本检查");
        } catch (error) {
            if (error instanceof AssistantApiError && error.status === 409) {
                const conflict = error.detail;
                updateLocalDrafts(previous => ({...previous, [selectedTaskId]: {...previous[selectedTaskId], draft, dirty: true, conflict}}));
                setNotice("服务器版本已变化，本地编辑仍保留");
            } else setPageError(errorMessage(error));
        } finally {
            setActionBusy("");
        }
    }

    async function reloadServerDraft() {
        if (!selectedTaskId) return;
        setActionBusy("reload-draft");
        try {
            const result = await getAssistantTask(selectedTaskId);
            const serverTask = normalizeTask(result);
            updateLocalDrafts(previous => ({...previous, [selectedTaskId]: {draft: cloneDraft(serverTask.draft), dirty: false}}));
            setDetailTask(serverTask);
            setNotice("已加载服务器版本，本地编辑已放弃");
        } catch (error) {
            setPageError(errorMessage(error));
        } finally {
            setActionBusy("");
        }
    }

    async function handleSend() {
        if (!selectedTaskId || !activeDraft || activeLocalDraft?.dirty) return;
        if (activeTask?.status !== "draft_ready") {
            setNotice("只有草稿待确认状态可以提交发送");
            return;
        }
        setActionBusy("send");
        try {
            const updated = await sendAssistantTask(selectedTaskId, {version: activeDraft.version, hash: activeDraft.hash});
            applyTask(updated);
            setReviewOpen(false);
            setNotice("已提交发送请求，请留意发送状态");
        } catch (error) {
            if (error instanceof AssistantApiError && error.status === 409) setNotice("发送版本已失效，本地草稿保留");
            else setPageError(errorMessage(error));
        } finally {
            setActionBusy("");
        }
    }

    async function handleRetry() {
        if (!selectedTaskId) return;
        setActionBusy("retry");
        try {
            const updated = await retryAssistantTask(selectedTaskId);
            applyTask(updated);
            setNotice("任务已重新排队");
        } catch (error) {
            setPageError(errorMessage(error));
        } finally {
            setActionBusy("");
        }
    }

    async function handleArchiveAttachment(attachmentIndex: number) {
        if (!selectedTaskId) return;
        setActionBusy(`archive-attachment-${attachmentIndex}`);
        try {
            const result = await archiveAssistantAttachment(selectedTaskId, attachmentIndex);
            const updated = taskFromResponse(result);
            if (updated) applyTask(updated);
            else applyTask(await getAssistantTask(selectedTaskId));
            setNotice("附件已归档到知识库");
        } catch (error) {
            setPageError(errorMessage(error));
        } finally {
            setActionBusy("");
        }
    }

    async function openSource(source: AssistantSource) {
        sourceControllerRef.current?.abort();
        const controller = new AbortController();
        sourceControllerRef.current = controller;
        setViewer({source, content: "", loading: true});
        try {
            const result = await getAssistantKnowledgeFile(source.path, source.content_hash, controller.signal);
            if (!controller.signal.aborted) setViewer(previous => previous ? {...previous, content: result.content, loading: false} : previous);
        } catch (error) {
            if (!controller.signal.aborted && !isAbortError(error)) setViewer(previous => previous ? {...previous, loading: false, error: errorMessage(error)} : previous);
        }
    }

    async function openMailSource(taskId: string, source: AssistantMailQuerySource) {
        mailSourceControllerRef.current?.abort();
        const generation = mailSourceGenerationRef.current + 1;
        mailSourceGenerationRef.current = generation;
        const controller = new AbortController();
        mailSourceControllerRef.current = controller;
        setMailSourceViewer({source, loading: true});
        try {
            const result = await getAssistantMailSource(taskId, source.mail_id, controller.signal);
            if (!controller.signal.aborted && generation === mailSourceGenerationRef.current && selectedTaskId === taskId) {
                setMailSourceViewer({source: {...source, ...result}, loading: false});
            }
        } catch (error) {
            if (!controller.signal.aborted && generation === mailSourceGenerationRef.current && selectedTaskId === taskId && !isAbortError(error)) {
                setMailSourceViewer(previous => previous ? {...previous, loading: false, error: errorMessage(error)} : previous);
            }
        } finally {
            if (mailSourceControllerRef.current === controller) mailSourceControllerRef.current = null;
        }
    }

    const overviewError = pageError ? <div className={styles.errorBanner} role="alert"><WarningOutlined/><span>{pageError}</span><button type="button" onClick={() => window.location.reload()}><ReloadOutlined/>重新加载</button></div> : null;

    return <div className={styles.assistant}>
        <section className={styles.hero}>
            <div className={styles.heroCopy}>
                <h1>个人助理</h1>
                <p>整理邮件、引用知识库，发送前由你确认。</p>
            </div>
            <div className={styles.heroStats}>
                <div><strong>{pendingTaskCount}</strong><span>待处理任务</span></div>
                <div><strong>{overview?.connections.filter(connection => ["connected", "ready", "syncing"].includes(connection.status)).length || 0}</strong><span>个已连接邮箱</span></div>
                <div><strong>{overview?.settings ? `¥${Number(overview.settings.used || 0).toFixed(2)}` : "—"}</strong><span>本月已用</span></div>
            </div>
        </section>

        <nav className={styles.tabs} aria-label="助理设置">
            <button type="button" className={activeTab === "tasks" ? styles.tabActive : ""} onClick={() => setTab("tasks")}><InboxOutlined/>任务中心<span>{pendingTaskCount}</span></button>
            <button type="button" className={activeTab === "knowledge" ? styles.tabActive : ""} onClick={() => setTab("knowledge")}><BookOutlined/>知识与规则</button>
            <button type="button" className={activeTab === "connections" ? styles.tabActive : ""} onClick={() => setTab("connections")}><SettingOutlined/>连接与设置</button>
        </nav>

        {overviewError}
        {notice && <div className={styles.noticeBanner}><CheckCircleFilled/><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice("")}><CloseOutlined/></button></div>}

        {activeTab === "tasks" && <TasksPanel
            accountKey={accountKey}
            loading={loading}
            tasks={tasks}
            selectedTaskId={selectedTaskId}
            activeTask={activeTask}
            detailLoading={detailLoading}
            activeDraft={activeDraft}
            knowledgeDocuments={knowledgeDocuments}
            localDraft={activeLocalDraft}
            actionBusy={actionBusy}
            onCreateManual={handleCreateManualTask}
            onSelect={selectTask}
            answer={answer}
            setAnswer={setAnswer}
            answerQuestion={answerQuestion}
            setAnswerQuestion={setAnswerQuestion}
            onAnswer={handleAnswer}
            onDraftField={updateDraftField}
            onDraftAttachments={updateDraftAttachments}
            onSaveDraft={handleSaveDraft}
            onReloadDraft={reloadServerDraft}
            onOpenReview={() => setReviewOpen(true)}
            onSend={handleSend}
            reviewOpen={reviewOpen}
            onCloseReview={() => setReviewOpen(false)}
            onRetry={handleRetry}
            onOpenSource={openSource}
            onOpenMailSource={openMailSource}
            onArchiveAttachment={handleArchiveAttachment}
        />}
        {activeTab === "knowledge" && <KnowledgePanel accountKey={accountKey} onOpenSource={openSource} onError={setPageError} onNotice={setNotice} />}
        {activeTab === "connections" && <ConnectionsPanel accountKey={accountKey} overview={overview} onRefresh={() => {
            const controller = new AbortController();
            void refreshOverview(controller.signal);
            window.setTimeout(() => controller.abort(), 15000);
        }} onError={setPageError} onNotice={setNotice} actionBusy={actionBusy} setActionBusy={setActionBusy} />}

        {viewer && <SourceViewer viewer={viewer} onClose={() => setViewer(null)} />}
        {mailSourceViewer && <MailSourceViewer viewer={mailSourceViewer} onClose={() => setMailSourceViewer(null)} />}
    </div>;
}

interface TasksPanelProps {
    accountKey: string;
    loading: boolean;
    tasks: AssistantTask[];
    selectedTaskId: string;
    activeTask: AssistantTask | null;
    detailLoading: boolean;
    activeDraft: AssistantDraft | null;
    knowledgeDocuments: AssistantKnowledgeDocument[];
    localDraft?: LocalDraftState;
    actionBusy: string;
    onCreateManual: (content: string, model: string) => Promise<void>;
    onSelect: (taskId: string) => void;
    answer: string;
    setAnswer: (value: string) => void;
    answerQuestion: string;
    setAnswerQuestion: (value: string) => void;
    onAnswer: (event: FormEvent) => void;
    onDraftField: (field: "to" | "cc" | "subject" | "body", value: string) => void;
    onDraftAttachments: (attachments: AssistantDraftAttachment[]) => void;
    onSaveDraft: () => void;
    onReloadDraft: () => void;
    onOpenReview: () => void;
    onSend: () => void;
    reviewOpen: boolean;
    onCloseReview: () => void;
    onRetry: () => void;
    onOpenSource: (source: AssistantSource) => void;
    onOpenMailSource: (taskId: string, source: AssistantMailQuerySource) => void;
    onArchiveAttachment: (attachmentIndex: number) => void;
}

function TasksPanel(props: TasksPanelProps) {
    const {
        accountKey, loading, tasks, selectedTaskId, activeTask, detailLoading, activeDraft, knowledgeDocuments, localDraft,
        actionBusy, onCreateManual, onSelect, answer, setAnswer, answerQuestion, setAnswerQuestion, onAnswer, onDraftField, onDraftAttachments,
        onSaveDraft, onReloadDraft, onOpenReview, onSend, reviewOpen, onCloseReview, onRetry, onOpenSource,
        onOpenMailSource, onArchiveAttachment,
    } = props;
    const toValue = activeDraft?.to.join("\n") || "";
    const ccValue = activeDraft?.cc.join("\n") || "";
    const [taskPage, setTaskPage] = useState(1);
    const pagedSelection = useRef("");
    const taskPageSize = 5;
    const taskPageCount = Math.max(1, Math.ceil(tasks.length / taskPageSize));
    const currentTaskPage = Math.min(taskPage, taskPageCount);
    const visibleTasks = tasks.slice((currentTaskPage - 1) * taskPageSize, currentTaskPage * taskPageSize);

    useEffect(() => {
        pagedSelection.current = "";
        setTaskPage(1);
    }, [accountKey]);

    useEffect(() => {
        // Follow a newly selected task, but preserve manual paging during polling.
        if (!selectedTaskId || pagedSelection.current === selectedTaskId) return;
        const selectedIndex = tasks.findIndex(task => task.id === selectedTaskId);
        if (selectedIndex < 0) return;
        pagedSelection.current = selectedTaskId;
        setTaskPage(Math.floor(selectedIndex / taskPageSize) + 1);
    }, [accountKey, selectedTaskId, tasks]);

    useEffect(() => {
        setTaskPage(page => Math.min(page, taskPageCount));
    }, [taskPageCount]);

    return <section className={styles.taskArea}>
        <div className={styles.taskRail}>
            <ManualMailQueryComposer accountKey={accountKey} busy={Boolean(actionBusy)} onSubmit={onCreateManual} />
            <div className={styles.railHeading}><span>收件箱任务</span><span>{tasks.length}</span></div>
            {tasks.length > taskPageSize && <nav className={styles.taskPagination} aria-label="收件箱任务分页">
                <button type="button" aria-label="任务上一页" disabled={currentTaskPage === 1} onClick={() => setTaskPage(currentTaskPage - 1)}>上一页</button>
                {Array.from({length: taskPageCount}, (_, index) => index + 1).map(page => <button
                    type="button" key={page} aria-label={`任务第 ${page} 页`} aria-current={page === currentTaskPage ? "page" : undefined}
                    onClick={() => setTaskPage(page)}>{page}</button>)}
                <button type="button" aria-label="任务下一页" disabled={currentTaskPage === taskPageCount} onClick={() => setTaskPage(currentTaskPage + 1)}>下一页</button>
                <span aria-live="polite">每页 {taskPageSize} 条 · 第 {currentTaskPage} / {taskPageCount} 页</span>
            </nav>}
            {loading && <div className={styles.loadingRows}><span /><span /><span /></div>}
            {!loading && tasks.length === 0 && <div className={styles.emptyRail}><InboxOutlined/><strong>还没有任务</strong><p>连接邮箱后，助理会在这里整理任务；你也可以从上方手动创建。</p></div>}
            <div className={styles.taskList} role="group" aria-label="收件箱任务列表">
                {visibleTasks.map(task => <button type="button" key={task.id} className={`${styles.taskItem} ${task.id === selectedTaskId ? styles.taskItemActive : ""}`} onClick={() => onSelect(task.id)}>
                    <span className={styles.taskItemTop}><span className={`${styles.statusDot} ${statusClass(task.status)}`} />{statusLabel(task.status)}<time>{formatDate(task.updated_at || task.created_at)}</time></span>
                    <strong>{isMailQueryTask(task) ? mailQueryTitle(task) : task.subject || "未命名邮件任务"}</strong>
                    <span className={styles.taskSender}>{isMailQueryTask(task) ? "手动邮件查询" : task.from_address || "手动创建"}</span>
                    <span className={styles.taskSummary}>{task.summary || "助理正在读取任务内容"}</span>
                    <span className={styles.progressTrack}><i style={{width: `${taskProgress(task)}%`}} /></span>
                </button>)}
            </div>
        </div>
        <div className={styles.detailPane}>
            {detailLoading && <div className={styles.detailLoading}><LoadingOutlined spin/>正在读取任务详情</div>}
            {!activeTask && !detailLoading && <div className={styles.detailEmpty}><div className={styles.emptyIllustration}><MailOutlined/></div><h2>选择一个任务开始</h2><p>这里会显示邮件原文、知识来源和待确认的草稿。发送动作始终需要你的最后确认。</p></div>}
            {activeTask && <TaskDetail
                task={activeTask}
                activeDraft={activeDraft}
                knowledgeDocuments={knowledgeDocuments}
                localDraft={localDraft}
                actionBusy={actionBusy}
                toValue={toValue}
                ccValue={ccValue}
                answer={answer}
                setAnswer={setAnswer}
                answerQuestion={answerQuestion}
                setAnswerQuestion={setAnswerQuestion}
                onAnswer={onAnswer}
                onDraftField={onDraftField}
                onDraftAttachments={onDraftAttachments}
                onSaveDraft={onSaveDraft}
                onReloadDraft={onReloadDraft}
                onOpenReview={onOpenReview}
                onSend={onSend}
                reviewOpen={reviewOpen}
                onCloseReview={onCloseReview}
                onRetry={onRetry}
                onOpenSource={onOpenSource}
                onOpenMailSource={onOpenMailSource}
                onArchiveAttachment={onArchiveAttachment}
            />}
        </div>
    </section>;
}

interface ManualMailQueryComposerProps {
    accountKey: string;
    busy: boolean;
    onSubmit: (content: string, model: string) => Promise<void>;
}

function ManualMailQueryComposer({accountKey, busy, onSubmit}: ManualMailQueryComposerProps) {
    const [content, setContent] = useState("");
    const [models, setModels] = useState<ChatModelOption[]>([]);
    const [selectedModel, setSelectedModel] = useState("");
    const [modelLoading, setModelLoading] = useState(true);
    const [modelError, setModelError] = useState("");
    const controllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        setModels([]);
        setSelectedModel("");
        setModelLoading(true);
        setModelError("");
        getModelCatalog(controller.signal).then(result => {
            if (controller.signal.aborted) return;
            setModels(result);
            setSelectedModel(previous => previous && result.some(model => model.id === previous)
                ? previous
                : result.find(model => model.id === "deepseek-flash")?.id || result[0]?.id || "");
        }).catch(error => {
            if (!controller.signal.aborted && !isAbortError(error)) setModelError(errorMessage(error));
        }).finally(() => {
            if (!controller.signal.aborted) setModelLoading(false);
        });
        return () => {
            controller.abort();
            if (controllerRef.current === controller) controllerRef.current = null;
        };
    }, [accountKey]);

    async function submit(event: FormEvent) {
        event.preventDefault();
        const trimmed = content.trim();
        if (!trimmed || !selectedModel || modelLoading || modelError || busy) return;
        await onSubmit(trimmed, selectedModel);
        setContent("");
    }

    const canSubmit = Boolean(content.trim() && selectedModel && models.length > 0 && !modelLoading && !modelError && !busy);
    return <form className={styles.manualTask} onSubmit={submit}>
        <div className={styles.manualTaskHeading}><div><span className={styles.manualTaskLabel}><SearchOutlined/>手动查询邮件</span><p>用自然语言生成邮件报告，不会生成或发送回复草稿。</p></div><span className={styles.manualTaskPrice}>按次计费 · 上限 ¥0.25</span></div>
        <textarea value={content} onChange={event => setContent(event.target.value)} placeholder="例如：总结本周收到的邮件，列出待办和截止时间" rows={3} disabled={busy} />
        <div className={styles.manualTaskControls}>
            <label className={styles.manualModelField}><span>本次模型</span>{modelLoading ? <span className={styles.selectLoading}><LoadingOutlined spin/>读取模型目录</span> : models.length > 0 ? <select value={selectedModel} onChange={event => setSelectedModel(event.target.value)} disabled={busy}>{models.map(model => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select> : <span className={styles.inlineHint}>模型目录暂不可用</span>}</label>
            <button type="submit" className={styles.secondaryButton} disabled={!canSubmit}>{busy ? <LoadingOutlined spin/> : <ArrowRightOutlined/>}生成报告</button>
        </div>
        <small className={styles.manualTaskHint}>手动查询独立于后台自动处理开关和月度预算，提交后会先同步邮箱；结果可能需要等待。</small>
        {modelError && <small className={styles.manualTaskError} role="alert">{modelError}。模型目录有效后才能提交。</small>}
    </form>;
}

function handleDetailTabKeyDown<T extends string>(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    tabs: readonly T[],
    activeTab: T,
    onChange: (tab: T) => void,
    tabIdPrefix: string,
) {
    const currentIndex = tabs.indexOf(activeTab);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    onChange(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`${tabIdPrefix}-tab-${nextTab}`)?.focus());
}

interface SourcePagerProps {
    page: number;
    pageCount: number;
    total: number;
    label: string;
    onPageChange: (page: number) => void;
}

function SourcePager({page, pageCount, total, label, onPageChange}: SourcePagerProps) {
    if (total === 0) return null;
    return <nav className={styles.sourcePager} aria-label={`${label}分页`}>
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>上一页</button>
        <span aria-live="polite">第 <strong>{page}</strong> / {pageCount} 页 · 共 {total} 条</span>
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}>下一页</button>
    </nav>;
}

interface TaskDetailProps {
    task: AssistantTask;
    activeDraft: AssistantDraft | null;
    knowledgeDocuments: AssistantKnowledgeDocument[];
    localDraft?: LocalDraftState;
    actionBusy: string;
    toValue: string;
    ccValue: string;
    answer: string;
    setAnswer: (value: string) => void;
    answerQuestion: string;
    setAnswerQuestion: (value: string) => void;
    onAnswer: (event: FormEvent) => void;
    onDraftField: (field: "to" | "cc" | "subject" | "body", value: string) => void;
    onDraftAttachments: (attachments: AssistantDraftAttachment[]) => void;
    onSaveDraft: () => void;
    onReloadDraft: () => void;
    onOpenReview: () => void;
    onSend: () => void;
    reviewOpen: boolean;
    onCloseReview: () => void;
    onRetry: () => void;
    onOpenSource: (source: AssistantSource) => void;
    onOpenMailSource: (taskId: string, source: AssistantMailQuerySource) => void;
    onArchiveAttachment: (attachmentIndex: number) => void;
}

function TaskDetail(props: TaskDetailProps) {
    const {
        task, activeDraft, knowledgeDocuments, localDraft, actionBusy, toValue, ccValue, answer, setAnswer, answerQuestion, setAnswerQuestion,
        onAnswer, onDraftField, onDraftAttachments, onSaveDraft, onReloadDraft, onOpenReview, onSend, reviewOpen, onCloseReview, onRetry, onOpenSource,
        onOpenMailSource, onArchiveAttachment,
    } = props;
    const [contextOpen, setContextOpen] = useState(false);
    const automaticTabs = ["mail", "sources", "draft"] as const;
    type AutomaticTab = typeof automaticTabs[number];
    const [activeTab, setActiveTab] = useState<AutomaticTab>("mail");
    const [sourcePage, setSourcePage] = useState(1);
    const sourcePageCount = Math.max(1, Math.ceil(task.sources.length / 5));
    const visibleSources = task.sources.slice((sourcePage - 1) * 5, sourcePage * 5);
    useEffect(() => {
        setActiveTab("mail");
        setSourcePage(1);
    }, [task.id, task.run_id]);
    useEffect(() => {
        setSourcePage(page => Math.min(Math.max(page, 1), sourcePageCount));
    }, [sourcePageCount]);
    if (isMailQueryTask(task)) {
        return <MailQueryTaskDetail task={task} actionBusy={actionBusy} onRetry={onRetry} onOpenMailSource={onOpenMailSource} contextOpen={contextOpen} onToggleContext={() => setContextOpen(value => !value)} onCloseContext={() => setContextOpen(false)} />;
    }
    const mailWarning = mailContentWarning(task.mail);
    const mailBody = task.mail?.body || (mailWarning ? "（正文未导入）" : "这是一项手动创建的任务，暂时没有邮件原文。");
    const attachmentList = task.mail?.attachments;
    const attachments = Array.isArray(attachmentList) ? attachmentList : [];
    const canConfirm = task.status === "draft_ready";
    const canEditDraft = task.status === "draft_ready" || task.status === "send_failed";
    const canRetry = ["failed", "budget_paused", "ignored"].includes(task.status);
    const attachableDocuments = knowledgeDocuments.filter(isAttachableKnowledgeDocument);
    const selectedDraftAttachments = activeDraft?.attachments || [];
    const attachableKeys = new Set(attachableDocuments.map(document => attachmentKey(document)));
    const preservedAttachments = selectedDraftAttachments.filter(attachment => !attachableKeys.has(attachmentKey(attachment)));

    function toggleKnowledgeAttachment(document: AssistantKnowledgeDocument, selected: boolean) {
        if (!activeDraft) return;
        const key = attachmentKey(document);
        const current = activeDraft.attachments || [];
        if (selected) {
            if (current.some(attachment => attachmentKey(attachment) === key)) return;
            onDraftAttachments([...current, {path: document.path, content_hash: document.content_hash}]);
            return;
        }
        onDraftAttachments(current.filter(attachment => attachmentKey(attachment) !== key));
    }

    function removeDraftAttachment(attachment: AssistantDraftAttachment) {
        if (!activeDraft) return;
        onDraftAttachments((activeDraft.attachments || []).filter(item => attachmentKey(item) !== attachmentKey(attachment)));
    }

    return <div className={styles.taskDetail}>
        <header className={styles.detailHeader}>
            <div><div className={styles.detailKicker}><span className={`${styles.statusPill} ${statusClass(task.status)}`}>{statusLabel(task.status)}</span>{task.run_id && <span>运行 {task.run_id.slice(0, 8)}</span>}</div><h2>{task.subject || "未命名邮件任务"}</h2><p>{task.from_address || "手动任务"} · 更新时间 {formatDate(task.updated_at)}</p></div>
            <div className={styles.detailActions}>{task.session_id && <button type="button" onClick={() => setContextOpen(value => !value)} aria-expanded={contextOpen}>上下文</button>}{canRetry && <button type="button" onClick={onRetry} disabled={actionBusy === "retry"}><ReloadOutlined/>重试</button>}<span className={styles.liveHint}><SyncOutlined spin={["running", "analyzing", "send_queued", "sending"].includes(task.status)}/>每 3 秒更新</span></div>
        </header>
        {contextOpen && task.session_id && <SessionContextPanel sessionId={task.session_id} onClose={() => setContextOpen(false)} />}
        {task.error && <div className={styles.taskError}><WarningOutlined/>{task.error}</div>}
        <div className={styles.detailTabs} role="tablist" aria-label="邮件任务详情">
            <button type="button" id={`automatic-task-${task.id}-tab-mail`} role="tab" aria-selected={activeTab === "mail"} aria-controls={`automatic-task-${task.id}-panel-mail`} tabIndex={activeTab === "mail" ? 0 : -1} className={activeTab === "mail" ? styles.detailTabActive : styles.detailTab} onClick={() => setActiveTab("mail")} onKeyDown={event => handleDetailTabKeyDown(event, automaticTabs, activeTab, setActiveTab, `automatic-task-${task.id}`)}>邮件</button>
            <button type="button" id={`automatic-task-${task.id}-tab-sources`} role="tab" aria-selected={activeTab === "sources"} aria-controls={`automatic-task-${task.id}-panel-sources`} tabIndex={activeTab === "sources" ? 0 : -1} className={activeTab === "sources" ? styles.detailTabActive : styles.detailTab} onClick={() => setActiveTab("sources")} onKeyDown={event => handleDetailTabKeyDown(event, automaticTabs, activeTab, setActiveTab, `automatic-task-${task.id}`)}>引用（{task.sources.length}）</button>
            <button type="button" id={`automatic-task-${task.id}-tab-draft`} role="tab" aria-selected={activeTab === "draft"} aria-controls={`automatic-task-${task.id}-panel-draft`} tabIndex={activeTab === "draft" ? 0 : -1} className={activeTab === "draft" ? styles.detailTabActive : styles.detailTab} onClick={() => setActiveTab("draft")} onKeyDown={event => handleDetailTabKeyDown(event, automaticTabs, activeTab, setActiveTab, `automatic-task-${task.id}`)}>草稿{task.questions.length > 0 && <span className={styles.detailTabBadge}>待补充</span>}</button>
        </div>
        {activeTab === "mail" && <div className={styles.detailTabPanel} id={`automatic-task-${task.id}-panel-mail`} role="tabpanel" aria-labelledby={`automatic-task-${task.id}-tab-mail`}>
            <article className={styles.mailCard}>
                <div className={styles.cardHeading}><span><MailOutlined/>邮件内容</span><span>{formatDate(task.created_at)}</span></div>
                {mailWarning && <div className={styles.inlineHint}><WarningOutlined/>{mailWarning}</div>}
                <div className={styles.mailBody}>{mailBody}</div>
                {attachments.length > 0 && <div className={styles.attachments}><div className={styles.attachmentsHeading}><span><FileTextOutlined/>来信附件</span><small>仅显示文件名与类型</small></div>{attachments.map((attachment, index) => <div className={styles.attachmentRow} key={`${attachment.name || "attachment"}-${index}`}><span className={styles.attachmentName}><FileTextOutlined/><span><strong>{attachment.name || `附件 ${index + 1}`}</strong><small>{attachment.content_type || "文件"}</small></span></span><button type="button" onClick={() => onArchiveAttachment(index)} disabled={actionBusy === `archive-attachment-${index}`}>{actionBusy === `archive-attachment-${index}` ? <LoadingOutlined spin/> : <BookOutlined/>}归档到知识库</button></div>)}</div>}
            </article>
        </div>}
        {activeTab === "sources" && <div className={styles.detailTabPanel} id={`automatic-task-${task.id}-panel-sources`} role="tabpanel" aria-labelledby={`automatic-task-${task.id}-tab-sources`}>
            <article className={styles.sourceCard}>
                <div className={styles.cardHeading}><span><BookOutlined/>引用来源</span><span>{task.sources.length} 条</span></div>
                {task.sources.length === 0 && <div className={styles.cardEmpty}>完成知识库配置后，助理会在这里列出引用文件。</div>}
                <div className={styles.sourceList}>{visibleSources.map((source, index) => <button type="button" key={`${source.path}-${index}`} onClick={() => onOpenSource(source)}><FileTextOutlined/><span><strong>{source.path}</strong><small>{source.line_start ? `第 ${source.line_start}–${source.line_end || source.line_start} 行` : source.text || "查看文件内容"}</small></span><ArrowRightOutlined/></button>)}</div>
                <SourcePager page={sourcePage} pageCount={sourcePageCount} total={task.sources.length} label="引用来源" onPageChange={setSourcePage} />
            </article>
        </div>}
        {activeTab === "draft" && <div className={styles.detailTabPanel} id={`automatic-task-${task.id}-panel-draft`} role="tabpanel" aria-labelledby={`automatic-task-${task.id}-tab-draft`}>
        {task.questions.length > 0 && <section className={styles.questionCard}>
            <div className={styles.cardHeading}><span><WarningOutlined/>需要你补充</span><span>回答后助理会继续处理</span></div>
            <div className={styles.questionList}>{task.questions.map(question => <button type="button" key={question} className={answerQuestion === question ? styles.questionActive : ""} onClick={() => setAnswerQuestion(question)}>{question}<ArrowRightOutlined/></button>)}</div>
            <form className={styles.answerForm} onSubmit={onAnswer}><textarea value={answer} onChange={event => setAnswer(event.target.value)} placeholder={answerQuestion || "选择一个问题，写下你的回答"} rows={2} /><button type="submit" disabled={!answer.trim() || actionBusy === "answer"}>{actionBusy === "answer" ? <LoadingOutlined spin/> : <ArrowRightOutlined/>}提交回答</button></form>
        </section>}
        <section className={styles.draftSection}>
            <div className={styles.draftHeading}><div><div className={styles.cardHeading}><span><SendOutlined/>回复草稿</span>{activeDraft && <span className={styles.versionTag}>版本 {activeDraft.version}</span>}</div><p>{activeDraft ? canEditDraft ? "你可以先修改，保存后再打开最终版本。" : "此版本已锁定，仅供核对。" : "助理还没有生成可发送草稿。"}</p></div>{localDraft?.dirty && <span className={styles.unsavedTag}>有未保存修改</span>}</div>
            {!activeDraft && <div className={styles.cardEmpty}>任务完成或补充信息后，回复草稿会出现在这里。</div>}
            {activeDraft && <>
                <label className={styles.field}><span>收件人</span><textarea value={toValue} onChange={event => onDraftField("to", event.target.value)} rows={2} placeholder="每行一个邮箱地址" disabled={!canEditDraft} /></label>
                <label className={styles.field}><span>抄送</span><textarea value={ccValue} onChange={event => onDraftField("cc", event.target.value)} rows={2} placeholder="可选，每行一个邮箱地址" disabled={!canEditDraft} /></label>
                <label className={styles.field}><span>主题</span><input value={activeDraft.subject} onChange={event => onDraftField("subject", event.target.value)} disabled={!canEditDraft} /></label>
                <label className={styles.field}><span>正文</span><textarea className={styles.bodyEditor} value={activeDraft.body} onChange={event => onDraftField("body", event.target.value)} rows={9} disabled={!canEditDraft} /></label>
                <fieldset className={styles.draftAttachmentPicker}>
                    <legend>知识库附件 <small>勾选后点击“保存草稿”才会写入版本</small></legend>
                    {attachableDocuments.length === 0 && <p className={styles.draftAttachmentEmpty}>暂无可选的 MD / TXT 知识文件，请先在“知识与规则”中上传。</p>}
                    {attachableDocuments.length > 0 && <div className={styles.draftAttachmentOptions}>{attachableDocuments.map(document => {
                        const selected = selectedDraftAttachments.some(attachment => attachmentKey(attachment) === attachmentKey(document));
                        return <label className={styles.draftAttachmentOption} key={attachmentKey(document)}><input type="checkbox" checked={selected} onChange={event => toggleKnowledgeAttachment(document, event.target.checked)} disabled={!canEditDraft} /><span><strong>{document.path}</strong><small>{shortHash(document.content_hash)}</small></span></label>;
                    })}</div>}
                    {preservedAttachments.length > 0 && <div className={styles.preservedAttachments}><span className={styles.preservedAttachmentsLabel}>当前草稿中的其他附件</span>{preservedAttachments.map(attachment => <div className={styles.preservedAttachment} key={attachmentKey(attachment)}><span><strong>{attachment.name || attachment.path}</strong><small>{attachment.path} · {shortHash(attachment.content_hash)}</small></span><button type="button" onClick={() => removeDraftAttachment(attachment)} disabled={!canEditDraft}>移除</button></div>)}</div>}
                </fieldset>
                {localDraft?.conflict && <div className={styles.conflictBanner}><WarningOutlined/><span>{localDraft.conflict} 本地编辑仍保留。</span><button type="button" onClick={onReloadDraft} disabled={actionBusy === "reload-draft"}>{actionBusy === "reload-draft" ? <LoadingOutlined spin/> : <ReloadOutlined/>}加载服务器版本</button></div>}
                <div className={styles.draftActions}><button className={styles.secondaryButton} type="button" onClick={onSaveDraft} disabled={!canEditDraft || actionBusy === "save-draft" || !localDraft?.dirty}>{actionBusy === "save-draft" ? <LoadingOutlined spin/> : <SaveOutlined/>}保存草稿</button><button className={styles.primaryButton} type="button" onClick={onOpenReview} disabled={!canConfirm || Boolean(localDraft?.dirty) || actionBusy === "send"} title={canConfirm ? "打开最终版本检查" : "只有草稿待确认状态可以发送"}><CheckCircleFilled/>查看最终版本</button></div>
            </>}
        </section>
        </div>}
        {reviewOpen && activeDraft && <div className={styles.modalBackdrop} role="presentation" onMouseDown={event => {if (event.target === event.currentTarget) onCloseReview();}}><div className={styles.reviewModal} role="dialog" aria-modal="true" aria-labelledby="review-title"><div className={styles.reviewHeader}><div><span className={styles.modalKicker}><LockOutlined/>发送前确认</span><h3 id="review-title">最终版本</h3></div><button type="button" onClick={onCloseReview} aria-label="关闭"><CloseOutlined/></button></div><div className={styles.reviewMeta}><div><small>收件人</small><span>{activeDraft.to.join("、") || "未填写"}</span></div><div><small>抄送</small><span>{activeDraft.cc.join("、") || "无"}</span></div><div><small>主题</small><span>{activeDraft.subject || "无主题"}</span></div><div><small>附件</small><span className={styles.reviewAttachmentList}>{activeDraft.attachments.length > 0 ? activeDraft.attachments.map(attachment => <span key={attachmentKey(attachment)}>{attachment.path} · {shortHash(attachment.content_hash)}</span>) : "无"}</span></div></div><div className={styles.reviewBody}>{activeDraft.body || "（正文为空）"}</div><div className={styles.reviewWarning}><WarningOutlined/>{canConfirm ? "点击确认后，系统才会提交发送请求。助理不会自动发送邮件。" : "任务状态已变化，只有草稿待确认状态可以提交发送。"}</div><div className={styles.reviewActions}><button type="button" className={styles.secondaryButton} onClick={onCloseReview}>返回修改</button><button type="button" className={styles.primaryButton} onClick={onSend} disabled={actionBusy === "send" || !canConfirm}>{actionBusy === "send" ? <LoadingOutlined spin/> : <SendOutlined/>}确认并发送</button></div></div></div>}
    </div>;
}

interface MailQueryTaskDetailProps {
    task: AssistantTask;
    actionBusy: string;
    onRetry: () => void;
    onOpenMailSource: (taskId: string, source: AssistantMailQuerySource) => void;
    contextOpen: boolean;
    onToggleContext: () => void;
    onCloseContext: () => void;
}

function MailQueryTaskDetail({task, actionBusy, onRetry, onOpenMailSource, contextOpen, onToggleContext, onCloseContext}: MailQueryTaskDetailProps) {
    const mailQueryTabs = ["report", "sources", "details"] as const;
    type MailQueryTab = typeof mailQueryTabs[number];
    const [activeTab, setActiveTab] = useState<MailQueryTab>("report");
    const [sourcePage, setSourcePage] = useState(1);
    const result = mailQueryResult(task);
    const sources = result && Array.isArray(result.sources) ? result.sources : [];
    const sourcePageCount = Math.max(1, Math.ceil(sources.length / 5));
    const visibleSources = sources.slice((sourcePage - 1) * 5, sourcePage * 5);
    const syncRecords = result && Array.isArray(result.sync) ? result.sync : [];
    const warnings = [
        ...(result && Array.isArray(result.warnings) ? result.warnings : []),
        ...(Array.isArray(task.sync_warnings) ? task.sync_warnings : []),
    ].filter((warning, index, values) => Boolean(warning) && values.indexOf(warning) === index);
    const report = mailQueryReportText(task);
    const isCompleted = ["completed", "succeeded"].includes(task.status);
    const isEmptyResult = isCompleted && sources.length === 0 && !report.trim();
    const retryable = ["failed", "budget_paused"].includes(task.status);
    useEffect(() => {
        setActiveTab("report");
        setSourcePage(1);
    }, [task.id, task.run_id]);
    useEffect(() => {
        setSourcePage(page => Math.min(Math.max(page, 1), sourcePageCount));
    }, [sourcePageCount]);

    return <div className={styles.taskDetail}>
        <header className={styles.detailHeader}>
            <div><div className={styles.detailKicker}><span className={`${styles.statusPill} ${statusClass(task.status)}`}>{statusLabel(task.status)}</span>{task.model && <span>模型 {task.model}</span>}</div><h2>{mailQueryTitle(task)}</h2><p>手动邮件查询 · 更新时间 {formatDate(task.updated_at || task.created_at)}</p></div>
            <div className={styles.detailActions}>{task.session_id && <button type="button" onClick={onToggleContext} aria-expanded={contextOpen}>上下文</button>}{(retryable || isCompleted) && <button type="button" onClick={onRetry} disabled={actionBusy === "retry"}>{actionBusy === "retry" ? <LoadingOutlined spin/> : <ReloadOutlined/>}{isCompleted ? "重新生成" : "重试"}</button>}<span className={styles.liveHint}>{isTerminalTaskStatus(task.status) ? "结果已固定" : <><SyncOutlined spin/>每 3 秒更新</>}</span></div>
        </header>
        {contextOpen && task.session_id && <SessionContextPanel sessionId={task.session_id} onClose={onCloseContext} />}
        {task.error && <div className={styles.taskError}><WarningOutlined/>{task.error}</div>}
        <div className={styles.detailTabs} role="tablist" aria-label="手动邮件查询详情">
            <button type="button" id={`mail-query-${task.id}-tab-report`} role="tab" aria-selected={activeTab === "report"} aria-controls={`mail-query-${task.id}-panel-report`} tabIndex={activeTab === "report" ? 0 : -1} className={activeTab === "report" ? styles.detailTabActive : styles.detailTab} onClick={() => setActiveTab("report")} onKeyDown={event => handleDetailTabKeyDown(event, mailQueryTabs, activeTab, setActiveTab, `mail-query-${task.id}`)}>报告</button>
            <button type="button" id={`mail-query-${task.id}-tab-sources`} role="tab" aria-selected={activeTab === "sources"} aria-controls={`mail-query-${task.id}-panel-sources`} tabIndex={activeTab === "sources" ? 0 : -1} className={activeTab === "sources" ? styles.detailTabActive : styles.detailTab} onClick={() => setActiveTab("sources")} onKeyDown={event => handleDetailTabKeyDown(event, mailQueryTabs, activeTab, setActiveTab, `mail-query-${task.id}`)}>邮件来源（{sources.length}）</button>
            <button type="button" id={`mail-query-${task.id}-tab-details`} role="tab" aria-selected={activeTab === "details"} aria-controls={`mail-query-${task.id}-panel-details`} tabIndex={activeTab === "details" ? 0 : -1} className={activeTab === "details" ? styles.detailTabActive : styles.detailTab} onClick={() => setActiveTab("details")} onKeyDown={event => handleDetailTabKeyDown(event, mailQueryTabs, activeTab, setActiveTab, `mail-query-${task.id}`)}>查询详情{warnings.length > 0 && <span className={styles.detailTabBadge}>有提示</span>}</button>
        </div>
        {activeTab === "report" && <div className={styles.detailTabPanel} id={`mail-query-${task.id}-panel-report`} role="tabpanel" aria-labelledby={`mail-query-${task.id}-tab-report`}>
            {(result?.partial || warnings.length > 0) && <button type="button" className={styles.mailQueryCompactWarning} onClick={() => setActiveTab("details")}><WarningOutlined/>{result?.partial ? "资料覆盖不完整，查看查询详情" : "处理有提示，查看查询详情"}</button>}
            {!isTerminalTaskStatus(task.status) && <section className={styles.mailQueryProgress} aria-live="polite"><div className={styles.mailQueryProgressHeading}><strong>{task.status === "queued" ? "任务已排队" : "正在整理邮件"}</strong><span>{task.sync_status === "waiting" ? "等待邮箱同步" : statusLabel(task.status)}</span></div><div className={styles.progressTrack}><i style={{width: `${taskProgress(task)}%`}} /></div><p>系统会先同步邮箱，再按你的问题生成报告；结果可能需要等待。</p></section>}
            {isCompleted && <section className={styles.mailQueryReport}><div className={styles.cardHeading}><span><FileTextOutlined/>邮件报告</span><span>{sources.length} 个来源</span></div>{report.trim() ? <div className={styles.reportMarkdown}><ReactMarkdown
                remarkPlugins={[RemarkGfm]}
                skipHtml
                components={{
                    a: ({href, children}) => {
                        const match = /^#assistant-mail-source-(M\d+)$/.exec(href || "");
                        const source = match ? sources.find(item => item.id === match[1]) : undefined;
                        if (!source) return <span>{children}</span>;
                        return <button type="button" className={styles.mailCitation} onClick={() => onOpenMailSource(task.id, source)} aria-label={`打开邮件来源 ${source.id}`}>[{source.id}]</button>;
                    },
                    img: () => null,
                    input: () => null,
                }}
            >{linkifyMailSourceCitations(report)}</ReactMarkdown></div> : <div className={styles.mailQueryEmpty}><InboxOutlined/><strong>{isEmptyResult ? "没有找到匹配的邮件" : "服务未返回邮件报告"}</strong><span>{isEmptyResult ? "可以换一个时间范围或更具体的查询条件。" : "请稍后刷新任务查看结果。"}</span></div>}</section>}
        </div>}
        {activeTab === "sources" && <div className={styles.detailTabPanel} id={`mail-query-${task.id}-panel-sources`} role="tabpanel" aria-labelledby={`mail-query-${task.id}-tab-sources`}>
            <section className={styles.mailQuerySources}><div className={styles.cardHeading}><span><MailOutlined/>匹配邮件</span><span>{sources.length} 条</span></div>{sources.length === 0 ? <div className={styles.mailQueryEmpty}><InboxOutlined/><strong>{isCompleted ? "没有找到匹配的邮件" : "邮件来源尚未就绪"}</strong><span>{isCompleted ? "可以换一个时间范围或更具体的查询条件。" : "邮箱同步完成后，这里会列出可查看的邮件。"}</span></div> : <><div className={styles.mailQuerySourceList}>{visibleSources.map(source => <button type="button" className={styles.mailQuerySourceCard} key={`${source.id}-${source.mail_id}`} onClick={() => onOpenMailSource(task.id, source)}><span className={styles.mailQuerySourceTop}><strong>[{source.id}] {source.subject || "无主题"}</strong><span>{source.is_sent ? "已发送" : "收件箱"}</span></span><span className={styles.mailQuerySourceMeta}>{formatBeijingDate(source.date)} · {source.from_address || "发件人未提供"}</span><span className={styles.mailQuerySourcePreview}>{source.body || "未提供正文"}</span><ArrowRightOutlined/></button>)}</div><SourcePager page={sourcePage} pageCount={sourcePageCount} total={sources.length} label="邮件来源" onPageChange={setSourcePage} /></>}</section>
        </div>}
        {activeTab === "details" && <div className={styles.detailTabPanel} id={`mail-query-${task.id}-panel-details`} role="tabpanel" aria-labelledby={`mail-query-${task.id}-tab-details`}>
            {result && <section className={styles.mailQuerySummary}><div className={styles.cardHeading}><span><SearchOutlined/>查询概览</span><span>{result.timezone || "Asia/Shanghai"}</span></div><div className={styles.mailQueryStats}><div><strong>{Number.isFinite(result.matched_count) ? result.matched_count : 0}</strong><span>匹配邮件</span></div><div><strong>{Number.isFinite(result.source_count) ? result.source_count : sources.length}</strong><span>可查看来源</span></div><div><strong>{result.partial ? "部分" : "完整"}</strong><span>覆盖情况</span></div></div><p className={styles.mailQueryRange}>时间范围：{formatMailQueryRange(result)}</p></section>}
            {warnings.length > 0 && <div className={styles.mailQueryWarnings} role="status"><WarningOutlined/><div><strong>{result?.partial ? "结果可能不完整" : "处理提示"}</strong>{warnings.map((warning, index) => <span key={`${warning}-${index}`}>{warning}</span>)}</div></div>}
            {syncRecords.length > 0 && <div className={styles.mailQuerySync} aria-label="邮箱同步状态"><SyncOutlined/><div>{syncRecords.map(sync => <span key={sync.connection_id}><strong>{sync.email || sync.connection_id}</strong><small>{mailSyncStatusLabel(sync)}{sync.sent_available === false ? " · 已发送不可用" : ""}</small></span>)}</div></div>}
            {!result && <div className={styles.cardEmpty}>查询详情将在邮箱同步后显示。</div>}
        </div>}
    </div>;
}

interface ConnectionsPanelProps {
    accountKey: string;
    overview: AssistantOverview | null;
    onRefresh: () => void;
    onError: (message: string) => void;
    onNotice: (message: string) => void;
    actionBusy: string;
    setActionBusy: (value: string) => void;
}

function ConnectionsPanel(props: ConnectionsPanelProps) {
    const {accountKey, overview, onRefresh, onError, onNotice, actionBusy, setActionBusy} = props;
    const [form, setForm] = useState<ConnectionForm>({provider: "qq", email: "", authorization_code: ""});
    const [settings, setSettings] = useState<SettingsForm>({enabled: false, monthly_budget: "1", model: ""});
    const [settingsDirty, setSettingsDirty] = useState(false);
    const [models, setModels] = useState<ChatModelOption[]>([]);
    const [modelLoading, setModelLoading] = useState(true);
    const [modelError, setModelError] = useState("");
    const settingsFromServer = overview?.settings;

    useEffect(() => {
        if (!settingsFromServer || settingsDirty) return;
        setSettings({enabled: settingsFromServer.enabled, monthly_budget: String(settingsFromServer.monthly_budget ?? ""), model: settingsFromServer.model || ""});
    }, [settingsDirty, settingsFromServer]);

    useEffect(() => {
        setSettingsDirty(false);
        setSettings({enabled: false, monthly_budget: "1", model: ""});
        setModels([]);
        setModelError("");
    }, [accountKey]);

    useEffect(() => {
        const controller = new AbortController();
        setModelLoading(true);
        getModelCatalog(controller.signal).then(result => {
            if (!controller.signal.aborted) {
                setModels(result);
                setModelError("");
            }
        }).catch(error => {
            if (!controller.signal.aborted) setModelError(errorMessage(error));
        }).finally(() => {
            if (!controller.signal.aborted) setModelLoading(false);
        });
        return () => controller.abort();
    }, [accountKey]);

    async function connect(event: FormEvent) {
        event.preventDefault();
        if (!form.email.trim() || !form.authorization_code.trim()) return;
        setActionBusy("connect");
        try {
            await createAssistantConnection({provider: form.provider, email: form.email.trim(), authorization_code: form.authorization_code.trim()});
            setForm(previous => ({...previous, email: "", authorization_code: ""}));
            onNotice("邮箱连接已提交验证");
            onRefresh();
        } catch (error) {
            onError(errorMessage(error));
        } finally {
            setActionBusy("");
        }
    }

    async function sync(connection: AssistantConnection) {
        setActionBusy(`sync-${connection.id}`);
        try {
            await syncAssistantConnection(connection.id);
            onNotice(`${providerLabel(connection.provider)}同步请求已提交`);
            onRefresh();
        } catch (error) {
            onError(errorMessage(error));
        } finally {
            setActionBusy("");
        }
    }

    async function remove(connection: AssistantConnection) {
        if (!window.confirm(`确定解绑 ${connection.email} 吗？`)) return;
        setActionBusy(`delete-${connection.id}`);
        try {
            await deleteAssistantConnection(connection.id);
            onNotice("邮箱已解绑");
            onRefresh();
        } catch (error) {
            onError(errorMessage(error));
        } finally {
            setActionBusy("");
        }
    }

    async function saveSettings(event: FormEvent) {
        event.preventDefault();
        const budget = Number(settings.monthly_budget);
        if (!Number.isFinite(budget) || budget < 0) {
            onError("请输入有效的月度预算");
            return;
        }
        if (modelLoading || modelError || !settings.model || !models.some(model => model.id === settings.model)) {
            onError("模型目录尚未就绪，或当前模型已不可用，请选择可用模型后再保存");
            return;
        }
        setActionBusy("settings");
        try {
            await updateAssistantSettings({enabled: settings.enabled, monthly_budget: budget, model: settings.model.trim()});
            setSettingsDirty(false);
            onNotice("助理设置已保存");
            onRefresh();
        } catch (error) {
            onError(errorMessage(error));
        } finally {
            setActionBusy("");
        }
    }

    function setSetting<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
        setSettings(previous => ({...previous, [key]: value}));
        setSettingsDirty(true);
    }

    const selectedSettingsModelAvailable = !settings.model || models.some(model => model.id === settings.model);
    const modelSelectOptions = models;
    const settingsSaveDisabled = actionBusy === "settings"
        || modelLoading
        || models.length === 0
        || Boolean(modelError)
        || !settings.model
        || (Boolean(settings.model) && !selectedSettingsModelAvailable);
    return <section className={styles.settingsArea}>
        <div className={styles.settingsIntro}><div className={styles.eyebrow}><SettingOutlined/>连接与设置</div><h2>邮箱与后台自动处理</h2><p>这里仅控制后台自动处理。授权信息只用于连接邮箱，手动邮件查询会在任务中心单独提交。</p></div>
        <div className={styles.connectionLayout}>
            <div className={styles.connectionColumn}>
                <article className={styles.settingsCard}>
                    <div className={styles.cardTitle}><div><h3><LinkOutlined/>连接邮箱</h3><p>支持 QQ、163 和 126。请先在邮箱后台开启 IMAP 或生成授权码。</p></div><span className={overview?.capabilities.mail_configured ? styles.capabilityGood : styles.capabilityMuted}>{overview?.capabilities.mail_configured ? "服务已配置" : "等待服务配置"}</span></div>
                    <div className={styles.connectionList}>{(overview?.connections || []).map(connection => <div className={styles.connectionRow} key={connection.id}><span className={styles.connectionMark}><MailOutlined/></span><div className={styles.connectionInfo}><strong>{providerLabel(connection.provider)}</strong><span>{connection.email}</span><small className={statusClass(connection.status)}>{statusLabel(connection.status)} · {formatDate(connection.last_sync_at)}</small>{connection.error && <small className={styles.connectionError}>{connection.error}</small>}</div><div className={styles.connectionActions}><button type="button" onClick={() => void sync(connection)} disabled={actionBusy === `sync-${connection.id}`} title="立即同步">{actionBusy === `sync-${connection.id}` ? <LoadingOutlined spin/> : <SyncOutlined/>}</button><button type="button" onClick={() => void remove(connection)} disabled={actionBusy === `delete-${connection.id}`} title="解绑"><DeleteOutlined/></button></div></div>)}</div>
                    {(overview?.connections || []).length === 0 && <div className={styles.cardEmpty}><MailOutlined/>还没有连接邮箱。填写下方表单后开始。</div>}
                    <form className={styles.connectionForm} onSubmit={connect}><label className={styles.field}><span>邮箱服务商</span><select value={form.provider} onChange={event => setForm(previous => ({...previous, provider: event.target.value as Provider}))}>{PROVIDERS.map(provider => <option key={provider.value} value={provider.value}>{provider.label} · {provider.hint}</option>)}</select></label><label className={styles.field}><span>邮箱地址</span><input type="email" value={form.email} onChange={event => setForm(previous => ({...previous, email: event.target.value}))} placeholder="name@example.com" /></label><label className={styles.field}><span>授权码</span><input type="text" value={form.authorization_code} onChange={event => setForm(previous => ({...previous, authorization_code: event.target.value}))} placeholder="邮箱生成的授权码" /></label><button className={styles.primaryButton} type="submit" disabled={!form.email.trim() || !form.authorization_code.trim() || actionBusy === "connect"}>{actionBusy === "connect" ? <LoadingOutlined spin/> : <LinkOutlined/>}验证并连接</button></form>
                </article>
            </div>
            <div className={styles.settingsColumn}>
                <article className={styles.settingsCard}><div className={styles.cardTitle}><div><h3><RobotOutlined/>助理运行</h3><p>这里仅控制后台自动处理；手动邮件查询不会跟随此开关。模型来源于服务端目录。</p></div></div><form className={styles.settingsForm} onSubmit={saveSettings}><label className={styles.toggleField}><span><strong>启用后台自动处理</strong><small>允许后台分析与草稿生成</small></span><input type="checkbox" checked={settings.enabled} onChange={event => setSetting("enabled", event.target.checked)} /><i /></label><label className={styles.field}><span>月度预算（元）</span><input type="number" min="0" step="0.01" value={settings.monthly_budget} onChange={event => setSetting("monthly_budget", event.target.value)} /></label><label className={styles.field}><span>处理模型</span>{modelLoading ? <div className={styles.selectLoading}><LoadingOutlined spin/>读取模型目录</div> : models.length > 0 ? <select value={settings.model} onChange={event => setSetting("model", event.target.value)}>{!settings.model && <option value="">请选择模型</option>}{!selectedSettingsModelAvailable && settings.model && <option value={settings.model} disabled>{settings.model}（不可用）</option>}{modelSelectOptions.map(model => <option key={model.id} value={model.id}>{model.displayName}</option>)} </select> : <div className={styles.selectUnavailable}>{settings.model ? `${settings.model}（不可用）` : "模型目录暂不可用"}</div>}</label>{modelError && <small className={styles.inlineHint}>模型目录暂不可用；加载有效目录后才能保存。</small>}{!modelError && !modelLoading && !selectedSettingsModelAvailable && <small className={styles.inlineHint}>当前模型已不可用，请从目录选择后再保存。</small>}<button className={styles.secondaryButton} type="submit" disabled={settingsSaveDisabled}>{actionBusy === "settings" ? <LoadingOutlined spin/> : <SaveOutlined/>}保存运行设置</button></form></article>
                <article className={styles.signalCard}><div><span className={styles.signalIcon}><SyncOutlined/></span><div><strong>服务状态</strong><p>通知：{overview?.capabilities.notifications_configured ? "已配置" : "未配置"}</p></div></div><span className={overview?.capabilities.notifications_configured ? styles.signalGood : styles.signalMuted}>{overview?.capabilities.notifications_configured ? "可用" : "待配置"}</span></article>
            </div>
        </div>
    </section>;
}

interface KnowledgePanelProps {
    accountKey: string;
    onOpenSource: (source: AssistantSource) => void;
    onError: (message: string) => void;
    onNotice: (message: string) => void;
}

function KnowledgePanel(props: KnowledgePanelProps) {
    const {accountKey, onOpenSource, onError, onNotice} = props;
    const [documents, setDocuments] = useState<AssistantKnowledgeDocument[]>([]);
    const [rules, setRules] = useState<AssistantRule[]>([]);
    const [selectedPath, setSelectedPath] = useState("");
    const [editorContent, setEditorContent] = useState("");
    const [editorHash, setEditorHash] = useState("");
    const [editorDirty, setEditorDirty] = useState(false);
    const [editorConflict, setEditorConflict] = useState("");
    const [editorLoading, setEditorLoading] = useState(false);
    const [knowledgeLoading, setKnowledgeLoading] = useState(true);
    const [searchText, setSearchText] = useState("");
    const [searchResults, setSearchResults] = useState<AssistantKnowledgeSearchSource[]>([]);
    const [searchSubmittedQuery, setSearchSubmittedQuery] = useState("");
    const [searchError, setSearchError] = useState("");
    const [searching, setSearching] = useState(false);
    const [ruleText, setRuleText] = useState("");
    const [busy, setBusy] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const mountedRef = useRef(false);
    const accountGenerationRef = useRef(0);
    const loadGenerationRef = useRef(0);
    const documentGenerationRef = useRef(0);
    const searchGenerationRef = useRef(0);
    const loadControllerRef = useRef<AbortController | null>(null);
    const documentControllerRef = useRef<AbortController | null>(null);
    const searchControllerRef = useRef<AbortController | null>(null);

    const invalidateKnowledgeRequests = useCallback(() => {
        loadGenerationRef.current += 1;
        documentGenerationRef.current += 1;
        searchGenerationRef.current += 1;
        loadControllerRef.current?.abort();
        documentControllerRef.current?.abort();
        searchControllerRef.current?.abort();
        loadControllerRef.current = null;
        documentControllerRef.current = null;
        searchControllerRef.current = null;
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            invalidateKnowledgeRequests();
        };
    }, [invalidateKnowledgeRequests]);

    const loadKnowledge = useCallback(async (signal?: AbortSignal, silent = false) => {
        if (!mountedRef.current) return;
        loadControllerRef.current?.abort();
        const requestGeneration = loadGenerationRef.current + 1;
        loadGenerationRef.current = requestGeneration;
        const controller = new AbortController();
        loadControllerRef.current = controller;
        const abortFromCaller = () => controller.abort();
        if (signal?.aborted) controller.abort();
        else signal?.addEventListener("abort", abortFromCaller, {once: true});
        if (!silent) setKnowledgeLoading(true);
        try {
            const [docsResult, rulesResult] = await Promise.all([
                getAssistantKnowledge(controller.signal),
                silent ? Promise.resolve<{rules: AssistantRule[]}>({rules: []}) : getAssistantRules(controller.signal),
            ]);
            if (mountedRef.current && !controller.signal.aborted && requestGeneration === loadGenerationRef.current) {
                setDocuments(Array.isArray(docsResult.documents) ? docsResult.documents : []);
                if (!silent) setRules(Array.isArray(rulesResult.rules) ? rulesResult.rules : []);
                if (!silent) onError("");
            }
        } catch (error) {
            if (!silent && mountedRef.current && !controller.signal.aborted && requestGeneration === loadGenerationRef.current && !isAbortError(error)) onError(errorMessage(error));
        } finally {
            if (signal) signal.removeEventListener("abort", abortFromCaller);
            if (loadControllerRef.current === controller) {
                loadControllerRef.current = null;
                if (!silent && mountedRef.current && requestGeneration === loadGenerationRef.current) setKnowledgeLoading(false);
            }
        }
    }, [onError]);

    useEffect(() => {
        accountGenerationRef.current += 1;
        invalidateKnowledgeRequests();
        setDocuments([]);
        setRules([]);
        setKnowledgeLoading(true);
        setSelectedPath("");
        setEditorContent("");
        setEditorHash("");
        setEditorDirty(false);
        setEditorConflict("");
        setEditorLoading(false);
        setSearchResults([]);
        setSearchText("");
        setSearchSubmittedQuery("");
        setSearchError("");
        setSearching(false);
        setBusy("");
    }, [accountKey, invalidateKnowledgeRequests]);

    useEffect(() => {
        const controller = new AbortController();
        void loadKnowledge(controller.signal);
        return () => controller.abort();
    }, [accountKey, loadKnowledge]);

    useEffect(() => {
        let timer: number | null = null;
        if (knowledgeLoading) return;
        const hasPendingIndex = documents.some(document => document.index_status === "queued" || document.index_status === "indexing");
        const pollDelay = hasPendingIndex ? 4000 : 30000;

        const stopPolling = () => {
            if (timer !== null) {
                window.clearTimeout(timer);
                timer = null;
            }
        };

        const schedulePolling = () => {
            stopPolling();
            if (document.visibilityState !== "visible" || !mountedRef.current) return;
            timer = window.setTimeout(async () => {
                timer = null;
                if (document.visibilityState !== "visible" || !mountedRef.current) return;
                await loadKnowledge(undefined, true);
                schedulePolling();
            }, pollDelay);
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") schedulePolling();
            else stopPolling();
        };

        schedulePolling();
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            stopPolling();
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [accountKey, documents, knowledgeLoading, loadKnowledge]);

    async function openDocument(document: AssistantKnowledgeDocument) {
        if (editorDirty && selectedPath !== document.path && !window.confirm("当前文档有未保存修改，确定切换吗？")) return;
        documentControllerRef.current?.abort();
        const requestGeneration = documentGenerationRef.current + 1;
        documentGenerationRef.current = requestGeneration;
        const controller = new AbortController();
        documentControllerRef.current = controller;
        setSelectedPath(document.path);
        setEditorLoading(true);
        try {
            const file = await getAssistantKnowledgeFile(document.path, document.content_hash, controller.signal);
            if (mountedRef.current && !controller.signal.aborted && requestGeneration === documentGenerationRef.current) {
                setEditorContent(file.content);
                setEditorHash(file.content_hash);
                setEditorDirty(false);
                setEditorConflict("");
            }
        } catch (error) {
            if (mountedRef.current && !controller.signal.aborted && requestGeneration === documentGenerationRef.current && !isAbortError(error)) onError(errorMessage(error));
        } finally {
            const current = documentControllerRef.current === controller
                && requestGeneration === documentGenerationRef.current;
            if (documentControllerRef.current === controller) documentControllerRef.current = null;
            if (current && mountedRef.current) setEditorLoading(false);
        }
    }

    async function upload(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        const extension = file.name.split(".").pop()?.toLowerCase();
        if (!extension || !["md", "txt", "pdf", "docx"].includes(extension)) {
            onError("仅支持 MD、TXT、PDF 和 DOCX 文件");
            return;
        }
        const accountGeneration = accountGenerationRef.current;
        const isCurrentAccount = () => mountedRef.current && accountGenerationRef.current === accountGeneration;
        setBusy("upload");
        try {
            const contentBase64 = await fileToBase64(file);
            await uploadAssistantKnowledge({path: file.name, content_base64: contentBase64});
            if (!isCurrentAccount()) return;
            onNotice(`${file.name} 已加入知识库，后台正在索引`);
            await loadKnowledge();
        } catch (error) {
            if (!isCurrentAccount()) return;
            onError(errorMessage(error));
        } finally {
            if (isCurrentAccount()) setBusy("");
        }
    }

    async function saveDocument() {
        if (!selectedPath) return;
        const accountGeneration = accountGenerationRef.current;
        const isCurrentAccount = () => mountedRef.current && accountGenerationRef.current === accountGeneration;
        setBusy("document");
        try {
            const saved = await uploadAssistantKnowledge({path: selectedPath, content: editorContent, expected_hash: editorHash || undefined});
            if (!isCurrentAccount()) return;
            if (saved.content_hash) setEditorHash(saved.content_hash);
            setEditorDirty(false);
            setEditorConflict("");
            onNotice("知识文档已保存，后台正在更新索引");
            await loadKnowledge();
        } catch (error) {
            if (!isCurrentAccount()) return;
            if (error instanceof AssistantApiError && error.status === 409) {
                setEditorConflict(error.detail);
                onError("知识文档已被其他窗口修改，本地编辑仍保留");
            } else onError(errorMessage(error));
        } finally {
            if (isCurrentAccount()) setBusy("");
        }
    }

    async function retryIndex(document: AssistantKnowledgeDocument) {
        const accountGeneration = accountGenerationRef.current;
        const isCurrentAccount = () => mountedRef.current && accountGenerationRef.current === accountGeneration;
        setBusy(`reindex-${document.path}`);
        try {
            const queued = await reindexAssistantKnowledge(document.path, document.content_hash || undefined);
            if (!isCurrentAccount()) return;
            setDocuments(previous => previous.map(item => item.path === document.path ? {...item, ...queued} : item));
            onNotice(`${document.path} 已重新加入索引队列`);
            await loadKnowledge();
        } catch (error) {
            if (!isCurrentAccount()) return;
            onError(errorMessage(error));
        } finally {
            if (isCurrentAccount()) setBusy("");
        }
    }

    async function reloadDocument() {
        if (!selectedPath) return;
        documentControllerRef.current?.abort();
        const requestGeneration = documentGenerationRef.current + 1;
        documentGenerationRef.current = requestGeneration;
        const controller = new AbortController();
        documentControllerRef.current = controller;
        setEditorLoading(true);
        try {
            const file = await getAssistantKnowledgeFile(selectedPath, undefined, controller.signal);
            if (mountedRef.current && !controller.signal.aborted && requestGeneration === documentGenerationRef.current) {
                setEditorContent(file.content);
                setEditorHash(file.content_hash);
                setEditorDirty(false);
                setEditorConflict("");
                onNotice("已加载服务器版本，本地编辑已放弃");
            }
        } catch (error) {
            if (mountedRef.current && !controller.signal.aborted && requestGeneration === documentGenerationRef.current && !isAbortError(error)) onError(errorMessage(error));
        } finally {
            const current = documentControllerRef.current === controller
                && requestGeneration === documentGenerationRef.current;
            if (documentControllerRef.current === controller) documentControllerRef.current = null;
            if (current && mountedRef.current) setEditorLoading(false);
        }
    }

    async function removeDocument(document: AssistantKnowledgeDocument) {
        if (!window.confirm(`确定删除 ${document.path} 吗？`)) return;
        const accountGeneration = accountGenerationRef.current;
        const isCurrentAccount = () => mountedRef.current && accountGenerationRef.current === accountGeneration;
        setBusy(`delete-${document.path}`);
        try {
            await deleteAssistantKnowledgeFile(document.path, document.content_hash);
            if (!isCurrentAccount()) return;
            if (selectedPath === document.path) {
                setSelectedPath("");
                setEditorContent("");
                setEditorHash("");
                setEditorDirty(false);
                setEditorConflict("");
            }
            onNotice("知识文档已删除");
            await loadKnowledge();
        } catch (error) {
            if (!isCurrentAccount()) return;
            if (error instanceof AssistantApiError && error.status === 409) onError("知识文档版本已变化，删除请求未执行");
            else onError(errorMessage(error));
        } finally {
            if (isCurrentAccount()) setBusy("");
        }
    }

    async function search(event: FormEvent) {
        event.preventDefault();
        searchControllerRef.current?.abort();
        const requestGeneration = searchGenerationRef.current + 1;
        searchGenerationRef.current = requestGeneration;
        const query = searchText.trim();
        if (!query) {
            setSearchResults([]);
            setSearchSubmittedQuery("");
            setSearchError("");
            setSearching(false);
            return;
        }
        const controller = new AbortController();
        searchControllerRef.current = controller;
        setSearchSubmittedQuery(query);
        setSearchResults([]);
        setSearchError("");
        setSearching(true);
        try {
            const result = await searchAssistantKnowledge(query, controller.signal);
            if (mountedRef.current && !controller.signal.aborted && requestGeneration === searchGenerationRef.current) {
                setSearchResults(Array.isArray(result.sources) ? result.sources : []);
            }
        } catch (error) {
            if (mountedRef.current && !controller.signal.aborted && requestGeneration === searchGenerationRef.current && !isAbortError(error)) {
                const message = errorMessage(error);
                setSearchError(message);
                onError(message);
            }
        } finally {
            const current = searchControllerRef.current === controller
                && requestGeneration === searchGenerationRef.current;
            if (searchControllerRef.current === controller) searchControllerRef.current = null;
            if (current && mountedRef.current) setSearching(false);
        }
    }

    async function addRule(event: FormEvent) {
        event.preventDefault();
        if (!ruleText.trim()) return;
        const accountGeneration = accountGenerationRef.current;
        const isCurrentAccount = () => mountedRef.current && accountGenerationRef.current === accountGeneration;
        setBusy("rule");
        try {
            await createAssistantRule(ruleText.trim());
            if (!isCurrentAccount()) return;
            setRuleText("");
            onNotice("规则已保存");
            await loadKnowledge();
        } catch (error) {
            if (!isCurrentAccount()) return;
            onError(errorMessage(error));
        } finally {
            if (isCurrentAccount()) setBusy("");
        }
    }

    return <section className={styles.knowledgeArea}>
        <div className={styles.settingsIntro}><div className={styles.eyebrow}><BookOutlined/>知识与规则</div><h2>个人知识库</h2><p>上传个人资料或编辑 Markdown。引用保留文件路径和行号，方便核对原文。</p></div>
        <div className={styles.knowledgeGrid}>
            <article className={styles.knowledgeCard}>
                <div className={styles.cardTitle}><div><h3><FileTextOutlined/>知识文件</h3><p>支持 Markdown、TXT、PDF 和 DOCX，上传后会在后台建立索引。</p></div><button type="button" className={styles.uploadButton} onClick={() => fileInputRef.current?.click()} disabled={busy === "upload"}>{busy === "upload" ? <LoadingOutlined spin/> : <CloudUploadOutlined/>}上传文件</button><input ref={fileInputRef} className={styles.hiddenInput} type="file" accept=".md,.txt,.pdf,.docx,text/markdown,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={upload} /></div>
                {knowledgeLoading && <div className={styles.inlineLoading}><LoadingOutlined spin/>读取知识库</div>}
                {!knowledgeLoading && documents.length === 0 && <div className={styles.emptyKnowledge}><BookOutlined/><strong>知识库还是空的</strong><span>上传第一份资料，助理就能在任务中引用它。</span></div>}
                <div className={styles.documentList}>{documents.map(document => {
                    const statusClassName = `${styles.statusPill} ${knowledgeStatusClass(document.index_status)}`;
                    const retryBusy = busy === `reindex-${document.path}`;
                    return <div key={document.path} className={`${styles.documentRow} ${selectedPath === document.path ? styles.documentSelected : ""}`}>
                        <button type="button" onClick={() => void openDocument(document)}>
                            <FileTextOutlined/>
                            <span className={styles.documentLabel}>
                                <strong>{document.path}</strong>
                                <span className={styles.documentMeta}><small className={statusClassName}>{knowledgeStatusLabel(document.index_status)}</small>{document.index_status === "ready" && <small>{document.chunk_count} 个片段</small>}<small>{shortHash(document.content_hash)}</small></span>
                                {document.index_status === "failed" && <small className={styles.documentIndexError}>{document.index_error || "索引失败，请重试"}</small>}
                            </span>
                        </button>
                        <div className={styles.documentActions}>
                            {document.index_status === "failed" && <button type="button" className={styles.retryButton} onClick={() => void retryIndex(document)} disabled={retryBusy}>{retryBusy ? <LoadingOutlined spin/> : <ReloadOutlined/>}重试</button>}
                            <button type="button" aria-label={`删除 ${document.path}`} onClick={() => void removeDocument(document)} disabled={busy === `delete-${document.path}`}><DeleteOutlined/></button>
                        </div>
                    </div>;
                })}</div>
                {selectedPath && <div className={styles.editor}><div className={styles.editorHeader}><span>{editorLoading ? <LoadingOutlined spin/> : <FileTextOutlined/>}{selectedPath}</span><span>{editorDirty ? "未保存" : editorHash ? `hash ${editorHash.slice(0, 8)}` : ""}</span></div><textarea value={editorContent} onChange={event => {setEditorContent(event.target.value); setEditorDirty(true); setEditorConflict("");}} disabled={editorLoading} spellCheck={false} />{editorConflict && <div className={styles.conflictBanner}><WarningOutlined/><span>{editorConflict} 本地编辑仍保留。</span><button type="button" onClick={() => void reloadDocument()} disabled={editorLoading}>{editorLoading ? <LoadingOutlined spin/> : <ReloadOutlined/>}加载服务器版本</button></div>}<div className={styles.editorActions}><button type="button" className={styles.secondaryButton} onClick={() => void saveDocument()} disabled={!editorDirty || busy === "document"}>{busy === "document" ? <LoadingOutlined spin/> : <SaveOutlined/>}保存 Markdown</button></div></div>}
            </article>
            <article className={`${styles.knowledgeCard} ${styles.searchCard}`}>
                <div className={styles.searchHeader}>
                    <div className={styles.searchHeading}><h3><SearchOutlined/>搜索引用</h3><p>输入自然语言问题并提交，查看相关片段和出处。</p></div>
                    <form className={styles.searchForm} onSubmit={search}><input value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="例如：上次项目的截止时间是什么？" /><button type="submit" aria-label="提交检索" disabled={searching}>{searching ? <LoadingOutlined spin/> : <SearchOutlined/>}</button></form>
                </div>
                {searchSubmittedQuery && searchSubmittedQuery === searchText.trim() && searchError && <div className={styles.searchError} role="alert"><WarningOutlined/>{searchError}</div>}
                {searchSubmittedQuery && searchSubmittedQuery === searchText.trim() && !searchError && !searching && searchResults.length === 0 && <div className={styles.cardEmpty}>没有找到匹配片段。</div>}
                <div className={styles.searchResults}>{searchSubmittedQuery && searchSubmittedQuery === searchText.trim() && searchResults.map((source, index) => <button type="button" key={`${source.path}-${index}`} onClick={() => onOpenSource(source)}><span className={styles.resultLine}>{source.path} · 第 {source.line_start}–{source.line_end} 行</span><strong>{source.text}</strong></button>)}</div>
            </article>
            <details className={`${styles.knowledgeCard} ${styles.rulesCard}`}>
                <summary className={styles.rulesSummary}>
                    <span className={styles.rulesSummaryCopy}><span className={styles.rulesSummaryTitle}><SettingOutlined/>规则</span><span className={styles.rulesSummaryDescription}>告诉助理哪些偏好应当始终遵守。</span></span>
                    <span className={styles.rulesSummaryMeta}>{rules.length} 条规则</span>
                </summary>
                <form className={styles.ruleForm} onSubmit={addRule}><textarea value={ruleText} onChange={event => setRuleText(event.target.value)} placeholder="例如：给客户的回复保持简短、先确认截止时间" rows={3} /><button type="submit" className={styles.secondaryButton} disabled={!ruleText.trim() || busy === "rule"}>{busy === "rule" ? <LoadingOutlined spin/> : <PlusOutlined/>}添加规则</button></form>
                <div className={styles.ruleList}>{rules.length === 0 && <div className={styles.cardEmpty}>还没有额外规则。</div>}{rules.map(rule => <div className={styles.ruleRow} key={`${rule.path}-${rule.content_hash}`}><CheckCircleFilled/><span>{rule.content}</span></div>)}</div>
            </details>
        </div>
        <KnowledgeQa accountKey={accountKey} onOpenSource={onOpenSource} onError={onError}/>
    </section>;
}

function SourceViewer(props: {viewer: ViewerState; onClose: () => void}) {
    const {viewer, onClose} = props;
    return <div className={styles.modalBackdrop} role="presentation" onMouseDown={event => {if (event.target === event.currentTarget) onClose();}}><div className={styles.sourceModal} role="dialog" aria-modal="true" aria-labelledby="source-title"><div className={styles.reviewHeader}><div><span className={styles.modalKicker}><FileTextOutlined/>知识来源</span><h3 id="source-title">{viewer.source.path}</h3></div><button type="button" onClick={onClose} aria-label="关闭"><CloseOutlined/></button></div>{viewer.loading && <div className={styles.inlineLoading}><LoadingOutlined spin/>正在读取文件</div>}{viewer.error && <div className={styles.taskError}><WarningOutlined/>{viewer.error}</div>}{!viewer.loading && !viewer.error && <pre className={styles.sourceContent}>{viewer.content}</pre>}<div className={styles.sourceFooter}>{viewer.source.line_start ? `引用第 ${viewer.source.line_start}–${viewer.source.line_end || viewer.source.line_start} 行` : "完整文件"}<button type="button" className={styles.secondaryButton} onClick={onClose}>关闭</button></div></div></div>;
}

function MailSourceViewer(props: {viewer: MailSourceViewerState; onClose: () => void}) {
    const {viewer, onClose} = props;
    const source = viewer.source;
    const contentWarning = mailContentWarning(source);
    const content = source.body || (contentWarning ? "（正文未导入）" : "（正文为空）");
    return <div className={styles.modalBackdrop} role="presentation" onMouseDown={event => {if (event.target === event.currentTarget) onClose();}}><div className={styles.mailSourceModal} role="dialog" aria-modal="true" aria-labelledby="mail-source-title"><div className={styles.reviewHeader}><div><span className={styles.modalKicker}><MailOutlined/>原始邮件</span><h3 id="mail-source-title">[{source.id}] {source.subject || "无主题"}</h3></div><button type="button" onClick={onClose} aria-label="关闭"><CloseOutlined/></button></div><div className={styles.mailSourceMeta}><div><small>发件人</small><span>{source.from_address || "未提供"}</span></div><div><small>收件人</small><span>{mailRecipients(source.to)}</span></div><div><small>时间</small><span>{formatBeijingDate(source.date)}（北京时间）</span></div><div><small>邮箱位置</small><span>{source.is_sent ? "已发送" : "收件箱"}</span></div></div>{source.task_status && <div className={styles.inlineHint}>任务状态：{source.task_status}</div>}{contentWarning && <div className={styles.inlineHint}><WarningOutlined/>{contentWarning}</div>}{viewer.loading && <div className={styles.inlineLoading}><LoadingOutlined spin/>正在读取邮件原文</div>}{viewer.error && <div className={styles.taskError}><WarningOutlined/>{viewer.error}</div>}{!viewer.loading && !viewer.error && <pre className={styles.mailSourceContent}>{content}</pre>}<div className={styles.sourceFooter}><span>只读查看</span><button type="button" className={styles.secondaryButton} onClick={onClose}>关闭</button></div></div></div>;
}

export default Assistant;

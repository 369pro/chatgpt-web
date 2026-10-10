import {CloseOutlined} from "@ant-design/icons";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
    ContextSummary,
    ContextUsage,
    DEFAULT_RECENT_TURNS,
    getContextPreferences,
    getSessionContext,
    MAX_RECENT_TURNS,
    MIN_RECENT_TURNS,
    SessionContextSnapshot,
    updateContextPreferences,
    updateSessionContext,
} from "@/apis/session-context";
import {AgentRunRecord, getAgentSession} from "@/apis";
import {useAccessStore} from "@/app/store/access";
import {orderQueuedRuns, queueHead, queuePosition} from "@/app/store/agent-run-queue";
import styles from "./session-context-panel.module.scss";

interface Props {
    sessionId?: string | null;
    runs?: AgentRunRecord[];
    activeRunId?: string | null;
    onClose?: () => void;
}

function normalizeTurns(value: string | number, fallback = DEFAULT_RECENT_TURNS): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(MIN_RECENT_TURNS, Math.min(MAX_RECENT_TURNS, Math.round(parsed)));
}

function errorMessage(error: unknown): string {
    const status = error && typeof error === "object" && "status" in error
        ? (error as {status?: unknown}).status
        : undefined;
    if (status === 409) return "当前会话正在运行，设置未提交；输入已保留，请在会话空闲后重试。";
    return error instanceof Error ? error.message : "上下文同步失败，请稍后重试。";
}

function usageStatus(value?: string): string {
    switch (value) {
        case "ok": return "已同步";
        case "prepared": return "上下文就绪";
        case "compressing": return "压缩中";
        case "compressed": return "已完成压缩";
        case "failed": return "压缩失败，保留原文";
        case "budget_exhausted": return "预算不足，保留原文";
        default: return value || "暂无状态";
    }
}

function capacitySource(value?: string): string {
    switch (value) {
        case "model_metadata": return "模型元数据";
        case "configured_fallback": return "保守配置估算";
        default: return value || "未知";
    }
}

function runStatus(value: AgentRunRecord["status"]): string {
    switch (value) {
        case "queued": return "排队中";
        case "running": return "运行中";
        case "succeeded": return "完成";
        case "failed": return "失败";
        case "cancelled": return "已停止";
        case "budget_exhausted": return "额度受限";
        case "interrupted": return "中断";
        default: return value;
    }
}

function money(value: number | string | null | undefined): string {
    if (value == null || value === "") return "—";
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `¥${numeric.toFixed(4)}` : String(value);
}

export function SessionContextPanel(props: Props) {
    const {sessionId, runs, activeRunId, onClose} = props;
    const accountIdentity = useAccessStore((state) => `${state.username}:${state.token}`);
    const [defaultTurns, setDefaultTurns] = useState(DEFAULT_RECENT_TURNS);
    const [defaultDraft, setDefaultDraft] = useState(String(DEFAULT_RECENT_TURNS));
    const [sessionDraft, setSessionDraft] = useState(String(DEFAULT_RECENT_TURNS));
    const [snapshot, setSnapshot] = useState<SessionContextSnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<"default" | "session" | "">("");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [showSources, setShowSources] = useState(false);
    const [remoteRuns, setRemoteRuns] = useState<AgentRunRecord[]>([]);
    const [remoteActiveRunId, setRemoteActiveRunId] = useState<string | null>(null);
    const defaultDirtyRef = useRef(false);
    const sessionDirtyRef = useRef(false);
    const defaultTurnsRef = useRef(DEFAULT_RECENT_TURNS);
    const requestGenerationRef = useRef(0);
    const requestIdentityRef = useRef("");
    const refreshSequenceRef = useRef(0);
    const saveSequenceRef = useRef(0);
    const activeRefreshRef = useRef<AbortController | null>(null);
    const activeSaveRef = useRef<AbortController | null>(null);
    const identity = `${accountIdentity}\u0000${sessionId || ""}`;
    const shouldFetchDetail = Boolean(sessionId && runs === undefined);

    function setDefaultDraftValue(value: string, dirty: boolean) {
        defaultDirtyRef.current = dirty;
        setDefaultDraft(value);
    }

    function setSessionDraftValue(value: string, dirty: boolean) {
        sessionDirtyRef.current = dirty;
        setSessionDraft(value);
    }

    function isCurrentRequest(generation: number, requestIdentity: string): boolean {
        return generation === requestGenerationRef.current && requestIdentity === requestIdentityRef.current;
    }

    function isCurrentSave(sequence: number, generation: number, requestIdentity: string): boolean {
        return sequence === saveSequenceRef.current && isCurrentRequest(generation, requestIdentity);
    }

    const refresh = useCallback(async (signal: AbortSignal, generation: number, requestIdentity: string, initial: boolean) => {
        const refreshSequence = refreshSequenceRef.current + 1;
        refreshSequenceRef.current = refreshSequence;
        if (initial) setLoading(true);
        try {
            const preferencePromise = getContextPreferences(signal);
            const contextPromise = sessionId ? getSessionContext(sessionId, signal) : Promise.resolve<SessionContextSnapshot | null>(null);
            // Chat already owns a durable detail synchronizer and supplies runs.
            // Mail tasks do not, so fold their detail read into this panel's
            // existing 3-second refresh rather than starting another loop.
            const detailPromise = shouldFetchDetail && sessionId
                ? getAgentSession(sessionId, signal)
                : Promise.resolve(null);
            const [preferences, context, detail] = await Promise.all([preferencePromise, contextPromise, detailPromise]);
            if (signal.aborted || refreshSequence !== refreshSequenceRef.current || !isCurrentRequest(generation, requestIdentity)) return;
            defaultTurnsRef.current = preferences.recent_turns;
            setDefaultTurns(preferences.recent_turns);
            if (!defaultDirtyRef.current) setDefaultDraftValue(String(preferences.recent_turns), false);
            if (context) {
                setSnapshot(context);
                if (!sessionDirtyRef.current) setSessionDraftValue(String(context.recent_turns), false);
            } else {
                setSnapshot(null);
                if (!sessionDirtyRef.current) setSessionDraftValue(String(preferences.recent_turns), false);
            }
            if (detail) {
                setRemoteRuns(detail.runs);
                setRemoteActiveRunId(detail.session.active_run_id || null);
            }
            setError("");
        } catch (cause) {
            if (!signal.aborted && refreshSequence === refreshSequenceRef.current && isCurrentRequest(generation, requestIdentity)) setError(errorMessage(cause));
        } finally {
            if (!signal.aborted && refreshSequence === refreshSequenceRef.current && isCurrentRequest(generation, requestIdentity)) setLoading(false);
        }
    }, [sessionId, shouldFetchDetail]);

    useEffect(() => {
        const controller = new AbortController();
        const generation = requestGenerationRef.current + 1;
        requestGenerationRef.current = generation;
        requestIdentityRef.current = identity;
        activeRefreshRef.current?.abort();
        activeSaveRef.current?.abort();
        saveSequenceRef.current += 1;
        defaultDirtyRef.current = false;
        sessionDirtyRef.current = false;
        setSnapshot(null);
        setRemoteRuns([]);
        setRemoteActiveRunId(null);
        setDefaultDraft(String(defaultTurnsRef.current));
        setSessionDraft(String(defaultTurnsRef.current));
        setLoading(true);
        setNotice("");
        setShowSources(false);
        activeRefreshRef.current = controller;
        void refresh(controller.signal, generation, identity, true);
        const timer = window.setInterval(() => {
            void refresh(controller.signal, generation, identity, false);
        }, 3000);
        return () => {
            controller.abort();
            window.clearInterval(timer);
            if (activeSaveRef.current) activeSaveRef.current.abort();
            if (activeRefreshRef.current === controller) activeRefreshRef.current = null;
            requestGenerationRef.current += 1;
        };
    }, [accountIdentity, identity, refresh]);

    const effectiveRuns = runs ?? remoteRuns;
    const effectiveActiveRunId = activeRunId ?? remoteActiveRunId;
    const queuedRuns = useMemo(() => orderQueuedRuns(effectiveRuns.filter((run) => run.status === "queued" || run.status === "running")), [effectiveRuns]);
    const queueHeadRun = queueHead(queuedRuns, effectiveActiveRunId);

    async function saveDefault() {
        const value = normalizeTurns(defaultDraft, defaultTurns);
        const requestIdentity = identity;
        const generation = requestGenerationRef.current;
        const sequence = saveSequenceRef.current + 1;
        saveSequenceRef.current = sequence;
        const controller = new AbortController();
        activeSaveRef.current?.abort();
        activeSaveRef.current = controller;
        setSaving("default");
        setError("");
        setNotice("");
        try {
            const result = await updateContextPreferences(value, controller.signal);
            if (controller.signal.aborted || !isCurrentSave(sequence, generation, requestIdentity)) return;
            defaultTurnsRef.current = result.recent_turns;
            setDefaultTurns(result.recent_turns);
            setDefaultDraftValue(String(result.recent_turns), false);
            setNotice("个人默认值已同步，只影响之后创建的会话。");
        } catch (cause) {
            if (!controller.signal.aborted && isCurrentSave(sequence, generation, requestIdentity)) setError(errorMessage(cause));
        } finally {
            if (isCurrentSave(sequence, generation, requestIdentity)) setSaving("");
            if (activeSaveRef.current === controller) activeSaveRef.current = null;
        }
    }

    async function saveSession() {
        if (!sessionId) return;
        const value = normalizeTurns(sessionDraft, snapshot?.recent_turns || defaultTurns);
        const requestIdentity = identity;
        const generation = requestGenerationRef.current;
        const sequence = saveSequenceRef.current + 1;
        saveSequenceRef.current = sequence;
        const controller = new AbortController();
        activeSaveRef.current?.abort();
        activeSaveRef.current = controller;
        setSaving("session");
        setError("");
        setNotice("");
        try {
            const result = await updateSessionContext(sessionId, value, controller.signal);
            if (controller.signal.aborted || !isCurrentSave(sequence, generation, requestIdentity)) return;
            setSnapshot(result);
            setSessionDraftValue(String(result.recent_turns), false);
            setNotice("本会话保留轮数已同步，原始历史仍保留。");
        } catch (cause) {
            if (!controller.signal.aborted && isCurrentSave(sequence, generation, requestIdentity)) setError(errorMessage(cause));
        } finally {
            if (isCurrentSave(sequence, generation, requestIdentity)) setSaving("");
            if (activeSaveRef.current === controller) activeSaveRef.current = null;
        }
    }

    const usage: ContextUsage | null | undefined = snapshot?.usage;
    const summary: ContextSummary | null | undefined = snapshot?.summary;
    return <aside className={styles.panel} aria-label="上下文设置">
        <header className={styles.header}>
            <div className={styles.title}><strong>上下文</strong><span>历史原文保留，较早内容按需摘要</span></div>
            {onClose && <button type="button" className={styles.close} onClick={onClose} aria-label="关闭上下文面板"><CloseOutlined /></button>}
        </header>
        <div className={styles.body}>
            {error && <div className={styles.error} role="alert">{error}</div>}
            {notice && <div className={styles.notice} role="status">{notice}</div>}
            <section className={styles.section}>
                <div className={styles.sectionHeading}><strong>个人默认保留轮数</strong><span>1–100</span></div>
                <div className={styles.fieldRow}>
                    <input type="number" min={MIN_RECENT_TURNS} max={MAX_RECENT_TURNS} value={defaultDraft} onChange={(event) => setDefaultDraftValue(event.target.value, true)} aria-label="个人默认保留轮数" />
                    <button type="button" className={styles.save} disabled={saving !== ""} onClick={() => void saveDefault()}>{saving === "default" ? "同步中" : "保存"}</button>
                </div>
                <p className={styles.hint}>仅影响之后创建的会话；现有会话用自己的设置。</p>
            </section>
            <section className={styles.section}>
                <div className={styles.sectionHeading}><strong>本会话保留轮数</strong><span>{sessionId ? (loading ? "同步中" : "已同步") : "未关联"}</span></div>
                {sessionId ? <>
                    <div className={styles.fieldRow}>
                        <input type="number" min={MIN_RECENT_TURNS} max={MAX_RECENT_TURNS} value={sessionDraft} onChange={(event) => setSessionDraftValue(event.target.value, true)} aria-label="本会话保留轮数" />
                        <button type="button" className={styles.save} disabled={saving !== "" || loading} onClick={() => void saveSession()}>{saving === "session" ? "同步中" : "保存"}</button>
                    </div>
                    <p className={styles.hint}>实际保留数量可能因模型容量进一步压缩；当前轮和工具链保持完整。</p>
                </> : <div className={styles.empty}>这个邮箱任务没有关联 session，暂时不能调整上下文。</div>}
            </section>
            {sessionId && <section className={styles.section}>
                <div className={styles.sectionHeading}><strong>同步与用量</strong><span>{loading ? "同步中" : error ? "同步失败" : "已同步"}</span></div>
                {!usage && <div className={styles.empty}>服务器尚未返回用量快照。</div>}
                {usage && <>
                    <div className={styles.metricGrid}>
                        <div className={styles.metric}><span>估算 tokens</span><strong>{usage.estimated_tokens.toLocaleString()}</strong></div>
                        <div className={styles.metric}><span>上下文窗口</span><strong>{usage.context_window.toLocaleString()}</strong></div>
                        <div className={styles.metric}><span>触发阈值</span><strong>{usage.trigger_tokens.toLocaleString()}</strong></div>
                        <div className={styles.metric}><span>实际保留轮数</span><strong>{usage.retained_turns}</strong></div>
                    </div>
                    <div className={styles.compression}><span>容量来源：{capacitySource(usage.capacity_source)}</span><span className={styles.status}>{usageStatus(usage.status)}</span></div>
                    <div className={styles.compression}><span>压缩费用</span><strong>{money(usage.compression_cost)}</strong></div>
                </>}
                {queuedRuns.length > 0 && <div className={styles.queue} aria-label="排队运行">
                    <div className={styles.sectionHeading}><strong>当前运行队列</strong><span>{queuedRuns.length} 个</span></div>
                    {queuedRuns.map((run) => {
                        const position = queuePosition(run, queueHeadRun?.run_id);
                        const label = run.run_id === queueHeadRun?.run_id
                            ? "队头"
                            : position == null ? "排队" : `第 ${position} 项`;
                        return <div className={styles.queueRow} key={run.run_id}><span><strong>{label}</strong> · {runStatus(run.status)}</span><span>{run.run_id.slice(0, 8)}</span></div>;
                    })}
                </div>}
            </section>}
            {sessionId && <section className={styles.section}>
                <div className={styles.sectionHeading}><strong>较早内容摘要</strong><span>{summary ? `覆盖 ${snapshot?.sources.length || 0} 条原文` : "暂无"}</span></div>
                {!summary && <div className={styles.empty}>当前没有可展示的摘要。</div>}
                {summary && <>
                    <p className={styles.summaryText} aria-readonly="true">{summary.text || "（摘要为空）"}</p>
                    <div className={styles.summaryMeta}><span>{summary.created_at ? new Date(summary.created_at).toLocaleString() : "服务器摘要"}</span><button type="button" className={styles.sourceToggle} onClick={() => setShowSources(value => !value)}>{showSources ? "收起原文" : `查看覆盖原文（${snapshot?.sources.length || 0} 条）`}</button></div>
                    {showSources && <div className={styles.sources} aria-label="摘要覆盖的原文">
                        {(snapshot?.sources || []).length === 0 && <div className={styles.empty}>没有返回可定位的原文消息。</div>}
                        {(snapshot?.sources || []).map((source) => <div className={styles.source} id={`context-source-${source.seq}`} key={`${source.message_id}-${source.seq}`}><span className={styles.sourceMeta}>第 {source.seq} 条 · {source.role}</span>{source.content}</div>)}
                    </div>}
                </>}
            </section>}
        </div>
    </aside>;
}

"use client";

import {
    BookOutlined,
    CheckCircleFilled,
    FileTextOutlined,
    GlobalOutlined,
    LeftOutlined,
    LinkOutlined,
    LoadingOutlined,
    QuestionCircleOutlined,
    ReloadOutlined,
    SearchOutlined,
    RightOutlined,
    WarningOutlined,
} from "@ant-design/icons";
import {FormEvent, useCallback, useEffect, useRef, useState} from "react";
import ReactMarkdown from "react-markdown";
import RemarkGfm from "remark-gfm";
import {getModelCatalog} from "@/apis";
import {ChatModelOption} from "@/app/constants";
import {
    AssistantApiError,
    AssistantKnowledgeQuestion,
    AssistantKnowledgeQuestionSource,
    AssistantSource,
    createAssistantKnowledgeQuestion,
    getAssistantKnowledgeCapabilities,
    getAssistantKnowledgeQuestion,
    getAssistantKnowledgeQuestions,
} from "@/apis/assistant";
import styles from "./knowledge-qa.module.scss";

export interface KnowledgeQaProps {
    accountKey: string;
    onOpenSource: (source: AssistantSource) => void;
    onError?: (message: string) => void;
}

const MAX_QUESTION_LENGTH = 2000;
const QUESTIONS_PAGE_SIZE = 5;
const PENDING_STATUSES = new Set<AssistantKnowledgeQuestion["status"]>(["queued", "running"]);
const DEEPSEEK_WEB_MODELS = new Set(["deepseek-flash", "deepseek-v4-pro"]);

function isPending(question: AssistantKnowledgeQuestion): boolean {
    return PENDING_STATUSES.has(question.status);
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
    if (error instanceof AssistantApiError) return error.detail;
    if (error instanceof Error) return error.message;
    return "请求失败，请稍后重试";
}

function shouldRetryTransport(error: unknown): boolean {
    return error instanceof TypeError || (error instanceof AssistantApiError && error.status >= 500);
}

function createRequestId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const segment = (length: number) => Array.from({length}, () => Math.floor(Math.random() * 16).toString(16)).join("");
    return `${segment(8)}-${segment(4)}-4${segment(3)}-${segment(4)}-${segment(12)}`;
}

function formatDate(value: string | null): string {
    if (!value) return "刚刚";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("zh-CN", {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"}).format(date);
}

function statusLabel(status: AssistantKnowledgeQuestion["status"]): string {
    if (status === "queued") return "等待生成";
    if (status === "running") return "生成中";
    if (status === "succeeded") return "已回答";
    if (status === "insufficient") return "资料不足";
    if (status === "cancelled") return "已取消";
    return "回答失败";
}

function isDeepSeekModel(model?: ChatModelOption): boolean {
    if (!model) return false;
    return DEEPSEEK_WEB_MODELS.has(model.id.trim());
}

function isWebSource(source: AssistantKnowledgeQuestionSource): boolean {
    return source.kind === "web";
}

function safeExternalUrl(value?: string): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
        return null;
    }
}

function webSourceDomain(source: AssistantKnowledgeQuestionSource): string {
    const url = safeExternalUrl(source.url);
    if (!url) return "来源地址不可用";
    try {
        return new URL(url).hostname;
    } catch {
        return "来源地址不可用";
    }
}

function webSourceDate(source: AssistantKnowledgeQuestionSource): string {
    if (!source.published_at) return "日期未提供";
    const date = new Date(source.published_at);
    return Number.isNaN(date.getTime()) ? source.published_at : formatDate(source.published_at);
}

function sourceLocation(source: AssistantKnowledgeQuestionSource): string {
    if (source.line_start > 0 && source.line_end > 0) {
        return source.line_start === source.line_end
            ? `第 ${source.line_start} 行`
            : `第 ${source.line_start}–${source.line_end} 行`;
    }
    return "行号未提供";
}

function linkifyCitationMarkers(markdown: string): string {
    let fenced = false;
    return markdown.split("\n").map(line => {
        if (/^\s*(```|~~~)/.test(line)) {
            fenced = !fenced;
            return line;
        }
        return fenced ? line : line.replace(/\[(\d+)\]/g, "[$1](#knowledge-source-$1)");
    }).join("\n");
}

function renderAnswer(
    answer: string,
    sources: AssistantKnowledgeQuestionSource[],
    onOpenSource: (source: AssistantSource) => void,
) {
    if (!answer) return <span className={styles.emptyAnswer}>服务未返回回答。</span>;
    return <ReactMarkdown
        remarkPlugins={[RemarkGfm]}
        skipHtml
        components={{
            a: ({href, children}) => {
                const citation = /^#knowledge-source-(\d+)$/.exec(href || "");
                const sourceIndex = citation ? Number(citation[1]) - 1 : -1;
                const source = sourceIndex >= 0 ? sources[sourceIndex] : undefined;
                if (source) {
                    if (isWebSource(source)) {
                        const externalUrl = safeExternalUrl(source.url);
                        if (externalUrl) {
                            return <a
                                href={externalUrl}
                                className={styles.answerReference}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`打开网页引用 [${citation?.[1]}] ${source.title || source.path}`}
                            >[{children}]</a>;
                        }
                        return <span className={styles.inertCitation}>[{children}]</span>;
                    }
                    return <button
                        type="button"
                        className={styles.answerReference}
                        onClick={() => onOpenSource(source)}
                        aria-label={`打开引用 [${citation?.[1]}] ${source.path}`}
                    >[{children}]</button>;
                }
                return <span className={citation ? styles.inertCitation : styles.inertLink}>{citation ? <>[{children}]</> : children}</span>;
            },
            img: () => null,
        }}
    >{linkifyCitationMarkers(answer)}</ReactMarkdown>;
}

function renderQuestionResult(
    question: AssistantKnowledgeQuestion,
    onOpenSource: (source: AssistantSource) => void,
    onReuseQuestion: (value: string) => void,
) {
    if (question.status === "queued" || question.status === "running") {
        return <div className={styles.pendingResult} role="status">
            {question.status === "queued" ? <SearchOutlined/> : <LoadingOutlined spin/>}
            <span>{question.web_search
                ? (question.status === "queued" ? "已排队，等待查询网页并生成回答" : "正在查询网页并生成回答…")
                : (question.status === "queued" ? "已排队，等待生成回答" : "正在生成回答…")}</span>
        </div>;
    }
    if (question.status === "insufficient") {
        return <div className={styles.insufficientResult} role="status"><WarningOutlined/><span>{question.answer || question.error || "现有已索引资料不足以回答这个问题。请补充资料或换个更具体的问题。"}</span></div>;
    }
    if (question.status === "failed") {
        return <div className={styles.failedResult} role="alert"><WarningOutlined/><span>{question.error || "回答失败，请稍后重试。"}</span><button type="button" className={styles.retryQuestionButton} onClick={() => onReuseQuestion(question.question)}>把问题填回输入框</button></div>;
    }
    if (question.status === "cancelled") {
        return <div className={styles.cancelledResult} role="status"><WarningOutlined/><span>{question.error || "这次问答已取消。"}</span></div>;
    }
    return renderAnswerResult(question, onOpenSource);
}

function renderAnswerResult(
    question: AssistantKnowledgeQuestion,
    onOpenSource: (source: AssistantSource) => void,
) {
    return <>
        <div className={styles.answerText}>{renderAnswer(question.answer, question.sources, onOpenSource)}</div>
        {question.sources.length > 0 && <div className={styles.evidenceList} aria-label="回答引用">
            {question.sources.map((source, index) => {
                const key = `${source.path}-${source.content_hash}-${source.line_start}-${index}`;
                if (isWebSource(source)) {
                    const externalUrl = safeExternalUrl(source.url);
                    const content = <>
                        <span className={styles.evidenceHeading}>
                            <strong>[{index + 1}]</strong>
                            <span title={source.title || source.path}>{source.title || source.path}</span>
                            <small>网页</small>
                        </span>
                        <span className={styles.webEvidenceMeta}><span>域名：{webSourceDomain(source)}</span><small>日期：{webSourceDate(source)}</small></span>
                        <span className={styles.evidenceText}>{source.text || "未提供摘录"}</span>
                        <LinkOutlined/>
                    </>;
                    return externalUrl
                        ? <a key={key} className={styles.evidenceCard} href={externalUrl} target="_blank" rel="noopener noreferrer" aria-label={`打开网页来源 ${source.title || source.path}`}>{content}</a>
                        : <div key={key} className={styles.evidenceCard} aria-label={`网页来源 ${source.title || source.path}`}>{content}</div>;
                }
                return <button
                    type="button"
                    className={styles.evidenceCard}
                    key={key}
                    onClick={() => onOpenSource(source)}
                >
                    <span className={styles.evidenceHeading}><strong>[{index + 1}]</strong><span title={source.path}>{source.path}</span><small>知识库 · {sourceLocation(source)}</small></span>
                    <span className={styles.evidenceText}>{source.text || "未提供摘录"}</span>
                    <FileTextOutlined/>
                </button>;
            })}
        </div>}
    </>;
}

export function KnowledgeQa({accountKey, onOpenSource, onError}: KnowledgeQaProps) {
    const [question, setQuestion] = useState("");
    const [questions, setQuestions] = useState<AssistantKnowledgeQuestion[]>([]);
    const [models, setModels] = useState<ChatModelOption[]>([]);
    const [selectedModel, setSelectedModel] = useState("");
    const [modelLoading, setModelLoading] = useState(true);
    const [modelError, setModelError] = useState("");
    const [webSearch, setWebSearch] = useState(false);
    const [webSearchAvailable, setWebSearchAvailable] = useState(false);
    const [webSearchCapabilityLoading, setWebSearchCapabilityLoading] = useState(true);
    const [webSearchCapabilityError, setWebSearchCapabilityError] = useState("");
    const [loadingQuestions, setLoadingQuestions] = useState(true);
    const [listError, setListError] = useState("");
    const [pollError, setPollError] = useState("");
    const [page, setPage] = useState(1);
    const [totalQuestions, setTotalQuestions] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const questionInputRef = useRef<HTMLTextAreaElement | null>(null);
    const mountedRef = useRef(false);
    const accountGenerationRef = useRef(0);
    const listGenerationRef = useRef(0);
    const submitInFlightRef = useRef(false);
    const uncertainRequestRef = useRef<{question: string; requestId: string; model: string; webSearch: boolean} | null>(null);
    const pageRef = useRef(1);
    const listControllerRef = useRef<AbortController | null>(null);
    const submitControllerRef = useRef<AbortController | null>(null);
    const pollControllerRef = useRef<AbortController | null>(null);
    const modelControllerRef = useRef<AbortController | null>(null);
    const capabilityControllerRef = useRef<AbortController | null>(null);
    const modelGenerationRef = useRef(0);
    const capabilityGenerationRef = useRef(0);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            accountGenerationRef.current += 1;
            listControllerRef.current?.abort();
            submitControllerRef.current?.abort();
            pollControllerRef.current?.abort();
            modelControllerRef.current?.abort();
            capabilityControllerRef.current?.abort();
        };
    }, []);

    const loadModels = useCallback(async () => {
        if (!mountedRef.current) return;
        modelControllerRef.current?.abort();
        const generation = modelGenerationRef.current + 1;
        modelGenerationRef.current = generation;
        const accountGeneration = accountGenerationRef.current;
        const controller = new AbortController();
        modelControllerRef.current = controller;
        setModelLoading(true);
        setModelError("");
        try {
            const result = await getModelCatalog(controller.signal);
            if (!mountedRef.current || controller.signal.aborted || generation !== modelGenerationRef.current || accountGeneration !== accountGenerationRef.current) return;
            setModels(result);
            setSelectedModel(previous => previous && result.some(model => model.id === previous) ? previous : result[0]?.id || "");
        } catch (error) {
            if (!mountedRef.current || controller.signal.aborted || generation !== modelGenerationRef.current || accountGeneration !== accountGenerationRef.current || isAbortError(error)) return;
            setModelError(errorMessage(error));
        } finally {
            if (modelControllerRef.current === controller) {
                modelControllerRef.current = null;
                if (mountedRef.current && generation === modelGenerationRef.current && accountGeneration === accountGenerationRef.current) setModelLoading(false);
            }
        }
    }, []);

    const loadCapabilities = useCallback(async () => {
        if (!mountedRef.current) return;
        capabilityControllerRef.current?.abort();
        const generation = capabilityGenerationRef.current + 1;
        capabilityGenerationRef.current = generation;
        const accountGeneration = accountGenerationRef.current;
        const controller = new AbortController();
        capabilityControllerRef.current = controller;
        setWebSearchCapabilityLoading(true);
        setWebSearchCapabilityError("");
        try {
            const result = await getAssistantKnowledgeCapabilities(controller.signal);
            if (!mountedRef.current || controller.signal.aborted || generation !== capabilityGenerationRef.current || accountGeneration !== accountGenerationRef.current) return;
            setWebSearchAvailable(result.web_search_available);
            setWebSearchCapabilityError(result.web_search_available ? "" : "当前未配置联网查询");
            if (!result.web_search_available) setWebSearch(false);
        } catch (error) {
            if (!mountedRef.current || controller.signal.aborted || generation !== capabilityGenerationRef.current || accountGeneration !== accountGenerationRef.current || isAbortError(error)) return;
            setWebSearchAvailable(false);
            setWebSearch(false);
            setWebSearchCapabilityError("联网查询暂不可用");
        } finally {
            if (capabilityControllerRef.current === controller) {
                capabilityControllerRef.current = null;
                if (mountedRef.current && generation === capabilityGenerationRef.current && accountGeneration === accountGenerationRef.current) setWebSearchCapabilityLoading(false);
            }
        }
    }, []);

    const loadQuestions = useCallback(async (requestedPage = pageRef.current) => {
        if (!mountedRef.current) return;
        const targetPage = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
        pageRef.current = targetPage;
        listControllerRef.current?.abort();
        pollControllerRef.current?.abort();
        const generation = listGenerationRef.current + 1;
        listGenerationRef.current = generation;
        const accountGeneration = accountGenerationRef.current;
        const controller = new AbortController();
        listControllerRef.current = controller;
        setLoadingQuestions(true);
        setListError("");
        setPollError("");
        setQuestions([]);
        try {
            const result = await getAssistantKnowledgeQuestions(controller.signal, targetPage, QUESTIONS_PAGE_SIZE);
            if (!mountedRef.current || controller.signal.aborted || generation !== listGenerationRef.current || accountGeneration !== accountGenerationRef.current) return;
            const serverPage = Math.max(1, Math.floor(result.page));
            pageRef.current = serverPage;
            setPage(serverPage);
            setTotalQuestions(Math.max(0, Math.floor(result.total)));
            setTotalPages(Math.max(1, Math.floor(result.total_pages)));
            setQuestions(result.questions);
            setPollError("");
        } catch (error) {
            if (!mountedRef.current || controller.signal.aborted || generation !== listGenerationRef.current || accountGeneration !== accountGenerationRef.current || isAbortError(error)) return;
            const message = errorMessage(error);
            setListError(message);
            onError?.(message);
        } finally {
            if (listControllerRef.current === controller) {
                listControllerRef.current = null;
                if (mountedRef.current && generation === listGenerationRef.current && accountGeneration === accountGenerationRef.current) setLoadingQuestions(false);
            }
        }
    }, [onError]);

    useEffect(() => {
        accountGenerationRef.current += 1;
        listControllerRef.current?.abort();
        submitControllerRef.current?.abort();
        pollControllerRef.current?.abort();
        modelControllerRef.current?.abort();
        capabilityControllerRef.current?.abort();
        submitInFlightRef.current = false;
        setQuestion("");
        setQuestions([]);
        setModels([]);
        setSelectedModel("");
        setModelLoading(true);
        setModelError("");
        setWebSearch(false);
        setWebSearchAvailable(false);
        setWebSearchCapabilityLoading(true);
        setWebSearchCapabilityError("");
        setLoadingQuestions(true);
        setListError("");
        setPollError("");
        pageRef.current = 1;
        setPage(1);
        setTotalQuestions(0);
        setTotalPages(1);
        setSubmitting(false);
        setSubmitError("");
        uncertainRequestRef.current = null;
        void loadModels();
        void loadCapabilities();
        void loadQuestions(1);
    }, [accountKey, loadCapabilities, loadModels, loadQuestions]);

    useEffect(() => {
        let timer: number | null = null;
        let controller: AbortController | null = null;
        const effectAccountGeneration = accountGenerationRef.current;
        const effectListGeneration = listGenerationRef.current;
        const effectPage = page;
        const isCurrentEffect = () => mountedRef.current
            && effectAccountGeneration === accountGenerationRef.current
            && effectListGeneration === listGenerationRef.current
            && effectPage === pageRef.current;

        const stop = () => {
            if (timer !== null) {
                window.clearTimeout(timer);
                timer = null;
            }
            if (controller) controller.abort();
            if (pollControllerRef.current === controller) pollControllerRef.current = null;
            controller = null;
        };

        const schedule = () => {
            if (!isCurrentEffect() || document.visibilityState !== "visible" || !questions.some(isPending)) return;
            if (timer !== null) window.clearTimeout(timer);
            timer = window.setTimeout(() => void poll(), 2000);
        };

        const poll = async () => {
            timer = null;
            if (!isCurrentEffect() || document.visibilityState !== "visible") return;
            const pendingQuestions = questions.filter(isPending);
            if (pendingQuestions.length === 0) return;
            const requestController = new AbortController();
            controller = requestController;
            pollControllerRef.current = requestController;
            const results = await Promise.allSettled(pendingQuestions.map(item => getAssistantKnowledgeQuestion(item.id, requestController.signal)));
            if (isCurrentEffect() && !requestController.signal.aborted) {
                const updated = new Map<string, AssistantKnowledgeQuestion>();
                results.forEach(result => {
                    if (result.status === "fulfilled") updated.set(result.value.id, result.value);
                });
                if (updated.size > 0) {
                    setPollError("");
                    setQuestions(previous => isCurrentEffect()
                        ? previous.map(item => updated.get(item.id) || item)
                        : previous);
                } else if (results.length > 0) {
                    setPollError("读取进度失败，可刷新记录");
                }
            }
            if (pollControllerRef.current === requestController) pollControllerRef.current = null;
            if (controller === requestController) controller = null;
            if (isCurrentEffect() && document.visibilityState === "visible") schedule();
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") schedule();
            else stop();
        };

        schedule();
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            stop();
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [accountKey, page, questions]);

    useEffect(() => {
        if (webSearch && (!webSearchAvailable || !isDeepSeekModel(models.find(model => model.id === selectedModel)))) {
            setWebSearch(false);
        }
    }, [models, selectedModel, webSearch, webSearchAvailable]);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const value = question.trim();
        if (!value || value.length > MAX_QUESTION_LENGTH || !selectedModel || submitInFlightRef.current) return;
        submitInFlightRef.current = true;
        const accountGeneration = accountGenerationRef.current;
        const controller = new AbortController();
        submitControllerRef.current = controller;
        const retainedRequest = uncertainRequestRef.current;
        const requestId = retainedRequest?.question === value
            && retainedRequest.model === selectedModel
            && retainedRequest.webSearch === webSearch
            ? retainedRequest.requestId
            : createRequestId();
        let transportFailure = false;
        setSubmitting(true);
        setSubmitError("");
        try {
            try {
                await createAssistantKnowledgeQuestion(value, requestId, controller.signal, selectedModel, webSearch);
            } catch (error) {
                if (controller.signal.aborted || !shouldRetryTransport(error)) throw error;
                try {
                    await createAssistantKnowledgeQuestion(value, requestId, controller.signal, selectedModel, webSearch);
                } catch (retryError) {
                    transportFailure = true;
                    throw retryError;
                }
            }
            if (!mountedRef.current || controller.signal.aborted || accountGeneration !== accountGenerationRef.current) return;
            uncertainRequestRef.current = null;
            setQuestion("");
            pageRef.current = 1;
            setPage(1);
            await loadQuestions(1);
        } catch (error) {
            if (!mountedRef.current || controller.signal.aborted || accountGeneration !== accountGenerationRef.current || isAbortError(error)) return;
            uncertainRequestRef.current = transportFailure ? {question: value, requestId, model: selectedModel, webSearch} : null;
            const message = errorMessage(error);
            setSubmitError(message);
            onError?.(message);
        } finally {
            if (submitControllerRef.current === controller) submitControllerRef.current = null;
            submitInFlightRef.current = false;
            if (mountedRef.current && accountGeneration === accountGenerationRef.current) setSubmitting(false);
        }
    }

    function reuseQuestion(value: string) {
        setQuestion(value);
        setSubmitError("");
        window.setTimeout(() => questionInputRef.current?.focus(), 0);
    }

    function updateQuestion(value: string) {
        setQuestion(value);
        if (uncertainRequestRef.current && uncertainRequestRef.current.question !== value.trim()) uncertainRequestRef.current = null;
    }

    function updateModel(value: string) {
        setSelectedModel(value);
        if (uncertainRequestRef.current && uncertainRequestRef.current.model !== value) uncertainRequestRef.current = null;
        if (!isDeepSeekModel(models.find(model => model.id === value))) setWebSearch(false);
    }

    function updateWebSearch(value: boolean) {
        const allowed = webSearchAvailable && isDeepSeekModel(models.find(model => model.id === selectedModel));
        const nextValue = allowed && value;
        setWebSearch(nextValue);
        if (uncertainRequestRef.current && uncertainRequestRef.current.webSearch !== nextValue) uncertainRequestRef.current = null;
    }

    function changePage(nextPage: number) {
        if (loadingQuestions) return;
        const targetPage = Math.max(1, Math.min(totalPages, Math.floor(nextPage)));
        if (targetPage === page) return;
        pageRef.current = targetPage;
        setPage(targetPage);
        void loadQuestions(targetPage);
    }

    const selectedModelOption = models.find(model => model.id === selectedModel);
    const webSearchModelSupported = isDeepSeekModel(selectedModelOption);
    const webSearchDisabled = submitting || webSearchCapabilityLoading || !webSearchAvailable || !webSearchModelSupported;
    const webSearchHint = !selectedModel
        ? "选择 DeepSeek 模型后可用"
        : !webSearchModelSupported
            ? "仅 DeepSeek 模型支持联网查询"
            : webSearchCapabilityLoading
                ? "正在检查联网查询"
                : webSearchAvailable
                    ? "使用 DeepSeek 搜索公开网页"
                    : webSearchCapabilityError || "当前未配置联网查询";

    return <article className={styles.card} aria-busy={loadingQuestions || submitting}>
        <div className={styles.cardHeader}>
            <div className={styles.cardHeading}>
                <span className={styles.kicker}><QuestionCircleOutlined/>知识库问答</span>
                <h3>向你的资料提问</h3>
                <p>{webSearch
                    ? "同时检索网页与知识库；问题会用于联网检索，搜索与回答均按模型用量计费。搜索摘要由 DeepSeek 整理，可打开网页核对。"
                    : "基于已索引资料回答，引用可核对原文；使用所选模型，按聊天用量计费。每个问题独立检索，不会自动带入上一问的上下文。"}</p>
            </div>
            <span className={styles.headerIcon}><BookOutlined/></span>
        </div>
        <form className={styles.form} onSubmit={submit}>
            <label className={styles.label} htmlFor="knowledge-question">问题</label>
            <div className={styles.inputRow}>
                <textarea
                    ref={questionInputRef}
                    id="knowledge-question"
                    value={question}
                    onChange={event => updateQuestion(event.target.value)}
                    placeholder="例如：项目的发布流程有哪些步骤？"
                    maxLength={MAX_QUESTION_LENGTH}
                    rows={3}
                    disabled={submitting}
                />
                <div className={styles.actionColumn}>
                    <label className={styles.modelLabel} htmlFor="knowledge-question-model">回答模型</label>
                    {models.length > 0 ? <select
                        id="knowledge-question-model"
                        className={styles.modelSelect}
                        value={selectedModel}
                        onChange={event => updateModel(event.target.value)}
                        disabled={submitting}
                    >{models.map(model => <option key={model.id} value={model.id}>{model.displayName || model.id}</option>)}</select> : <div className={styles.modelUnavailable}>{modelLoading ? <><LoadingOutlined spin/>读取模型目录</> : <><WarningOutlined/>暂无可用模型</>}</div>}
                    <label className={styles.webSearchOption}>
                        <span className={styles.webSearchControl}>
                            <input
                                type="checkbox"
                                checked={webSearch}
                                onChange={event => updateWebSearch(event.target.checked)}
                                disabled={webSearchDisabled}
                            />
                            <GlobalOutlined/>
                            <span>联网查询</span>
                        </span>
                        {webSearchHint && <small>{webSearchHint}</small>}
                    </label>
                    <button type="submit" className={styles.submitButton} disabled={submitting || !question.trim() || !selectedModel}>
                        {submitting ? <LoadingOutlined spin/> : <SearchOutlined/>}
                        {submitting ? "检索中" : "问知识库"}
                    </button>
                </div>
            </div>
            <div className={styles.formMeta}><span>{webSearch ? "同时检索网页与知识库；问题会用于联网检索，搜索与回答均按模型用量计费。" : "回答只使用已索引的知识库资料"}</span><span>{question.length} / {MAX_QUESTION_LENGTH}</span></div>
            {modelError && <div className={styles.modelError} role="alert"><WarningOutlined/><span>{models.length > 0 ? "模型目录刷新失败，仍可使用当前已选模型。" : "模型目录加载失败，暂时无法发起新的问答。已有回答仍可查看。"}</span><button type="button" onClick={() => void loadModels()} disabled={modelLoading}>{modelLoading ? <LoadingOutlined spin/> : <ReloadOutlined/>}重试</button></div>}
            {submitError && <div className={styles.failedResult} role="alert"><WarningOutlined/><span>{submitError}</span></div>}
        </form>
        <div className={styles.historyHeading}>
            <span><CheckCircleFilled/>最近问答</span>
            <div className={styles.historyActions}>
                <small>共 {totalQuestions} 条</small>
                <div className={styles.paginationControls} aria-label="问答记录分页">
                    <button
                        type="button"
                        className={styles.pageButton}
                        onClick={() => changePage(page - 1)}
                        disabled={loadingQuestions || page <= 1}
                        aria-label="上一页"
                    ><LeftOutlined/><span>上一页</span></button>
                    <span className={styles.pageIndicator} aria-live="polite">第 {page} / {totalPages} 页</span>
                    <button
                        type="button"
                        className={styles.pageButton}
                        onClick={() => changePage(page + 1)}
                        disabled={loadingQuestions || page >= totalPages}
                        aria-label="下一页"
                    ><span>下一页</span><RightOutlined/></button>
                </div>
            </div>
        </div>
        {loadingQuestions && questions.length === 0 && <div className={styles.loadingState} role="status"><LoadingOutlined spin/>读取最近问答</div>}
        {!loadingQuestions && listError && <div className={styles.listError} role="alert"><WarningOutlined/><span>{listError}</span><button type="button" onClick={() => void loadQuestions(pageRef.current)}><ReloadOutlined/>重试</button></div>}
        {pollError && questions.some(isPending) && <div className={styles.listError} role="alert"><WarningOutlined/><span>{pollError}</span><button type="button" onClick={() => void loadQuestions(pageRef.current)}><ReloadOutlined/>刷新记录</button></div>}
        {!loadingQuestions && !listError && questions.length === 0 && <div className={styles.emptyState}><QuestionCircleOutlined/><span>还没有问答记录，先向已索引的资料提一个问题。</span></div>}
        {questions.length > 0 && <div className={styles.historyList}>
            {questions.map(item => <article className={styles.historyItem} key={item.id}>
                <div className={styles.historyMeta}><span className={styles.historyBadges}><span className={`${styles.status} ${styles[`status_${item.status}`] || ""}`}>{isPending(item) && <LoadingOutlined spin/>}{statusLabel(item.status)}</span>{item.web_search && <span className={styles.webSearchBadge}><GlobalOutlined/>联网查询</span>}</span><time dateTime={item.created_at || undefined}>{formatDate(item.created_at)}</time></div>
                <h4>{item.question}</h4>
                <div className={styles.result}>{renderQuestionResult(item, onOpenSource, reuseQuestion)}</div>
            </article>)}
        </div>}
    </article>;
}

export default KnowledgeQa;

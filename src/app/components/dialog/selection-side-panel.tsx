import {useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent} from "react";
import {Markdown} from "@/app/components/markdown/markdown";
import {displayAssistantContent} from "./message-display";
import {ChatQuote, Message, MessageRole, MessageStatus} from "@/types/chat";
import styles from "./selection-side-panel.module.scss";

export interface SelectionSidePanelProps {
    quote: ChatQuote;
    messages: Message[];
    onSubmit: (text: string, quote: ChatQuote) => Promise<unknown>;
    onClose: () => void;
    busy: boolean;
    modelLabel: string;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    return "提交失败，请稍后重试。";
}

export function SelectionSidePanel(props: SelectionSidePanelProps) {
    const {quote, messages, onSubmit, onClose, busy, modelLabel} = props;
    const [draft, setDraft] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const draftRevisionRef = useRef(0);
    const submitInFlightRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const displayModelLabel = modelLabel.trim() || "当前模型";

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    const updateDraft = (value: string) => {
        draftRevisionRef.current += 1;
        setDraft(value);
        if (error) setError("");
    };

    const submit = async () => {
        if (!draft.trim() || busy || submitInFlightRef.current) return;

        const submittedDraft = draft;
        const submittedRevision = draftRevisionRef.current;
        submitInFlightRef.current = true;
        setSubmitting(true);
        setError("");
        try {
            await onSubmit(submittedDraft, quote);
            if (draftRevisionRef.current === submittedRevision) setDraft("");
        } catch (cause) {
            setError(getErrorMessage(cause));
        } finally {
            submitInFlightRef.current = false;
            setSubmitting(false);
        }
    };

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void submit();
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat) return;
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
        }
    };

    const submitDisabled = busy || submitting || !draft.trim();

    return (
        <aside className={styles.panel} aria-label="侧边提问" aria-busy={busy || submitting}>
            <header className={styles.header}>
                <div className={styles.heading}>
                    <strong>侧边提问</strong>
                    <span>继续当前对话</span>
                </div>
                <button type="button" className={styles.close} onClick={onClose} aria-label="关闭侧边提问">
                    <span aria-hidden="true">×</span>
                </button>
            </header>

            <div className={styles.content}>
                <div className={styles.context}>
                    <section className={styles.quoteSection} aria-label="已选择的引用">
                        <div className={styles.sectionLabel}>引用消息</div>
                        <blockquote className={styles.quote}>{quote.text}</blockquote>
                    </section>

                    {messages.length > 0 ? (
                        <section className={styles.messagesSection} aria-label="新增对话">
                            <div className={styles.sectionLabel}>新增对话</div>
                            <div className={styles.messageList}>
                                {messages.map((message) => {
                                    const isAssistant = message.role === MessageRole.assistant;
                                    const assistantContent = isAssistant
                                        ? displayAssistantContent(message.content).content
                                        : "";
                                    return (
                                        <article
                                            className={`${styles.message} ${isAssistant ? styles.assistantMessage : styles.userMessage}`}
                                            key={message.id}
                                        >
                                            <div className={styles.messageMeta}>
                                                <span>{isAssistant ? displayModelLabel : "你"}</span>
                                            </div>
                                            <div className={styles.messageBody}>
                                                {isAssistant ? (
                                                    <Markdown content={assistantContent} fontSize={13} loading={message.status === MessageStatus.Sending && !assistantContent} />
                                                ) : (
                                                    <p>{message.content}</p>
                                                )}
                                            </div>
                                            {message.error && <p className={styles.error} role="alert">{message.error}</p>}
                                        </article>
                                    );
                                })}
                            </div>
                        </section>
                    ) : (
                        <p className={styles.emptyMessages}>暂无新增消息</p>
                    )}
                </div>

                <form className={styles.composer} onSubmit={handleSubmit}>
                    {error && <div className={styles.error} role="alert">{error}</div>}
                    <p className={styles.note}>
                        使用当前模型和预算，提问与回答会保留在当前对话中。
                    </p>
                    <label className={styles.inputLabel} htmlFor="selection-side-question">你的问题</label>
                    <textarea
                        ref={textareaRef}
                        id="selection-side-question"
                        className={styles.textarea}
                        value={draft}
                        onChange={(event) => updateDraft(event.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="围绕这段内容继续提问…"
                        rows={4}
                        autoFocus
                    />
                    <div className={styles.actions}>
                        <span className={styles.shortcut}>⌘/Ctrl + Enter 提交</span>
                        <button type="submit" className={styles.submit} disabled={submitDisabled}>
                            {submitting ? "提交中…" : busy ? "当前对话运行中" : "提问"}
                        </button>
                    </div>
                </form>
            </div>
        </aside>
    );
}

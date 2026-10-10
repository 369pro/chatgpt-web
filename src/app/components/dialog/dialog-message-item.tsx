import {displayAssistantContent} from './message-display';
import styles from './dialog-message-item.module.scss'
import {createPortal} from 'react-dom';
import {Avatar, Space} from "antd";
import {Message, MessageRole, MessageStatus} from "@/types/chat";
import {CSSProperties, RefObject, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Markdown} from '@/app/components/markdown/markdown';
import {CopyOutlined, DeleteOutlined, LoadingOutlined, SyncOutlined} from '@ant-design/icons'
import {ChatAction} from './dialog-message-actions'
import dayjs from 'dayjs'
import {AgentChatSession, userChatStore} from '@/app/store/agent-chat-store';
import {copyToClipboard} from '@/utils'
import {DialogChatQuote, asDialogMessage} from './dialog-chat-types';

/**
 * 用对象封装属性，方便扩展
 */
interface Props {
    message: Message;
    parentRef?: RefObject<HTMLDivElement>;
    onQuote?: (quote: DialogChatQuote) => void;
    onSideQuestion?: (quote: DialogChatQuote) => void;
}

interface SelectionOffer {
    text: string;
    left: number;
    top: number;
    bottom: number;
}

function asElement(node: Node | null): Element | null {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
}

function safeExternalUrl(value: string): string | null {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
        return null;
    }
}

function sourceList(message: Message, currentSession: AgentChatSession) {
    if (message.role !== MessageRole.assistant) return [];
    const extras = asDialogMessage(message);
    if (Array.isArray(extras.sources) && extras.sources.length) return extras.sources;
    if (message.runId) {
        const run = currentSession.runs.find((candidate) => candidate.run_id === message.runId);
        if (run?.sources?.length) return run.sources;
    }
    return [];
}

function searchProgressLabel(message: Message, currentSession: AgentChatSession): string | null {
    if (message.role !== MessageRole.assistant) return null;
    const extras = asDialogMessage(message);
    const run = message.runId ? currentSession.runs.find((candidate) => candidate.run_id === message.runId) : undefined;
    const status = extras.searchProgress ?? extras.search_progress ?? run?.search_status;
    if (status === "failed") return "联网检索失败，请重试";
    if (status === "searching" || (message.status === MessageStatus.Sending && currentSession.config.webSearch)) {
        return "正在联网检索…";
    }
    return null;
}

/**
 * 对话面板消息元素
 * @constructor
 */
export function DialogMessageItem(props: Props) {
    const {message, parentRef, onQuote, onSideQuestion} = props;
    const chatStore = userChatStore();
    const currentSession = chatStore.currentSession();
    const messageScopeRef = useRef<HTMLDivElement>(null);
    const [selectionOffer, setSelectionOffer] = useState<SelectionOffer | null>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const detailsRef = useRef<HTMLDialogElement>(null);
    const [details, setDetails] = useState<string | null>(null);
    const extras = asDialogMessage(message);
    const isUser = message.role === MessageRole.user;
    const display = isUser ? {content: message.content, hasSearchSummary: false} : displayAssistantContent(message.content);
    const retryDisabled = Boolean(currentSession.activeRunId);
    const deleteDisabled = Boolean(currentSession.activeRunId)
        || !currentSession.serverMessageIds[message.id];
    const canQuote = Boolean(currentSession.serverMessageIds[message.id]) && message.status !== MessageStatus.Sending;
    const isRetryable = !isUser && (
        message.status === MessageStatus.Error ||
        message.status === MessageStatus.Cancelled
    );
    const date = message?.time ? dayjs(message.time).format('YYYY/MM/DD HH:mm:ss') : ''
    const retryHandle = () => {
        void chatStore.onRetry(message.id)
    }
    const copyHandle = async () => {
        copyToClipboard(display.content)
    }
    const deleteHandle = async () => {
        try {
            await chatStore.deleteMessage(message);
        } catch {
            // The dialog-level error banner displays the server error.
        }
    }

    const updateSelectionOffer = () => {
        const scope = messageScopeRef.current;
        if (!canQuote) {
            setSelectionOffer(null);
            return;
        }
        const selection = window.getSelection();
        if (!scope || !selection || selection.isCollapsed || !selection.toString().trim()) {
            setSelectionOffer(null);
            return;
        }
        const anchor = asElement(selection.anchorNode);
        const focus = asElement(selection.focusNode);
        if (!anchor || !focus || !scope.contains(anchor) || !scope.contains(focus)) {
            setSelectionOffer(null);
            return;
        }
        const text = selection.toString().trim().slice(0, 4000);
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (!text || (!rect.width && !rect.height)) {
            setSelectionOffer(null);
            return;
        }
        setSelectionOffer({text, left: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom});
    };

    useLayoutEffect(() => {
        const toolbar = toolbarRef.current;
        if (!toolbar || !selectionOffer) return;
        const rect = toolbar.getBoundingClientRect();
        toolbar.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, selectionOffer.left - rect.width / 2))}px`;
        toolbar.style.top = `${selectionOffer.top >= rect.height + 16
            ? selectionOffer.top - rect.height - 10
            : Math.min(window.innerHeight - rect.height - 8, selectionOffer.bottom + 10)}px`;
    }, [selectionOffer]);

    useEffect(() => {
        const dismiss = () => setSelectionOffer(null);
        const handleSelectionChange = () => {
            const selection = window.getSelection();
            const scope = messageScopeRef.current;
            const anchor = asElement(selection?.anchorNode || null);
            if (!selection?.toString().trim() || !scope || !anchor || !scope.contains(anchor)) dismiss();
        };
        const handlePointerDown = (event: PointerEvent) => {
            if (!toolbarRef.current?.contains(event.target as Node)) dismiss();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") dismiss();
        };
        document.addEventListener("selectionchange", handleSelectionChange);
        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("scroll", dismiss, true);
        window.addEventListener("resize", dismiss);
        return () => {
            document.removeEventListener("selectionchange", handleSelectionChange);
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("scroll", dismiss, true);
            window.removeEventListener("resize", dismiss);
        };
    }, []);

    useEffect(() => {
        if (details && detailsRef.current && !detailsRef.current.open) detailsRef.current.showModal();
    }, [details]);

    const quote = selectionOffer;
    const finishSelection = () => {
        setSelectionOffer(null);
        window.getSelection()?.removeAllRanges();
    };
    const quoteHandle = () => {
        if (!quote || !onQuote) return;
        onQuote({message_id: message.id, text: quote.text});
        finishSelection();
    };

    const progress = searchProgressLabel(message, currentSession);
    const sources = sourceList(message, currentSession).flatMap((source) => {
        const url = safeExternalUrl(source.url);
        return url ? [{...source, url}] : [];
    });

    return <>
        <div
            id={`dialog-message-${encodeURIComponent(message.id)}`}
            data-message-id={message.id}
            tabIndex={-1}
            className={
                isUser ? styles["chat-message-user"] : styles["chat-message"]
            }
        >
            <div className={styles["chat-message-container"]}>
                <div className={styles["chat-message-header"]}>
                    <div className={styles["chat-message-avatar"]}>
                        <Avatar shape="square" src={message.avatar} size={30} style={{
                            borderRadius: '4px',
                            backgroundColor: '#f6f6f6'
                        }}/>

                    </div>
                    <div className={styles['chat-message-edit']}>
                        <Space>
                            {isRetryable && <ChatAction icon={<SyncOutlined/>} text="重新发送" disabled={retryDisabled} onClick={retryHandle}/>} 
                            <ChatAction icon={<CopyOutlined/>} text="复制" onClick={copyHandle}/>
                            <ChatAction icon={<DeleteOutlined/>} text="删除" disabled={deleteDisabled} onClick={deleteHandle}/>
                        </Space>
                    </div>
                </div>
                {isUser && extras.quotes?.length ? <div className={styles.messageQuotes} aria-label="本条消息引用">
                    {extras.quotes.map((quote, index) => <blockquote key={`${quote.message_id}-${index}`}>{quote.text}</blockquote>)}
                </div> : null}
                {isUser && extras.attachments?.length ? <div className={styles.messageAttachments} aria-label="本条消息引用的文件">
                    {extras.attachments.map((attachment) => <span key={attachment.id}><span aria-hidden="true">📎</span>{attachment.filename}</span>)}
                </div> : null}
                <div
                    ref={messageScopeRef}
                    className={styles["chat-message-item"]}
                    onMouseUp={updateSelectionOffer}
                    onKeyUp={updateSelectionOffer}
                >
                    <Markdown
                        content={display.content}
                        fontSize={14}
                        parentRef={parentRef}
                        defaultShow={false}
                        loading={message.status === MessageStatus.Sending && !isUser}
                    />
                    {progress && <div className={styles.searchProgress} role="status" aria-live="polite">
                        {progress.startsWith("正在") && <LoadingOutlined spin />}
                        <span>{progress}</span>
                    </div>}
                    {message.status === MessageStatus.Error && (
                        <div className={`${styles['chat-message-status']} ${styles.error}`} role="alert">
                            {message.error || "生成失败，请重试"}
                        </div>
                    )}
                    {message.status === MessageStatus.Cancelled && (
                        <div className={`${styles['chat-message-status']} ${styles.cancelled}`} role="status">
                            {message.error || "已停止生成"}
                        </div>
                    )}
                    {!isUser && display.hasSearchSummary && <p className={styles.summaryNotice}>此回答部分内容来自检索摘要，尚未逐项核对原文。</p>}
                    {!isUser && sources.length > 0 && <div className={styles.sources} aria-label="联网来源">
                        <div className={styles.sourcesHeading}>来源</div>
                        {sources.map((source, index) => <a
                            key={`${source.id}-${index}`}
                            className={styles.source}
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <span className={styles.sourceTitle}><span className={styles.sourceId}>[{source.id}]</span> {source.title?.trim() || new URL(source.url).hostname}</span>
                            {source.snippet && <span className={styles.sourceSnippet}>{source.snippet}</span>}
                        </a>)}
                    </div>}

                </div>
                <div className={styles['date']}>{date}</div>
            </div>
        </div>
        {quote && onQuote && canQuote && createPortal(
            <div ref={toolbarRef} className={styles.selectionToolbar} role="toolbar" aria-label="选中文字操作"
                 style={{left: quote.left, top: quote.top} as CSSProperties}
                 onPointerDown={(event) => event.preventDefault()}
                 onKeyDown={(event) => {
                     const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
                     const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                     if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                         event.preventDefault();
                         buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
                     }
                 }}>
                <button type="button" onClick={quoteHandle}>添加到对话</button>
                <button type="button" onClick={() => { setDetails(quote.text); finishSelection(); }}>更多详情</button>
                {onSideQuestion && <button type="button" onClick={() => {
                    onSideQuestion({message_id: message.id, text: quote.text});
                    finishSelection();
                }}>在侧边聊天中提问</button>}
            </div>, document.body)}
        {details !== null && createPortal(<dialog ref={detailsRef} className={styles.selectionDetails}
            onCancel={() => setDetails(null)} onClick={(event) => { if (event.target === event.currentTarget) setDetails(null); }}>
            <header><h3>选文详情</h3><button type="button" autoFocus aria-label="关闭选文详情" onClick={() => setDetails(null)}>×</button></header>
            <p className={styles.detailsMeta}>{isUser ? '你的提问' : '助手回答'} · {date}</p>
            <blockquote>{details}</blockquote>
            <footer><button type="button" onClick={() => { onQuote?.({message_id: message.id, text: details}); setDetails(null); }}>添加到对话</button></footer>
        </dialog>, document.body)}
    </>
}

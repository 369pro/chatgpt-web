import {useLocation, useParams, useOutletContext} from 'react-router-dom';
import {Fragment, useEffect, useState} from "react";
import styles from "./dialog-message.module.scss";
import {DialogMessageItem} from "@/app/components/dialog/dialog-message-item";
import {MessageRole} from "@/types/chat";
import {DialogMessageInput} from "@/app/components/dialog/dialog-message-input";
import {createNewMessage, userChatStore} from "@/app/store/agent-chat-store";
import {AgentRunStatus} from "@/apis";
import userScrollToBottom from '@/app/hooks/useScrollToBottom';
import {SessionContextPanel} from "./session-context-panel";
import {orderQueuedRuns, queueHead, queuePosition} from "@/app/store/agent-run-queue";
import {DialogChatQuote} from "./dialog-chat-types";
import {SelectionSidePanel} from "./selection-side-panel";
import {DialogMessageMinimap} from "./dialog-message-minimap";

interface Props {
    id: string,
    title: string
}

function runStatusLabel(status: AgentRunStatus): string {
    switch (status) {
        case "queued": return "已排队";
        case "running": return "正在运行";
        case "succeeded": return "已完成";
        case "failed": return "运行失败";
        case "cancelled": return "已停止";
        case "budget_exhausted": return "额度受限，已停止";
        case "interrupted": return "服务中断，可重试";
    }
}

/**
 * 聊天面板
 * @constructor
 */
export function DialogMessage() {
    const {id} = useParams();
    const {showSessions} = useOutletContext<{showSessions: () => void}>();
    const chatStore = userChatStore();
    const selectSessionById = userChatStore((state) => state.selectSessionById);
    const currentSession = chatStore.currentSession();
    const latestRun = currentSession.latestRun;
    const queueRuns = orderQueuedRuns(currentSession.runs.filter((run) => !["succeeded", "failed", "cancelled", "budget_exhausted", "interrupted"].includes(run.status)));
    const queueHeadRun = queueHead(queueRuns, currentSession.activeRunId);
    const error = chatStore.error;
    const location = useLocation();
    const {scrollRef, setAutoScroll, scrollToBottom} = userScrollToBottom();
    const [contextOpen, setContextOpen] = useState(false);
    const [sideQuestion, setSideQuestion] = useState<{quote: DialogChatQuote; existingIds: string[]} | null>(null);
    const [quotes, setQuotes] = useState<DialogChatQuote[]>([]);
    const readOnlyKnowledgeSession = currentSession.kind === "knowledge";
    const title = currentSession.dialog.title || location.state?.title || "新的对话";

    useEffect(() => {
        if (id) selectSessionById(id);
    }, [id, selectSessionById]);

    useEffect(() => {
        setAutoScroll(true);
        scrollToBottom();
    }, [currentSession.id, setAutoScroll, scrollToBottom]);

    useEffect(() => {
        setContextOpen(false);
        setSideQuestion(null);
        setQuotes([]);
    }, [currentSession.id]);

    // 输入事件
    const onEnter = async (value: string, nextQuotes: DialogChatQuote[] = [], attachmentIds: string[] = []) => {
        if (!value.trim() || readOnlyKnowledgeSession) return null;
        let targetSessionId = currentSession.id;
        if (!targetSessionId) {
            try {
                targetSessionId = (await chatStore.openSession()).id;
            } catch {
                return null;
            }
        }
        setAutoScroll(true);
        scrollToBottom();
        const newMessage = {
            ...createNewMessage(value, MessageRole.user),
            ...(nextQuotes.length ? {quotes: nextQuotes.slice(0, 5)} : {}),
            ...(attachmentIds.length ? {attachmentIds: attachmentIds.slice()} : {}),
        };
        const sentQuoteKey = nextQuotes.map((quote) => `${quote.message_id}:${quote.text}`).join("\u0001");
        setQuotes((current) => {
            const currentQuoteKey = current.map((quote) => `${quote.message_id}:${quote.text}`).join("\u0001");
            return currentQuoteKey === sentQuoteKey ? [] : current;
        });
        await chatStore.onSendMessage(newMessage);
        return targetSessionId;
    }

    const addQuote = (quote: DialogChatQuote) => {
        setQuotes((current) => {
            if (current.some((item) => item.message_id === quote.message_id && item.text === quote.text)) return current;
            return current.length >= 5 ? current : [...current, quote];
        });
    };

    const contextBoundaryIndex = currentSession.contextResetAfterSeq == null
        ? -1
        : currentSession.messages.reduce((lastIndex, message, index) => {
            const seq = currentSession.messageSeqs[message.id];
            return typeof seq === "number" && seq <= currentSession.contextResetAfterSeq!
                ? index
                : lastIndex;
        }, -1);

    return (
        <div className={styles.wrapper}>
            <div className={styles.header}>
                <button className={styles.back} onClick={showSessions} aria-label="返回会话列表"><span aria-hidden="true">‹</span> 对话</button>
            <div className={styles.heading}><strong>{title}</strong><span>{currentSession.config.mode === "research" ? "研究模式" : "智能对话"}</span></div>
                <button type="button" className={styles.contextToggle} aria-expanded={contextOpen} onClick={() => setContextOpen(value => !value)}>上下文</button>
            </div>
            {contextOpen && <SessionContextPanel sessionId={currentSession.id} runs={currentSession.runs} activeRunId={currentSession.activeRunId} onClose={() => setContextOpen(false)} />}
            {readOnlyKnowledgeSession && <div className={styles.readOnlyBanner} role="status">
                <span>这是知识库会话，只读保留历史记录。</span>
                <a href="#/assistant">前往个人助理</a>
            </div>}
            {error && <div className={styles.runStatus} role="alert">{error}</div>}
            {latestRun && <div className={styles.runStatus} role="status">
                {runStatusLabel(latestRun.status)}
                {latestRun.spent_amount != null ? ` · 已用 ¥${latestRun.spent_amount}` : ""}
            </div>}
            {queueRuns.length > 0 && <div className={styles.queueStatus} role="status" aria-label="运行队列">
                <span>运行队列</span>
                <div className={styles.queueItems}>{queueRuns.map((run) => {
                    const position = queuePosition(run, queueHeadRun?.run_id);
                    const label = run.run_id === queueHeadRun?.run_id
                        ? "队头"
                        : position == null ? "排队" : `排队 ${position}`;
                    return <span className={styles.queueItem} key={run.run_id}><strong>{label}</strong> {runStatusLabel(run.status)}<button type="button" onClick={() => void chatStore.cancelRun(run.run_id, currentSession.id)} aria-label={`取消运行 ${position == null ? run.run_id.slice(0, 8) : `第 ${position} 项`}`}>取消</button></span>;
                })}</div>
            </div>}
            <DialogMessageMinimap messages={currentSession.messages || []} scrollRef={scrollRef}/>
            <div className={styles.scroll} ref={scrollRef} role="region" aria-label="对话消息" tabIndex={0}
                 onScroll={(event) => {
                     const element = event.currentTarget;
                     setAutoScroll(element.scrollHeight - element.scrollTop - element.clientHeight < 48);
                 }}>
                {currentSession.messages?.map(
                    (message, index) => {
                        const shouldShowContextDivider = index === contextBoundaryIndex;
                        return <Fragment key={message.id}>
                            <DialogMessageItem message={message} parentRef={scrollRef} onQuote={readOnlyKnowledgeSession ? undefined : addQuote}
                                onSideQuestion={readOnlyKnowledgeSession ? undefined : (quote) => setSideQuestion({quote, existingIds: currentSession.messages.map(item => item.id)})}/>
                            {shouldShowContextDivider && <ClearContextDivider/>}
                        </Fragment>
                    })
                }
            </div>
            {sideQuestion && <SelectionSidePanel
                quote={sideQuestion.quote}
                messages={currentSession.messages.filter(item => !sideQuestion.existingIds.includes(item.id))}
                busy={Boolean(currentSession.activeRunId)}
                modelLabel={currentSession.config.gptVersion}
                onClose={() => setSideQuestion(null)}
                onSubmit={(text, quote) => onEnter(text, [quote])}
            />}
            {!readOnlyKnowledgeSession && <DialogMessageInput
                onEnter={onEnter}
                quotes={quotes}
                onRemoveQuote={(quote) => setQuotes((current) => current.filter((item) => item !== quote))}
            />}
        </div>
    );

}

/**
 * 清除上下文对话信息
 * @constructor
 */
function ClearContextDivider() {
    return (
        <div className={styles["clear-context"]} role="note">
            <div className={styles["clear-context-tips"]}>上下文已重置，早期历史仍保留</div>
        </div>
    );
}

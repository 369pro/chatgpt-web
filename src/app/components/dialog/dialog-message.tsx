import {useLocation, useParams, useOutletContext} from 'react-router-dom';
import {Fragment, useEffect} from "react";
import styles from "./dialog-message.module.scss";
import {DialogMessageItem} from "@/app/components/dialog/dialog-message-item";
import {MessageRole} from "@/types/chat";
import {DialogMessageInput} from "@/app/components/dialog/dialog-message-input";
import {createNewMessage, userChatStore} from "@/app/store/chat-store";
import userScrollToBottom from '@/app/hooks/useScrollToBottom';

interface Props {
    id: string,
    title: string
}

/**
 * 聊天面板
 * @constructor
 */
export function DialogMessage() {
    const {id} = useParams();
    const {showSessions} = useOutletContext<{showSessions: () => void}>();
    const chatStore = userChatStore();
    const currentSession = chatStore.currentSession();
    const location = useLocation();
    const {scrollRef, setAutoScroll, scrollToBottom} = userScrollToBottom();
    const title = location.state?.title || "新的对话";

    useEffect(() => {
        setAutoScroll(true);
        scrollToBottom();
    }, [currentSession.id, setAutoScroll, scrollToBottom]);

    // 输入事件
    const onEnter = async (value: string) => {
        if (!value.trim()) return;
        setAutoScroll(true);
        scrollToBottom();
        const newMessage = createNewMessage(value, MessageRole.user)
        await chatStore.onSendMessage(newMessage);
    }

    const clearContextIndex =
        (currentSession.clearContextIndex ?? -1) >= 0
            ? currentSession.clearContextIndex!
            : -1;

    return (
        <div className={styles.wrapper}>
            <div className={styles.header}>
                <button className={styles.back} onClick={showSessions} aria-label="返回会话列表"><span aria-hidden="true">‹</span> 对话</button>
                <div className={styles.heading}><strong>{title}</strong><span>智能对话</span></div>
            </div>
            <div className={styles.scroll} ref={scrollRef} role="region" aria-label="对话消息" tabIndex={0}
                 onScroll={(event) => {
                     const element = event.currentTarget;
                     setAutoScroll(element.scrollHeight - element.scrollTop - element.clientHeight < 48);
                 }}>
                {currentSession.messages?.map(
                    (message, index) => {
                        const shouldShowClearContextDivider = index === clearContextIndex - 1;
                        return <Fragment key={message.id}>
                            <DialogMessageItem message={message} parentRef={scrollRef}/>
                            {shouldShowClearContextDivider && <ClearContextDivider/>}
                        </Fragment>
                    })
                }
            </div>
            <DialogMessageInput onEnter={onEnter}/>
        </div>
    );

}

/**
 * 清除上下文对话信息
 * @constructor
 */
function ClearContextDivider() {
    const chatStore = userChatStore();

    return (
        <div
            className={styles["clear-context"]}
            onClick={() =>
                chatStore.updateCurrentSession(
                    (session) => (session.clearContextIndex = undefined),
                )
            }
        >
            <div className={styles["clear-context-tips"]}>上下文已清除</div>
        </div>
    );
}

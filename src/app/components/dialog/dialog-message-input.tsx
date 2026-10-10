import {useEffect, useRef, useState, type KeyboardEvent} from "react";
import styles from './dialog-message-input.module.scss';
import {Button, Input} from "antd";
import {userChatStore} from "@/app/store/agent-chat-store";
import DialogMessagesActions from "./dialog-message-actions";
import {CloseOutlined, StopOutlined} from "@ant-design/icons";
import {MessageStatus} from "@/types/chat";
import {DialogAttachments} from "./dialog-attachments";
import {DialogChatQuote} from "./dialog-chat-types";

interface Props {
    onEnter: (value: string, quotes: DialogChatQuote[], attachmentIds: string[]) => string | null | void | Promise<string | null | void>;
    quotes?: DialogChatQuote[];
    onRemoveQuote?: (quote: DialogChatQuote) => void;
}

/**
 * 对话消息输入
 * @constructor
 */
export function DialogMessageInput(props: Props) {
    const {onEnter, quotes = [], onRemoveQuote} = props;
    const chatStore = userChatStore();
    const [sendShortcut, setSendShortcut] = useState("Ctrl+Enter");
    useEffect(() => {
        if (/Mac|iPhone|iPad|iPod/i.test(navigator.platform)) {
            setSendShortcut("Command+Enter");
        }
    }, []);
    const [value, setValue] = useState<string>("");
    const currentSession = chatStore.currentSession();
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const sendInFlightRef = useRef(false);
    const draftRef = useRef({
        fingerprint: "",
        revision: 0,
        value: "",
        quoteKey: "",
        attachmentKey: "",
    });
    const isSending = Boolean(currentSession.activeRunId) || currentSession.messages.some((message) => message.status === MessageStatus.Sending);

    const quoteKey = quotes.map((quote) => `${quote.message_id}:${quote.text}`).join("\u0001");
    const attachmentKey = attachmentIds.join("\u0001");
    const fingerprint = `${value}\u0000${quoteKey}\u0000${attachmentKey}`;
    if (draftRef.current.fingerprint !== fingerprint) {
        draftRef.current = {
            fingerprint,
            revision: draftRef.current.revision + 1,
            value,
            quoteKey,
            attachmentKey,
        };
    }

    useEffect(() => {
        setAttachmentIds([]);
    }, [currentSession.id]);

    const onSend = async (nextValue: string) => {
        if (!nextValue.trim() || sendInFlightRef.current) return;
        const before = {...draftRef.current};
        const startSessionId = currentSession.id;
        sendInFlightRef.current = true;
        try {
            const acceptedSessionId = await onEnter(nextValue, quotes, attachmentIds);
            const latest = draftRef.current;
            const quoteWasConsumed = before.quoteKey.length > 0 && latest.quoteKey.length === 0;
            const draftUnchanged = latest.value === before.value
                && latest.attachmentKey === before.attachmentKey
                && (latest.quoteKey === before.quoteKey || quoteWasConsumed)
                && (latest.revision === before.revision || (quoteWasConsumed && latest.revision === before.revision + 1));
            const currentSessionId = userChatStore.getState().currentSession().id;
            const sessionUnchanged = typeof acceptedSessionId === "string"
                ? currentSessionId === acceptedSessionId
                : Boolean(startSessionId) && currentSessionId === startSessionId;
            if (draftUnchanged && sessionUnchanged) setValue("");
        } finally {
            sendInFlightRef.current = false;
        }
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || e.repeat) return;
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            void onSend(value);
        }
    }

    return (
        <div className={styles.wrapper}>
            <DialogMessagesActions config={currentSession.config}/>
            <DialogAttachments
                sessionId={currentSession.id}
                selectedIds={attachmentIds}
                onSelectedIdsChange={setAttachmentIds}
            />
            {quotes.length > 0 && <div className={styles.quoteTray} aria-label="本次提问引用的消息">
                <span className={styles.quoteLabel}>引用</span>
                {quotes.map((quote, index) => <div className={styles.quoteChip} key={`${quote.message_id}-${index}`}>
                    <span className={styles.quoteText} title={quote.text}>{quote.text}</span>
                    <button
                        type="button"
                        className={styles.quoteRemove}
                        onClick={() => onRemoveQuote?.(quote)}
                        aria-label={`移除第 ${index + 1} 条引用`}
                    ><CloseOutlined /></button>
                </div>)}
            </div>}
            <Input.TextArea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={styles.textarea}
                placeholder={"请输入"}
                autoFocus
                onKeyDown={handleKeyDown}/>
            <div className={styles.buttonGroup}>
                {isSending && <Button
                    type="default"
                    icon={<StopOutlined/>}
                    className={styles.stopBtn}
                    aria-label="停止当前运行"
                    onClick={() => chatStore.cancelGeneration(currentSession.id)}
                >停止</Button>}
                <Button
                    disabled={!value.trim()}
                    type="primary"
                    title={`发送 (${sendShortcut})`}
                    className={styles.btn}
                    onClick={() => void onSend(value)}
                >发送</Button>
            </div>
        </div>

    );

}

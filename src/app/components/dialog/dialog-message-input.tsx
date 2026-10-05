import {useEffect, useState, type KeyboardEvent} from "react";
import styles from './dialog-message-input.module.scss';
import {Button, Input} from "antd";
import {userChatStore} from "@/app/store/chat-store";
import DialogMessagesActions from "./dialog-message-actions";
import {StopOutlined} from "@ant-design/icons";
import {MessageStatus} from "@/types/chat";

interface Props {
    onEnter: (value: string) => void | Promise<void>;
}

/**
 * 对话消息输入
 * @constructor
 */
export function DialogMessageInput(props: Props) {
    const {onEnter} = props;
    const chatStore = userChatStore();
    const [sendShortcut, setSendShortcut] = useState("Ctrl+Enter");
    useEffect(() => {
        if (/Mac|iPhone|iPad|iPod/i.test(navigator.platform)) {
            setSendShortcut("Command+Enter");
        }
    }, []);
    const [value, setValue] = useState<string>("");
    const currentSession = chatStore.currentSession();
    const isSending = currentSession.messages.some((message) => message.status === MessageStatus.Sending);

    const onSend = (value: string) => {
        if (isSending || !value.trim()) return;
        // 输入内容
        onEnter(value);
        // 清空当前对话框
        setValue("");
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || e.repeat) return;
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            onSend(value);
        }
    }

    return (
        <div className={styles.wrapper}>
            <DialogMessagesActions config={currentSession.config}/>
            <Input.TextArea
                value={value}
                disabled={isSending}
                onChange={(e) => setValue(e.target.value)}
                className={styles.textarea}
                placeholder={"请输入"}
                autoFocus
                onKeyDown={handleKeyDown}/>
            {isSending ? (
                <Button
                    type="default"
                    icon={<StopOutlined/>}
                    className={styles.btn}
                    aria-label="停止生成"
                    onClick={() => chatStore.cancelGeneration(currentSession.id)}
                >停止</Button>
            ) : (
                <Button
                    disabled={!value.trim()}
                    type="primary"
                    title={`发送 (${sendShortcut})`}
                    className={styles.btn}
                    onClick={() => onSend(value)}
                >发送</Button>
            )}
        </div>

    );

}

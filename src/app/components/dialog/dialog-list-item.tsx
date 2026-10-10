import {displayAssistantContent} from './message-display';
import {MessageRole} from '@/types/chat';
import styles from './dialog-list-item.module.scss';
import {Avatar, Badge, Button, Input, Space} from 'antd';
import {AgentChatSession} from "@/app/store/agent-chat-store";
import DeleteIcon from "@/app/icons/delete.svg";
import {EditOutlined} from "@ant-design/icons";
import {useState} from "react";

interface Props {
    session: AgentChatSession;
    selected: boolean;
    onClick: () => void;
    onClickDelete: () => void;
    onRename?: (title: string) => void;
}

/**
 * 对话框列表对象元素
 * @constructor
 */
export function DialogListItem(props: Props) {
    const {session, selected} = props;
    const dialog = session.dialog;
    const lastMessage = session.messages[session.messages.length - 1];
    const preview = lastMessage?.role === MessageRole.assistant ? displayAssistantContent(dialog.subTitle).content : dialog.subTitle;
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(dialog.title);
    const date = new Date(dialog.timestamp);
    const timeString = date.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'});
    const commitTitle = () => {
        const nextTitle = title.trim() || dialog.title;
        setTitle(nextTitle);
        setEditing(false);
        if (nextTitle !== dialog.title) props.onRename?.(nextTitle);
    };

    return (
        <div className={`${styles.wrapper} ${selected ? styles.selected : ''}`}>
            <button className={styles.select} aria-label={`打开对话 ${dialog.title}`} aria-current={selected ? "true" : undefined} onClick={props.onClick}>
            <div className={styles.left}>
                <Space size={24}>
                    {/* Badge 是 React 提供的组件，这里控制只有选中的才展示对话数 */}
                    <Badge count={props.selected ? dialog.count : 0} size={"small"} color={"#fca7a7"}>
                        <Avatar shape={"square"} src={dialog.avatar} size={40}/>
                    </Badge>
                </Space>
            </div>
            <div className={styles.right}>
                <div className={styles.line1}>
                    {editing ? <Input
                        size="small"
                        autoFocus
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onPressEnter={(event) => { event.stopPropagation(); commitTitle(); }}
                        onBlur={commitTitle}
                        aria-label="会话标题"
                    /> : <p className={styles.title}>{dialog.title}</p>}
                    <p className={styles.time}>{timeString}</p>
                </div>
                <div className={styles.line2}>
                    {session.activeRunId ? "运行中…" : preview}
                </div>
            </div>
            </button>
            {props.onRename && <button
                aria-label={`重命名对话 ${dialog.title}`}
                className={styles["chat-item-rename"]}
                onClick={(event) => { event.stopPropagation(); setTitle(dialog.title); setEditing(true); }}
            ><EditOutlined/></button>}
            <button aria-label={`删除对话 ${dialog.title}`} className={styles["chat-item-delete"]} onClick={(event) => { event.stopPropagation(); props.onClickDelete(); }}>
                <DeleteIcon/>
            </button>
        </div>
    );
}

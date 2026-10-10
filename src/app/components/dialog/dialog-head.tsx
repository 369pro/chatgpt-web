import {Button, Tooltip} from "antd";
import {PlusOutlined} from "@ant-design/icons";
import styles from "./dialog-head.module.scss";
import {CHAT_REQUEST_FINISHED_EVENT, userChatStore} from "@/app/store/agent-chat-store";
import {useNavigate} from "react-router-dom";
import {useCallback, useEffect, useState} from "react";
import {message as antdMessage} from "antd";
import {AccountBalance, formatBalance, queryAccountBalance} from "@/apis/account-balance";
import {agentSessionPath} from "@/app/store/agent-session-route";

type BalanceResult = {code?: string; data?: AccountBalance};

export function DialogHead({title = "我的对话"}: {title?: string}) {
    const navigate = useNavigate();
    const chatStore = userChatStore();
    const [notice, holder] = antdMessage.useMessage();
    const [creating, setCreating] = useState(false);
    const [balance, setBalance] = useState<AccountBalance | null>(null);
    const refreshBalance = useCallback(async () => {
        try {
            const response = await queryAccountBalance();
            if (!response.ok) return;
            const result = await response.json() as BalanceResult;
            if (result.code === "0000" && result.data) setBalance(result.data);
        } catch {
            // The compact header is best-effort; sale and market pages show full errors.
        }
    }, []);

    useEffect(() => {
        void refreshBalance();
        const handleRequestFinished = () => { void refreshBalance(); };
        window.addEventListener(CHAT_REQUEST_FINISHED_EVENT, handleRequestFinished);
        return () => window.removeEventListener(CHAT_REQUEST_FINISHED_EVENT, handleRequestFinished);
    }, [refreshBalance]);

    const createSession = async () => {
        if (creating) return;
        setCreating(true);
        try {
            const session = await chatStore.openSession();
            navigate(agentSessionPath(session.id), {state: {title: session.dialog.title}});
        } catch (error) {
            notice.error(error instanceof Error ? error.message : "创建会话失败");
        } finally {
            setCreating(false);
        }
    };

    return <div className={styles["dialog-head"]}>
        {holder}
        <strong className={styles.title}>{title}</strong>
        <div className={styles.balance} aria-label="钱包余额">
            <span>余额 {balance ? formatBalance(balance.availableAmount) : "—"}</span>
        </div>
        <Tooltip title="新建对话"><Button type="text" loading={creating} icon={<PlusOutlined/>} aria-label="新建对话" onClick={() => void createSession()}/></Tooltip>
    </div>;
}

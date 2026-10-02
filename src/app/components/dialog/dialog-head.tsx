import {Button, Tooltip} from "antd";
import {PlusOutlined} from "@ant-design/icons";
import styles from "./dialog-head.module.scss";
import {CHAT_REQUEST_FINISHED_EVENT, userChatStore} from "@/app/store/chat-store";
import {useNavigate} from "react-router-dom";
import {useCallback, useEffect, useState} from "react";
import {AccountBalance, formatBalance, queryAccountBalance} from "@/apis/account-balance";

type BalanceResult = {code?: string; data?: AccountBalance};

export function DialogHead() {
    const navigate = useNavigate();
    const chatStore = userChatStore();
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

    return <div className={styles["dialog-head"]}>
        <strong className={styles.title}>我的对话</strong>
        <div className={styles.balance} aria-label="钱包余额和历史额度">
            <span>余额 {balance ? formatBalance(balance.availableAmount) : "—"}</span>
            <span>历史额度 {balance?.legacyQuota === undefined || balance.legacyQuota === null ? "—" : `${balance.legacyQuota} 次`}</span>
        </div>
        <Tooltip title="新建对话"><Button type="text" icon={<PlusOutlined/>} aria-label="新建对话" onClick={() => {
            const session = chatStore.openSession();
            chatStore.selectSession(0);
            navigate("/chat/" + session.id, {state: {title: session.dialog.title}});
        }}/></Tooltip>
    </div>;
}
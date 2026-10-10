import styles from "./dialog-list.module.scss";
import {DialogListItem} from "./dialog-list-item";
import {DialogResizeableSidebar} from "@/app/components/dialog/dialog-resizeable-sidebar";
import {useLocation, useNavigate} from "react-router-dom";
import {useEffect} from "react";
import {Empty, Spin, message as antdMessage} from "antd";
import {useAccessStore} from "@/app/store/access";
import {userChatStore} from "@/app/store/agent-chat-store";
import {DialogHead} from "@/app/components/dialog/dialog-head";
import {agentSessionIdFromPath, agentSessionPath} from "@/app/store/agent-session-route";

/** Session history is loaded from the authenticated database-backed API. */
export function DialogList({onSelect}: {onSelect?: () => void}) {
    const navigate = useNavigate();
    const location = useLocation();
    const access = useAccessStore();
    const [notice, holder] = antdMessage.useMessage();
    const sessions = userChatStore((state) => state.sessions);
    const currentSessionIndex = userChatStore((state) => state.currentSessionIndex);
    const selectSession = userChatStore((state) => state.selectSession);
    const selectSessionById = userChatStore((state) => state.selectSessionById);
    const loadSessions = userChatStore((state) => state.loadSessions);
    const deleteSession = userChatStore((state) => state.deleteSession);
    const loading = userChatStore((state) => state.loading);
    const error = userChatStore((state) => state.error);
    const routeSessionId = agentSessionIdFromPath(location.pathname);

    useEffect(() => {
        void loadSessions();
    }, [access.token, access.username, loadSessions]);

    useEffect(() => {
        if (!sessions.length || loading) return;
        if (routeSessionId) {
            const index = sessions.findIndex((session) => session.id === routeSessionId);
            if (index >= 0 && index !== currentSessionIndex) selectSession(index);
            if (index < 0) selectSessionById(routeSessionId);
            return;
        }
        const selected = sessions[Math.min(currentSessionIndex, sessions.length - 1)];
        if (selected) {
            selectSession(Math.min(currentSessionIndex, sessions.length - 1));
            navigate(agentSessionPath(selected.id), {state: {title: selected.dialog.title}, replace: true});
        }
    }, [sessions, currentSessionIndex, loading, routeSessionId, navigate, selectSession, selectSessionById]);

    return (
        <DialogResizeableSidebar>
            {holder}
            <DialogHead/>
            {error && <div className={styles.error} role="alert">{error}</div>}
            <div className={styles["dialog-list"]}>
                {loading && !sessions.length ? <Spin style={{margin: "32px auto", width: "100%"}}/> : null}
                {!loading && !sessions.length && !error ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有对话"/> : null}
                {sessions.map((session, index) => (
                    <DialogListItem
                        key={session.id}
                        session={session}
                        selected={currentSessionIndex === index}
                        onClick={() => {
                            selectSession(index);
                            onSelect?.();
                            navigate(agentSessionPath(session.id), {state: {title: session.dialog.title}});
                        }}
                        onClickDelete={() => {
                            void deleteSession(index).then(() => {
                                if (routeSessionId !== session.id) return;
                                const nextSession = userChatStore.getState().currentSession();
                                if (nextSession.id) {
                                    navigate(agentSessionPath(nextSession.id), {
                                        state: {title: nextSession.dialog.title},
                                        replace: true,
                                    });
                                } else {
                                    navigate("/chat", {replace: true});
                                }
                            }).catch((caught) => notice.error(caught instanceof Error ? caught.message : "删除会话失败"));
                        }}
                        onRename={(title) => {
                            void userChatStore.getState().renameSession(session.id, title)
                                .catch((caught) => notice.error(caught instanceof Error ? caught.message : "重命名会话失败"));
                        }}
                    />
                ))}
            </div>
        </DialogResizeableSidebar>
    );
}

import {ClearOutlined, InfoCircleOutlined} from '@ant-design/icons';
import styles from '@/app/components/dialog/dialog-message-action.module.scss';
import {Button, InputNumber, Select, Switch, Tooltip} from 'antd'
import {userChatStore} from '@/app/store/agent-chat-store';
import {DEFAULT_CHAT_MODELS, DEFAULT_GPT_VERSION, normalizeGptVersion} from '../../constants'
import {getAgentCapabilities, getModelCatalog} from '@/apis';
import {SessionConfig} from "@/types/chat";
import {CSSProperties, useEffect, useRef, useState} from 'react';

export function Action(props: {
    icon: JSX.Element;
    onClick?: () => void;
    styles?: CSSProperties
}) {
    const {styles: sty} = props
    return <div className={styles['chat-input-action']}  onClick={props.onClick}>
        <div className={styles["icon"]}>
            {props.icon}
        </div>
    </div>
}
export function ChatAction(props: {
    text?: string;
    icon: JSX.Element;
    onClick: () => void;
    disabled?: boolean;
}) {
    const iconRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState({
        full: 16,
        icon: 16,
    });

    function updateWidth() {
        if (!iconRef.current || !textRef.current) return;
        const getWidth = (dom: HTMLDivElement) => dom.getBoundingClientRect().width;
        const textWidth = getWidth(textRef.current);
        const iconWidth = getWidth(iconRef.current);
        setWidth({
            full: textWidth + iconWidth,
            icon: iconWidth,
        });
    }

    return (
        <div
            className={[styles["chat-input-action"], "clickable", props.disabled ? styles.disabled : ""].filter(Boolean).join(" ")}
            onClick={() => {
                if (props.disabled) return;
                props.onClick();
                setTimeout(updateWidth, 1);
            }}
            onMouseEnter={updateWidth}
            onTouchStart={updateWidth}
            style={
                {
                    "--icon-width": `${width.icon}px`,
                    "--full-width": `${width.full}px`,
                } as React.CSSProperties
            }
            aria-disabled={props.disabled || undefined}
        >
            <div ref={iconRef} className={styles["icon"]}>
                {props.icon}
            </div>
            <div className={styles["text"]} ref={textRef}>
                {props.text}
            </div>
        </div>
    );
}
export default function DialogMessagesActions(props: {
    config: SessionConfig
}){
    const chatStore = userChatStore();
    const currentSession = chatStore.currentSession();
    const {config} = props;
    const [models, setModels] = useState(DEFAULT_CHAT_MODELS);
    const [loading, setLoading] = useState(true);
    const [researchEnabled, setResearchEnabled] = useState(false);
    const [webSearchAvailable, setWebSearchAvailable] = useState(false);
    const [webSearchModels, setWebSearchModels] = useState<string[]>([]);
    const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);

    useEffect(() => {
        const controller = new AbortController();
        getModelCatalog(controller.signal)
            .then(setModels)
            .catch(() => {
                if (!controller.signal.aborted) setModels(DEFAULT_CHAT_MODELS);
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        getAgentCapabilities(controller.signal).then((capabilities) => {
            if (!controller.signal.aborted) {
                setResearchEnabled(capabilities.research);
                setWebSearchAvailable(Boolean(capabilities.web_search_available));
                setWebSearchModels(Array.isArray(capabilities.web_search_models) ? capabilities.web_search_models : []);
            }
        }).catch(() => {
            // Research stays disabled until the backend advertises a search service.
        }).finally(() => {
            if (!controller.signal.aborted) setCapabilitiesLoading(false);
        });
        return () => controller.abort();
    }, []);

    const selectedModel = normalizeGptVersion(config?.gptVersion || DEFAULT_GPT_VERSION);
    const mode = config?.mode || "chat";
    const budgetLimit = config?.budgetLimit ?? (mode === "research" ? 1 : 0.25);
    const canResetContext = !currentSession.activeRunId && Object.values(currentSession.messageSeqs).some((seq) =>
        currentSession.contextResetAfterSeq == null || seq > currentSession.contextResetAfterSeq,
    );
    const tariff = models.find((model) => model.id === selectedModel);
    const webSearchEnabled = Boolean((config as SessionConfig & {webSearch?: boolean}).webSearch);
    const webSearchModelSupported = webSearchModels.includes(selectedModel);
    const webSearchDisabled = mode !== "chat" || capabilitiesLoading || !webSearchAvailable || !webSearchModelSupported;
    const webSearchHint = mode !== "chat"
        ? "联网查询只支持普通聊天"
        : capabilitiesLoading
        ? "正在读取联网能力"
        : !webSearchAvailable
            ? "当前服务未配置联网查询"
            : !webSearchModelSupported
                ? "当前模型不支持联网查询"
                : "回答前检索网页并展示来源";
    useEffect(() => {
        if (capabilitiesLoading || !webSearchEnabled || !currentSession.id) return;
        if (mode !== "chat") {
            userChatStore.getState().updateCurrentSession((session) => {
                session.config = {...session.config, webSearch: false};
            });
            return;
        }
        if (webSearchAvailable && webSearchModelSupported) return;
        userChatStore.getState().updateCurrentSession((session) => {
            session.config = {...session.config, webSearch: false};
        });
    }, [capabilitiesLoading, currentSession.id, mode, webSearchAvailable, webSearchEnabled, webSearchModelSupported]);
    const updateWebSearch = (checked: boolean) => {
        const apply = () => userChatStore.getState().updateCurrentSession((session) => {
            session.config = {...session.config, webSearch: checked};
        });
        if (currentSession.id) {
            apply();
            return;
        }
        // A new route has no durable session yet. Persisting this preference
        // must first create the session so it stays scoped to this chat.
        void chatStore.openSession().then(apply).catch(() => undefined);
    };
    const options = models.some((model) => model.id === selectedModel)
        ? models
        : [{id: selectedModel, displayName: selectedModel, provider: ""}, ...models];

    return <div className={styles['chat-input-actions']}>
        <Select
            value={selectedModel}
            loading={loading}
            style={{ width: 208, maxWidth: '100%' }}
            options={options.map((model) => ({value: model.id, label: model.displayName}))}
            onChange={(value) => {
                chatStore.updateCurrentSession((session) => {
                    session.config = {
                        ...session.config,
                        gptVersion: value,
                        ...(session.config.webSearch && !webSearchModels.includes(value) ? {webSearch: false} : {}),
                    }
                });
            }}
        />
        {tariff?.inputPrice !== undefined && <Tooltip title={`每百万 Token：输入 ¥${tariff.inputPrice}，缓存 ¥${tariff.cachedInputPrice}，输出 ¥${tariff.outputPrice}。`}>
            <Button type="text" size="small" aria-label="模型计费价格" icon={<InfoCircleOutlined />} />
        </Tooltip>}
        <Select
            size="small"
            value={mode}
            style={{width: researchEnabled ? 92 : 170}}
            options={[
                {value: "chat", label: "普通聊天"},
                {value: "research", label: researchEnabled ? "研究模式" : "研究模式（未配置搜索）", disabled: !researchEnabled},
            ]}
            onChange={(value) => chatStore.updateCurrentSession((session) => {
                session.config = {
                    ...session.config,
                    mode: value,
                    budgetLimit: value === "research" ? 1 : 0.25,
                    ...(value !== "chat" ? {webSearch: false} : {}),
                };
            })}
        />
        <Tooltip title={webSearchHint}>
            <label className={styles.webSearchOption}>
                <input
                    type="checkbox"
                    checked={webSearchEnabled}
                    disabled={webSearchDisabled}
                    onChange={(event) => updateWebSearch(event.target.checked)}
                />
                <span>联网</span>
            </label>
        </Tooltip>
        <Tooltip title="本次任务的最高消费，按实际用量结算。系统会根据剩余预算和钱包余额调整回答长度，额度较低时回答可能不完整。">
            <span className={styles.budget}>上限 ¥</span>
        </Tooltip>
        <InputNumber
            size="small"
            min={0.01}
            max={100}
            precision={2}
            value={budgetLimit}
            onChange={(value) => value != null && chatStore.updateCurrentSession((session) => {
                session.config = {...session.config, budgetLimit: Number(value)};
            })}
            style={{width: 78}}
            aria-label="本次运行预算上限"
        />
        <Tooltip title="让模型使用更深的思考模式">
            <Switch size="small" checked={Boolean(config?.thinking)} onChange={(checked) => chatStore.updateCurrentSession((session) => {
                session.config = {...session.config, thinking: checked};
            })} checkedChildren="思考" unCheckedChildren="思考" />
        </Tooltip>
        <Tooltip title="保留历史记录，但从下一次请求中排除边界之前的内容。运行中或没有新的历史消息时不可用。">
            <span>
                <ChatAction
                    text="重置上下文"
                    icon={<ClearOutlined />}
                    disabled={!canResetContext}
                    onClick={() => { void chatStore.resetContext().catch(() => undefined); }}
                />
            </span>
        </Tooltip>
    </div>
}

import {ClearOutlined, InfoCircleOutlined} from '@ant-design/icons';
import styles from '@/app/components/dialog/dialog-message-action.module.scss';
import {Button, Select, Tooltip} from 'antd'
import {userChatStore} from '@/app/store/chat-store';
import {DEFAULT_CHAT_MODELS, DEFAULT_GPT_VERSION, normalizeGptVersion} from '../../constants'
import {getModelCatalog} from '@/apis';
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
            className={`${styles["chat-input-action"]} clickable`}
            onClick={() => {
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
    const {config} = props;
    const [models, setModels] = useState(DEFAULT_CHAT_MODELS);
    const [loading, setLoading] = useState(true);

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

    const selectedModel = normalizeGptVersion(config?.gptVersion || DEFAULT_GPT_VERSION);
    const tariff = models.find((model) => model.id === selectedModel);
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
                    }
                });
            }}
        />
        {tariff?.inputPrice !== undefined && <Tooltip title={`每百万 Token：输入 ¥${tariff.inputPrice}，缓存 ¥${tariff.cachedInputPrice}，输出 ¥${tariff.outputPrice}。历史次数优先抵扣。`}>
            <Button type="text" size="small" aria-label="模型计费价格" icon={<InfoCircleOutlined />} />
        </Tooltip>}
        <ChatAction text="清除聊天" icon={<ClearOutlined />} onClick={() => {
            chatStore.updateCurrentSession((session) => {
                if (session.clearContextIndex === session.messages.length) {
                    session.clearContextIndex = undefined;
                } else {
                    session.clearContextIndex = session.messages.length;
                }
            });
        }}/>
    </div>
}
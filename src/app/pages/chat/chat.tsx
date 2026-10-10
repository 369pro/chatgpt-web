import styles from './chat.module.scss';
import {DialogList} from "@/app/components/dialog/dialog-list";
import {Outlet, useLocation} from 'react-router-dom';
import {CSSProperties, KeyboardEvent, PointerEvent, useEffect, useRef, useState} from 'react';

const DEFAULT_SESSION_WIDTH = 280;
const NARROW_SESSION_WIDTH = 240;
const MIN_SESSION_WIDTH = 220;
const MAX_SESSION_WIDTH = 360;
const KEYBOARD_RESIZE_STEP = 16;
const SESSION_WIDTH_STORAGE_KEY = 'llm-market.chat.session-list-width';

function clampSessionWidth(width: number) {
    return Math.max(MIN_SESSION_WIDTH, Math.min(MAX_SESSION_WIDTH, width));
}

function readStoredSessionWidth() {
    if (typeof window === 'undefined') return DEFAULT_SESSION_WIDTH;
    try {
        const rawStored = window.localStorage.getItem(SESSION_WIDTH_STORAGE_KEY);
        if (rawStored !== null && rawStored.trim() !== '') {
            const stored = Number(rawStored);
            if (Number.isFinite(stored)) return clampSessionWidth(stored);
        }
        return window.matchMedia('(max-width: 1100px)').matches ? NARROW_SESSION_WIDTH : DEFAULT_SESSION_WIDTH;
    } catch {
        return window.matchMedia('(max-width: 1100px)').matches ? NARROW_SESSION_WIDTH : DEFAULT_SESSION_WIDTH;
    }
}

export function Chat() {
    const location = useLocation();
    const [showList, setShowList] = useState(false);
    const [sessionWidth, setSessionWidth] = useState(readStoredSessionWidth);
    const [isResizing, setIsResizing] = useState(false);
    const resizeRef = useRef<{pointerId: number; startX: number; startWidth: number} | null>(null);

    useEffect(() => { setShowList(false); }, [location.key]);

    useEffect(() => {
        try {
            window.localStorage.setItem(SESSION_WIDTH_STORAGE_KEY, String(Math.round(sessionWidth)));
        } catch {
            // Storage can be unavailable in private browsing or an embedded web view.
        }
    }, [sessionWidth]);

    const resizeWithKeyboard = (delta: number) => {
        setSessionWidth((width) => clampSessionWidth(width + delta));
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            resizeWithKeyboard(-KEYBOARD_RESIZE_STEP);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            resizeWithKeyboard(KEYBOARD_RESIZE_STEP);
        } else if (event.key === 'Home') {
            event.preventDefault();
            setSessionWidth(MIN_SESSION_WIDTH);
        } else if (event.key === 'End') {
            event.preventDefault();
            setSessionWidth(MAX_SESSION_WIDTH);
        }
    };

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        resizeRef.current = {pointerId: event.pointerId, startX: event.clientX, startWidth: sessionWidth};
        setIsResizing(true);
    };

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const resize = resizeRef.current;
        if (!resize || resize.pointerId !== event.pointerId) return;
        setSessionWidth(clampSessionWidth(resize.startWidth + event.clientX - resize.startX));
    };

    const stopPointerResize = (event: PointerEvent<HTMLDivElement>) => {
        const resize = resizeRef.current;
        if (!resize || resize.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        resizeRef.current = null;
        setIsResizing(false);
    };

    const chatStyle = {"--session-width": `${sessionWidth}px`} as CSSProperties;

    return (
        <div className={`${styles.chat} ${showList || location.pathname === "/chat" ? styles.showList : ''} ${isResizing ? styles.resizing : ''}`} style={chatStyle}>
            <div className={styles.sessions}>
                <DialogList onSelect={() => setShowList(false)}/>
            </div>
            <div
                className={styles.resizeHandle}
                role="separator"
                aria-orientation="vertical"
                aria-label="调整会话列表宽度"
                aria-valuemin={MIN_SESSION_WIDTH}
                aria-valuemax={MAX_SESSION_WIDTH}
                aria-valuenow={Math.round(sessionWidth)}
                tabIndex={0}
                onKeyDown={handleKeyDown}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={stopPointerResize}
                onPointerCancel={stopPointerResize}
                onLostPointerCapture={stopPointerResize}
            />
            <div className={styles.conversation}>
                <Outlet context={{showSessions: () => setShowList(true)}}/>
            </div>
        </div>
    );
}

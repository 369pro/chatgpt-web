import {FocusEvent, MouseEvent, RefObject, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Message, MessageRole} from "@/types/chat";
import styles from "./dialog-message.module.scss";

interface Props {
    messages: Message[];
    scrollRef: RefObject<HTMLDivElement>;
}

interface Question {
    id: string;
    preview: string;
}

interface HoverPreview {
    text: string;
    left: number;
    top: number;
}

function plainPreview(value: string): string {
    return value
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/[#>*_`~\[\]()]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 90) || "空问题";
}

function findMessageNode(container: HTMLDivElement, id: string): HTMLElement | null {
    for (const element of Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]"))) {
        if (element.dataset.messageId === id) return element;
    }
    return null;
}

export function DialogMessageMinimap({messages, scrollRef}: Props) {
    const questions = useMemo<Question[]>(() => messages
        .filter((message) => message.role === MessageRole.user && Boolean(message.content.trim()))
        .map((message) => ({id: message.id, preview: plainPreview(message.content)})), [messages]);
    const questionKey = questions.map((question) => question.id).join("|");
    const questionsRef = useRef(questions);
    questionsRef.current = questions;
    const [activeId, setActiveId] = useState<string | null>(questions[0]?.id || null);
    const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);

    const updateActive = useCallback(() => {
        const container = scrollRef.current;
        const currentQuestions = questionsRef.current;
        if (!container || !currentQuestions.length) {
            setActiveId(null);
            return;
        }
        const containerTop = container.getBoundingClientRect().top;
        const marker = containerTop + Math.min(96, container.clientHeight * 0.28);
        let visibleId = currentQuestions[0].id;
        for (const question of currentQuestions) {
            const element = findMessageNode(container, question.id);
            if (!element) continue;
            if (element.getBoundingClientRect().top <= marker) visibleId = question.id;
        }
        setActiveId(visibleId);
    }, [scrollRef]);

    useEffect(() => {
        const currentQuestions = questionsRef.current;
        setActiveId((current) => current && currentQuestions.some((question) => question.id === current)
            ? current
            : currentQuestions[0]?.id || null);
        const container = scrollRef.current;
        if (!container) return;
        let frame = 0;
        const handleScroll = () => {
            if (frame) return;
            frame = window.requestAnimationFrame(() => {
                frame = 0;
                updateActive();
            });
        };
        container.addEventListener("scroll", handleScroll, {passive: true});
        window.addEventListener("resize", handleScroll);
        updateActive();
        return () => {
            container.removeEventListener("scroll", handleScroll);
            window.removeEventListener("resize", handleScroll);
            if (frame) window.cancelAnimationFrame(frame);
        };
    }, [questionKey, scrollRef, updateActive]);

    if (!questions.length) return null;

    const jumpToQuestion = (question: Question) => {
        const container = scrollRef.current;
        if (!container) return;
        const target = findMessageNode(container, question.id);
        if (!target) return;
        setActiveId(question.id);
        target.scrollIntoView({behavior: "smooth", block: "center"});
        target.focus({preventScroll: true});
    };

    const showPreview = (event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>, question: Question) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const minimap = event.currentTarget.closest<HTMLElement>("[data-dialog-minimap]");
        const origin = minimap?.getBoundingClientRect();
        const width = Math.min(340, window.innerWidth * 0.42);
        const viewportLeft = Math.min(window.innerWidth - width - 8, rect.right + 8);
        const viewportTop = Math.max(8, Math.min(window.innerHeight - 48, rect.top + rect.height / 2));
        setHoverPreview({
            text: question.preview,
            left: origin ? viewportLeft - origin.left : viewportLeft,
            top: origin ? viewportTop - origin.top : viewportTop,
        });
    };

    return <aside className={styles.minimap} data-dialog-minimap="true" aria-label="当前对话消息导航">
        <div className={styles.minimapRail}>
            {questions.map((question, index) => <button
                type="button"
                key={question.id}
                className={`${styles.minimapMarker} ${activeId === question.id ? styles.minimapMarkerActive : ""}`}
                aria-label={`跳转到问题 ${index + 1}：${question.preview}`}
                aria-current={activeId === question.id ? "location" : undefined}
                title={question.preview}
                onClick={() => jumpToQuestion(question)}
                onMouseEnter={(event) => showPreview(event, question)}
                onMouseLeave={() => setHoverPreview(null)}
                onFocus={(event) => showPreview(event, question)}
                onBlur={() => setHoverPreview(null)}
            >
                <span className={styles.minimapLine} aria-hidden="true" />
            </button>)}
        </div>
        {hoverPreview && <span
            className={styles.minimapTooltip}
            role="tooltip"
            style={{left: hoverPreview.left, top: hoverPreview.top}}
        >{hoverPreview.text}</span>}
    </aside>;
}

import {useCallback, useEffect, useRef, useState} from "react";
import {Button, Tooltip} from "antd";
import {
    CheckOutlined,
    CloseCircleOutlined,
    DatabaseOutlined,
    DeleteOutlined,
    LoadingOutlined,
    PaperClipOutlined,
} from "@ant-design/icons";
import {
    deleteChatAttachment,
    listChatAttachments,
    promoteChatAttachment,
    uploadChatAttachment,
} from "@/apis";
import styles from "./dialog-attachments.module.scss";
import {
    DialogChatAttachment,
    formatAttachmentSize,
    isDialogAttachmentReady,
    normalizeDialogAttachment,
    normalizeDialogAttachments,
} from "./dialog-chat-types";

const SUPPORTED_EXTENSIONS = new Set(["md", "txt", "pdf", "docx"]);
const ACCEPTED_FILE_TYPES = ".md,.txt,.pdf,.docx,text/markdown,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface Props {
    sessionId: string;
    selectedIds: string[];
    onSelectedIdsChange: (ids: string[]) => void;
}

interface PendingUpload {
    id: string;
    filename: string;
    sizeBytes: number;
    error?: string;
}

function extensionFor(filename: string): string {
    const parts = filename.toLowerCase().split(".");
    return parts.length > 1 ? parts[parts.length - 1] : "";
}

function attachmentStatus(attachment: DialogChatAttachment): string {
    if (isDialogAttachmentReady(attachment)) return attachment.knowledge_path ? "已加入知识库" : "可引用";
    if (attachment.status === "failed") return attachment.error || "上传失败";
    return attachment.status || "处理中";
}

function formatKnowledgeLabel(attachment: DialogChatAttachment): string {
    return attachment.knowledge_path ? "已加入知识库" : "加入知识库";
}

export function DialogAttachments({sessionId, selectedIds, onSelectedIdsChange}: Props) {
    const inputRef = useRef<HTMLInputElement>(null);
    const identityRef = useRef<{sessionId: string; generation: number}>({sessionId, generation: 0});
    if (identityRef.current.sessionId !== sessionId) {
        identityRef.current = {
            sessionId,
            generation: identityRef.current.generation + 1,
        };
    }
    const selectedIdsRef = useRef(selectedIds);
    selectedIdsRef.current = selectedIds;
    const [attachments, setAttachments] = useState<DialogChatAttachment[]>([]);
    const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [promotingId, setPromotingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [selectionHint, setSelectionHint] = useState("");

    const isCurrent = useCallback((identity: {sessionId: string; generation: number}) =>
        identityRef.current.sessionId === identity.sessionId && identityRef.current.generation === identity.generation, []);

    const refresh = useCallback(async (identity: {sessionId: string; generation: number}) => {
        if (!identity.sessionId) {
            if (isCurrent(identity)) {
                setAttachments([]);
                setLoading(false);
            }
            return;
        }
        if (!isCurrent(identity)) return;
        setLoading(true);
        try {
            const result = await listChatAttachments(identity.sessionId);
            if (!isCurrent(identity)) return;
            setAttachments(normalizeDialogAttachments(result));
            setError("");
        } catch (caught) {
            if (isCurrent(identity)) setError(caught instanceof Error ? caught.message : "读取附件失败");
        } finally {
            if (isCurrent(identity)) setLoading(false);
        }
    }, [isCurrent]);

    useEffect(() => {
        const controller = new AbortController();
        const identity = identityRef.current;
        selectedIdsRef.current = [];
        onSelectedIdsChange([]);
        setPendingUploads([]);
        setError("");
        setSelectionHint("");
        setUploading(false);
        setPromotingId(null);
        setDeletingId(null);
        void refresh(identity);
        return () => controller.abort();
    }, [onSelectedIdsChange, refresh, sessionId]);

    const toggleAttachment = (id: string) => {
        if (!attachments.some((attachment) => attachment.id === id && isDialogAttachmentReady(attachment))) return;
        const currentSelected = selectedIdsRef.current;
        const nextIds = currentSelected.includes(id)
            ? currentSelected.filter((selectedId) => selectedId !== id)
            : currentSelected.length >= 5
                ? currentSelected
                : [...currentSelected, id];
        if (nextIds.length === currentSelected.length && !currentSelected.includes(id)) {
            setSelectionHint("本次最多引用 5 个文件，请先移除一个已选文件");
            return;
        }
        selectedIdsRef.current = nextIds;
        setSelectionHint("");
        onSelectedIdsChange(nextIds);
    };

    const removeSelected = (id: string) => {
        const nextIds = selectedIdsRef.current.filter((selectedId) => selectedId !== id);
        selectedIdsRef.current = nextIds;
        onSelectedIdsChange(nextIds);
        setSelectionHint("");
    };

    const uploadFiles = async (files: File[]) => {
        const identity = identityRef.current;
        if (!identity.sessionId || !files.length || !isCurrent(identity)) return;
        setError("");
        setSelectionHint("");
        setUploading(true);
        try {
            for (const file of files) {
                if (!isCurrent(identity)) return;
                const extension = extensionFor(file.name);
                if (!SUPPORTED_EXTENSIONS.has(extension)) {
                    setPendingUploads((current) => [...current, {
                        id: `upload-error-${Date.now()}-${file.name}`,
                        filename: file.name,
                        sizeBytes: file.size,
                        error: "仅支持 md、txt、pdf、docx 文件",
                    }]);
                    continue;
                }
                const pendingId = `upload-${Date.now()}-${file.name}`;
                setPendingUploads((current) => [...current, {id: pendingId, filename: file.name, sizeBytes: file.size}]);
                try {
                    const uploaded = normalizeDialogAttachment(await uploadChatAttachment(identity.sessionId, file));
                    if (!isCurrent(identity)) return;
                    setPendingUploads((current) => current.filter((item) => item.id !== pendingId));
                    if (uploaded) {
                        setAttachments((current) => [
                            ...current.filter((item) => item.id !== uploaded.id),
                            uploaded,
                        ]);
                        if (isDialogAttachmentReady(uploaded)) {
                            const currentSelected = selectedIdsRef.current;
                            if (!currentSelected.includes(uploaded.id)) {
                                if (currentSelected.length < 5) {
                                    const nextIds = [...currentSelected, uploaded.id];
                                    selectedIdsRef.current = nextIds;
                                    onSelectedIdsChange(nextIds);
                                } else {
                                    setSelectionHint("本次最多引用 5 个文件，请先移除一个已选文件");
                                }
                            }
                        }
                    }
                    await refresh(identity);
                } catch (caught) {
                    if (!isCurrent(identity)) return;
                    setPendingUploads((current) => current.map((item) => item.id === pendingId
                        ? {...item, error: caught instanceof Error ? caught.message : "上传失败"}
                        : item));
                }
            }
        } finally {
            if (isCurrent(identity)) {
                setUploading(false);
                setExpanded(true);
            }
        }
    };

    const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        event.target.value = "";
        void uploadFiles(files);
    };

    const promote = async (attachment: DialogChatAttachment) => {
        const identity = identityRef.current;
        if (!identity.sessionId || !isDialogAttachmentReady(attachment) || !isCurrent(identity)) return;
        setPromotingId(attachment.id);
        setError("");
        try {
            await promoteChatAttachment(identity.sessionId, attachment.id);
            if (!isCurrent(identity)) return;
            await refresh(identity);
        } catch (caught) {
            if (isCurrent(identity)) setError(caught instanceof Error ? caught.message : "加入知识库失败");
        } finally {
            if (isCurrent(identity)) setPromotingId(null);
        }
    };

    const removeAttachment = async (attachment: DialogChatAttachment) => {
        const identity = identityRef.current;
        if (!identity.sessionId || !isCurrent(identity)) return;
        setDeletingId(attachment.id);
        setError("");
        try {
            await deleteChatAttachment(identity.sessionId, attachment.id);
            if (!isCurrent(identity)) return;
            setAttachments((current) => current.filter((item) => item.id !== attachment.id));
            removeSelected(attachment.id);
        } catch (caught) {
            if (isCurrent(identity)) setError(caught instanceof Error ? caught.message : "删除附件失败");
        } finally {
            if (isCurrent(identity)) setDeletingId(null);
        }
    };

    const selectedAttachments = attachments.filter((attachment) => selectedIds.includes(attachment.id));

    return <div className={styles.wrapper}>
        <div className={styles.toolbar}>
            <input
                ref={inputRef}
                type="file"
                className={styles.fileInput}
                accept={ACCEPTED_FILE_TYPES}
                multiple
                onChange={onFileChange}
                aria-label="上传对话附件"
            />
            <Tooltip title={sessionId ? "上传 md、txt、pdf 或 docx" : "请先创建对话再上传文件"}>
                <Button
                    type="text"
                    size="small"
                    icon={uploading ? <LoadingOutlined spin /> : <PaperClipOutlined />}
                    disabled={!sessionId || uploading}
                    onClick={() => inputRef.current?.click()}
                    aria-label="上传附件"
                >附件</Button>
            </Tooltip>
            <button
                type="button"
                className={styles.manageButton}
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                aria-controls="dialog-attachment-library"
            >
                {selectedIds.length ? `已选 ${selectedIds.length} 个文件` : "选择文件"}
            </button>
            {loading && <span className={styles.inlineStatus} role="status"><LoadingOutlined spin /> 读取中</span>}
        </div>

        {selectedAttachments.length > 0 && <div className={styles.selected} aria-label="本次问题引用的文件">
            {selectedAttachments.map((attachment) => <span className={styles.selectedChip} key={attachment.id}>
                <PaperClipOutlined aria-hidden="true" />
                <span>{attachment.filename}</span>
                <button type="button" onClick={() => removeSelected(attachment.id)} aria-label={`移除文件 ${attachment.filename}`}>
                    <CloseCircleOutlined />
                </button>
            </span>)}
        </div>}

        {selectionHint && <div className={styles.selectionHint} role="status">{selectionHint}</div>}

        {expanded && <div className={styles.library} id="dialog-attachment-library" aria-label="当前会话文件">
            <div className={styles.libraryHeading}>
                <span>当前会话文件</span>
                <small>上传后可在后续问题中引用</small>
            </div>
            {!sessionId && <div className={styles.empty}>创建对话后即可上传文件。</div>}
            {sessionId && !loading && !attachments.length && !pendingUploads.length && <div className={styles.empty}>还没有附件。</div>}
            {pendingUploads.map((item) => <div className={`${styles.row} ${item.error ? styles.errorRow : ""}`} key={item.id} role={item.error ? "alert" : "status"}>
                <span className={styles.fileIcon}><PaperClipOutlined /></span>
                <div className={styles.fileMeta}>
                    <strong>{item.filename}</strong>
                    <small>{formatAttachmentSize(item.sizeBytes)} · {item.error || "上传中…"}</small>
                </div>
                {item.error ? <CloseCircleOutlined className={styles.errorIcon} aria-label={item.error} /> : <LoadingOutlined spin />}
            </div>)}
            {attachments.map((attachment) => {
                const ready = isDialogAttachmentReady(attachment);
                const selected = selectedIds.includes(attachment.id);
                return <div className={`${styles.row} ${selected ? styles.selectedRow : ""}`} key={attachment.id}>
                    <button
                        type="button"
                        className={styles.fileSelect}
                        disabled={!ready}
                        aria-pressed={selected}
                        aria-label={`${selected ? "取消引用" : "引用"} ${attachment.filename}`}
                        onClick={() => toggleAttachment(attachment.id)}
                    >
                        <span className={`${styles.checkbox} ${selected ? styles.checkboxOn : ""}`} aria-hidden="true">{selected && <CheckOutlined />}</span>
                    </button>
                    <span className={styles.fileIcon}><PaperClipOutlined /></span>
                    <div className={styles.fileMeta}>
                        <strong title={attachment.filename}>{attachment.filename}</strong>
                        <small>{formatAttachmentSize(attachment.size_bytes)} · {attachmentStatus(attachment)}</small>
                        {attachment.error && <small className={styles.errorText}>{attachment.error}</small>}
                    </div>
                    <div className={styles.rowActions}>
                        {ready && !attachment.knowledge_path && <button
                            type="button"
                            className={styles.knowledgeButton}
                            disabled={promotingId === attachment.id}
                            onClick={() => void promote(attachment)}
                        >{promotingId === attachment.id ? <LoadingOutlined spin /> : <DatabaseOutlined />} {formatKnowledgeLabel(attachment)}</button>}
                        <button
                            type="button"
                            className={styles.deleteButton}
                            disabled={deletingId === attachment.id}
                            onClick={() => void removeAttachment(attachment)}
                            aria-label={`删除附件 ${attachment.filename}`}
                        >{deletingId === attachment.id ? <LoadingOutlined spin /> : <DeleteOutlined />}</button>
                    </div>
                </div>;
            })}
        </div>}
        {error && <div className={styles.error} role="alert">{error}</div>}
    </div>;
}

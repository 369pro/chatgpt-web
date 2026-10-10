/**
 * Queue metadata returned by the server. The array order from session detail
 * is not a FIFO guarantee, so callers must use this helper for open runs.
 */
export interface QueueRunMetadata {
    run_id: string;
    queue_position?: number | null;
    is_queue_head?: boolean;
}

function positionOf(run: QueueRunMetadata): number | undefined {
    return typeof run.queue_position === "number"
        && Number.isInteger(run.queue_position)
        && run.queue_position > 0
        ? run.queue_position
        : undefined;
}

/** Sort only by server queue metadata. Stable input order is retained when metadata is absent. */
export function orderQueuedRuns<T extends QueueRunMetadata>(runs: readonly T[]): T[] {
    return runs.slice().sort((a, b) => {
        const aHead = a.is_queue_head === true;
        const bHead = b.is_queue_head === true;
        if (aHead !== bHead) return aHead ? -1 : 1;
        const aPosition = positionOf(a);
        const bPosition = positionOf(b);
        if (aPosition === undefined || bPosition === undefined) return 0;
        return aPosition - bPosition;
    });
}

/** Find the server-declared head; an explicit active run id is only a fallback. */
export function queueHead<T extends QueueRunMetadata>(runs: readonly T[], preferredRunId?: string | null): T | undefined {
    return runs.find((run) => run.is_queue_head === true)
        || runs.find((run) => positionOf(run) === 1)
        || (preferredRunId ? runs.find((run) => run.run_id === preferredRunId) : undefined);
}

export function queuePosition(run: QueueRunMetadata, headRunId?: string | null): number | null {
    const position = positionOf(run);
    if (position !== undefined) return position;
    if (run.is_queue_head === true || (headRunId && run.run_id === headRunId)) return 1;
    return null;
}

/**
 * Merge a durable run snapshot without allowing an older response to erase
 * output already rendered after a reconnect. The agent API appends output, so
 * the longest snapshot is the newest useful value when responses race.
 */
export interface RecoveryRunSnapshot {
    run_id: string;
    status: string;
    output?: string;
    error?: string | null;
    updated_at?: string;
    created_at?: string;
    started_at?: string | null;
    finished_at?: string | null;
}

const TERMINAL_STATUSES = new Set([
    "succeeded",
    "failed",
    "cancelled",
    "budget_exhausted",
    "interrupted",
]);

function timestamp(value?: string | null): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function runTime(run: RecoveryRunSnapshot): number {
    return Math.max(
        timestamp(run.created_at),
        timestamp(run.updated_at),
        timestamp(run.started_at),
        timestamp(run.finished_at),
    );
}

/**
 * Same-run snapshots are idempotent. A terminal state wins over a stale
 * running state even when the stale response arrived later, while fields from
 * the newest response are retained for all other metadata.
 */
export function mergeRunSnapshot<T extends RecoveryRunSnapshot>(previous: T | undefined, next: T): T {
    if (!previous || previous.run_id !== next.run_id) return next;

    const previousTerminal = TERMINAL_STATUSES.has(previous.status);
    const nextTerminal = TERMINAL_STATUSES.has(next.status);
    const preferred = previousTerminal && !nextTerminal
        ? previous
        : nextTerminal && !previousTerminal
            ? next
            : runTime(next) >= runTime(previous)
                ? next
                : previous;

    const previousOutput = typeof previous.output === "string" ? previous.output : "";
    const nextOutput = typeof next.output === "string" ? next.output : "";
    return {
        ...preferred,
        output: nextOutput.length >= previousOutput.length ? nextOutput : previousOutput,
    } as T;
}

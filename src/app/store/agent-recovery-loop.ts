export interface DurableRunState {
    run_id: string;
    status: string;
}

export interface DurableRunEvent {
    seq: number;
}

export interface RunEventsSnapshot<Run extends DurableRunState, Event extends DurableRunEvent = DurableRunEvent> {
    events: Event[];
    run: Run;
}

export interface RunPollOptions<Run extends DurableRunState, Event extends DurableRunEvent = DurableRunEvent> {
    initialRun: Run;
    readEvents: (runId: string, after: number) => Promise<RunEventsSnapshot<Run, Event>>;
    onSnapshot: (run: Run) => void | Promise<void>;
    isCurrent: () => boolean;
    wait: (milliseconds: number) => Promise<void>;
    isTerminal: (status: string) => boolean;
    pollDelay?: number;
    retryDelay?: (failures: number) => number;
}

/**
 * Poll one durable run with a cursor local to this invocation. A temporary
 * network outage never cancels the server-owned run: retries continue with
 * bounded backoff until the account/session is no longer current or the run
 * reaches a terminal state.
 */
export async function pollDurableRun<Run extends DurableRunState, Event extends DurableRunEvent = DurableRunEvent>(
    options: RunPollOptions<Run, Event>,
): Promise<void> {
    let cursor = 0;
    let failures = 0;
    let snapshot = options.initialRun;

    while (options.isCurrent()) {
        try {
            const result = await options.readEvents(snapshot.run_id, cursor);
            if (!options.isCurrent()) return;
            for (const event of result.events) {
                if (typeof event.seq === "number" && Number.isFinite(event.seq)) {
                    cursor = Math.max(cursor, event.seq);
                }
            }
            failures = 0;
            snapshot = result.run;
            await options.onSnapshot(snapshot);
            if (options.isTerminal(snapshot.status)) return;
        } catch {
            failures += 1;
        }
        await options.wait(failures ? (options.retryDelay || ((count) => Math.min(10000, count * 1000)))(failures) : (options.pollDelay ?? 700));
    }
}

export interface SessionSyncOptions<Session> {
    getSession: () => Session | undefined;
    isCurrent: () => boolean;
    shouldRefresh: (session: Session) => boolean;
    wait: (milliseconds: number) => Promise<void>;
    refresh: (session: Session) => Promise<Session | undefined>;
    onSession: (session: Session) => void;
    delayFor: (session: Session) => number;
    retryDelay?: (failures: number) => number;
}

/**
 * Keep a loaded session synchronized while it is visible or has an active
 * run. Inactive hidden sessions only wait for a wake event and do not issue
 * full-history requests, which bounds background traffic as the user opens
 * more conversations.
 */
export async function syncDurableSession<Session>(options: SessionSyncOptions<Session>): Promise<void> {
    let failures = 0;
    while (options.isCurrent()) {
        const session = options.getSession();
        if (!session) return;
        await options.wait(options.delayFor(session));
        if (!options.isCurrent()) return;

        const current = options.getSession();
        if (!current || !options.shouldRefresh(current)) continue;
        try {
            const refreshed = await options.refresh(current);
            failures = 0;
            if (refreshed) options.onSession(refreshed);
        } catch {
            failures += 1;
            await options.wait(options.retryDelay
                ? options.retryDelay(failures)
                : Math.min(10000, failures * 1000));
        }
    }
}


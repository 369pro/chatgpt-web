import assert from 'node:assert/strict';
import test from 'node:test';
import {pollDurableRun, syncDurableSession} from './agent-recovery-loop.ts';

const noWait = async () => {};

test('run polling resumes after more than eight network failures', async () => {
    let calls = 0;
    const snapshots = [];
    const initial = {run_id: 'run-1', status: 'running', output: ''};

    await pollDurableRun({
        initialRun: initial,
        isCurrent: () => true,
        isTerminal: (status) => status === 'succeeded',
        wait: noWait,
        readEvents: async (runId, after) => {
            calls += 1;
            assert.equal(runId, 'run-1');
            if (calls <= 9) throw new Error('offline');
            assert.equal(after, 0);
            return {events: [{seq: 1}], run: {run_id: runId, status: 'succeeded', output: 'recovered'}};
        },
        onSnapshot: (run) => snapshots.push(run),
    });

    assert.equal(calls, 10);
    assert.equal(snapshots.at(-1).output, 'recovered');
});

test('two pollers keep independent event cursors for the same durable run', async () => {
    const cursors = [[], []];
    await Promise.all(cursors.map((seen) => {
        let reads = 0;
        return pollDurableRun({
            initialRun: {run_id: 'shared-run', status: 'running', output: ''},
            isCurrent: () => true,
            isTerminal: (status) => status === 'succeeded',
            wait: noWait,
            readEvents: async (runId, after) => {
                seen.push(after);
                reads += 1;
                return reads === 1
                    ? {events: [{seq: 4}], run: {run_id: runId, status: 'running', output: 'partial'}}
                    : {events: [], run: {run_id: runId, status: 'succeeded', output: 'answer'}};
            },
            onSnapshot: () => {},
        });
    }));

    assert.deepEqual(cursors, [[0, 4], [0, 4]]);
});

test('idle synchronization discovers a completed short run started by another window', async () => {
    let refreshCount = 0;
    let current = {active: false, latestRun: 'run-1'};
    const seen = [];

    await syncDurableSession({
        getSession: () => current,
        isCurrent: () => refreshCount < 2,
        shouldRefresh: () => true,
        delayFor: () => 0,
        wait: noWait,
        refresh: async () => {
            refreshCount += 1;
            current = refreshCount === 1
                ? {active: false, latestRun: 'run-1'}
                : {active: false, latestRun: 'run-2'};
            return current;
        },
        onSession: (session) => seen.push(session.latestRun),
    });

    assert.deepEqual(seen, ['run-1', 'run-2']);
});

test('session synchronization retries after a transient detail failure', async () => {
    let refreshCount = 0;
    let current = {active: false, latestRun: 'run-2'};
    const seen = [];

    await syncDurableSession({
        getSession: () => current,
        isCurrent: () => refreshCount < 2,
        shouldRefresh: () => true,
        delayFor: () => 0,
        wait: noWait,
        refresh: async () => {
            refreshCount += 1;
            if (refreshCount === 1) throw new Error('temporary detail outage');
            return current;
        },
        onSession: (session) => seen.push(session.latestRun),
    });

    assert.equal(refreshCount, 2);
    assert.deepEqual(seen, ['run-2']);
});

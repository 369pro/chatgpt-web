import assert from 'node:assert/strict';
import test from 'node:test';
import {mergeRunSnapshot} from './agent-recovery.ts';

const run = (overrides = {}) => ({
    run_id: 'run-1',
    status: 'running',
    output: '',
    updated_at: '2026-10-08T00:00:00Z',
    ...overrides,
});

test('a reconnect does not regress a durable output snapshot or terminal state', () => {
    const complete = run({
        status: 'succeeded',
        output: 'a complete answer',
        updated_at: '2026-10-08T00:00:02Z',
    });
    const stale = run({
        status: 'running',
        output: 'a',
        updated_at: '2026-10-08T00:00:01Z',
    });

    assert.deepEqual(mergeRunSnapshot(complete, stale), complete);
});

test('a newer snapshot advances the independent run cursor state', () => {
    const first = run({output: 'first'});
    const second = run({output: 'first second', updated_at: '2026-10-08T00:00:03Z'});

    assert.deepEqual(mergeRunSnapshot(first, second), second);
    assert.notEqual(first.output, second.output);
});

test('snapshots from different runs are never combined', () => {
    const first = run({output: 'first'});
    const second = run({run_id: 'run-2', output: 'second'});

    assert.equal(mergeRunSnapshot(first, second), second);
});


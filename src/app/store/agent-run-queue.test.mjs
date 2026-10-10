import assert from "node:assert/strict";
import test from "node:test";
import {orderQueuedRuns, queueHead, queuePosition} from "./agent-run-queue.ts";

test("server queue metadata wins over descending detail order and timestamps", () => {
    const runs = [
        {run_id: "new", created_at: "2026-10-09T10:03:00Z", queue_position: 2, is_queue_head: false},
        {run_id: "head", created_at: "2026-10-09T10:01:00Z", queue_position: 1, is_queue_head: true},
    ];
    assert.deepEqual(orderQueuedRuns(runs).map((run) => run.run_id), ["head", "new"]);
    assert.equal(queueHead(runs)?.run_id, "head");
    assert.equal(queuePosition(runs[0], "head"), 2);
    assert.equal(queuePosition(runs[1], "head"), 1);
});

test("a missing position does not invent FIFO from time or run id", () => {
    const runs = [
        {run_id: "newer", created_at: "2026-10-09T10:03:00Z"},
        {run_id: "older", created_at: "2026-10-09T10:01:00Z"},
    ];
    assert.deepEqual(orderQueuedRuns(runs).map((run) => run.run_id), ["newer", "older"]);
    assert.equal(queueHead(runs)?.run_id, undefined);
    assert.equal(queuePosition(runs[0]), null);
});

test("a partial view containing only position two has no inferred head", () => {
    const runs = [{run_id: "second", queue_position: 2, is_queue_head: false}];
    assert.deepEqual(orderQueuedRuns(runs).map((run) => run.run_id), ["second"]);
    assert.equal(queueHead(runs), undefined);
    assert.equal(queuePosition(runs[0]), 2);
});

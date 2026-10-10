import assert from 'node:assert/strict';
import test from 'node:test';
import {agentSessionIdFromPath, agentSessionPath} from './agent-session-route.ts';

test('session URLs round-trip IDs containing route characters', () => {
    const id = 'session/with spaces?and#symbols';
    const path = agentSessionPath(id);

    assert.equal(path, '/chat/session%2Fwith%20spaces%3Fand%23symbols');
    assert.equal(agentSessionIdFromPath(path), id);
});

test('non-chat and malformed paths do not select a session', () => {
    assert.equal(agentSessionIdFromPath('/market'), '');
    assert.equal(agentSessionIdFromPath('/chat/%E0%A4%A'), '');
});


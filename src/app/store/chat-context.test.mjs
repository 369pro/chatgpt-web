import assert from 'node:assert/strict';
import test from 'node:test';
import {formatMessages} from './chat-context.ts';

const msg = (role, content, status) => ({role, content, status});

test('retains system instructions and earlier question-answer pairs when sending', () => {
    const history = [
        msg('system', 'You are an interviewer'),
        msg('user', 'My project uses Redis'),
        msg('assistant', 'How do you prevent overselling?'),
        msg('user', 'I use atomic stock deduction'),
        msg('assistant', 'Explain recovery'),
        msg('user', 'What was my original project?'),
        msg('assistant', '', 'sending'),
    ];
    assert.deepEqual(formatMessages(history), history.slice(0, -1).map(({role, content}) => ({role, content})));
});

test('failed, cancelled, pending and empty content never replace valid earlier history', () => {
    const history = [msg('user', 'Keep this'), msg('assistant', 'Answer'),
        msg('assistant', 'partial failure', 'error'), msg('assistant', 'partial cancellation', 'cancelled'),
        msg('assistant', 'pending', 'sending'), msg('assistant', '   ')];
    assert.deepEqual(formatMessages(history), [{role: 'user', content: 'Keep this'}, {role: 'assistant', content: 'Answer'}]);
});

test('clear-context and retry boundaries provided by callers are preserved without mutation', () => {
    const history = [msg('user', 'old private context'), msg('user', 'new context'), msg('assistant', '', 'error')];
    const before = JSON.stringify(history);
    assert.deepEqual(formatMessages(history.slice(1, 2)), [{role: 'user', content: 'new context'}]);
    assert.equal(JSON.stringify(history), before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {displayAssistantContent} from './message-display.ts';

test('legacy summary tags do not become invented webpage citations', () => {
    const result = displayAssistantContent('天气晴朗 [search_summary]。\n温度较高 [search_summary] [2]');
    assert.equal(result.content, '天气晴朗。\n温度较高 [2]');
    assert.equal(result.hasSearchSummary, true);
});

test('literal markers in code and normal citations are preserved', () => {
    const text = '使用 `[search_summary]`\n```text\n[search_summary]\n```\n事实 [1]';
    assert.deepEqual(displayAssistantContent(text), {content: text, hasSearchSummary: false});
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTelegramChannelSource } from './telegramChannelSource.js';

test('channel downloads resolve public post links to the channel', () => {
    for (const input of [
        'https://t.me/mianmia1/2104',
        '[https://t.me/mianmia1/2104](https://t.me/mianmia1/2104)',
        '[频道文件](https://t.me/mianmia1/2104)',
        ' t.me/mianmia1/2104 ',
        'https://t.me/s/mianmia1/2104?single',
        'https://telegram.me/mianmia1',
        'mianmia1',
        '@mianmia1',
    ]) assert.equal(normalizeTelegramChannelSource(input), '@mianmia1');
});

test('preserves peer IDs and private links for their existing resolution paths', () => {
    for (const input of ['-1001234567890', 'https://t.me/+Abc_123', 'https://t.me/joinchat/Abc_123', 'https://t.me/c/123456/2104']) {
        assert.equal(normalizeTelegramChannelSource(input), input);
    }
});

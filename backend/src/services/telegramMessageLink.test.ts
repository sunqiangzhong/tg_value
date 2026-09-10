import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTelegramMessageLink, runTelegramMessageLinkDownload } from './telegramMessageLink.js';

test('parses a single public post, including Markdown and web previews', () => {
    for (const link of ['https://t.me/lspyanxi/4375', '[视频](https://t.me/lspyanxi/4375)', ' t.me/lspyanxi/4375 ', 'https://t.me/s/lspyanxi/4375?single', 'https://telegram.me/lspyanxi/4375']) {
        assert.deepEqual(parseTelegramMessageLink(link), { source: '@lspyanxi', messageId: 4375 });
    }
    assert.deepEqual(parseTelegramMessageLink('https://t.me/c/1234567890/4375'), { source: '-1001234567890', messageId: 4375 });
});

test('rejects channel-only links, invite links, invalid IDs and unrelated text', () => {
    for (const link of ['https://t.me/lspyanxi', 'https://t.me/+abcd', 'https://t.me/joinchat/123', 'https://t.me/lspyanxi/0', 'https://t.me/lspyanxi/2147483648', 'https://t.me/lspyanxi/1/2', 'https://evil.com/lspyanxi/4375', 'https://t.me.evil.com/lspyanxi/4375', '下载 https://t.me/lspyanxi/4375', 'https://t.me/c/0/1']) {
        assert.equal(parseTelegramMessageLink(link), null, link);
    }
});

test('downloads only the requested message with the selected chat target', async () => {
    const target = { provider: 'local', accountId: 'chat-selected' };
    const result = await runTelegramMessageLinkDownload({ source: '@lspyanxi', messageId: 4375 }, {
        assertSourceAllowed: async source => { assert.equal(source, '@lspyanxi'); },
        getTarget: async () => target,
        download: async (source, ids, actualTarget) => {
            assert.equal(source, '@lspyanxi');
            assert.deepEqual(ids, [4375]);
            assert.equal(actualTarget, target);
            return { successful: 1, failed: 0 };
        },
    });
    assert.equal(result.successful, 1);
});

test('denied sources cannot consume a target or start a download', async () => {
    await assert.rejects(runTelegramMessageLinkDownload({ source: '@blocked', messageId: 1 }, {
        assertSourceAllowed: async () => { throw new Error('denied'); },
        getTarget: async () => { assert.fail('target consumed'); },
        download: async () => { assert.fail('download started'); },
    }), /denied/);
});

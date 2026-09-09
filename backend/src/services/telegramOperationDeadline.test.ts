import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { withTelegramOperationDeadline } from './telegramOperationDeadline.js';

const source = fs.readFileSync(new URL('./telegramOperationDeadline.ts', import.meta.url), 'utf8');

test('Telegram operation deadline rejects a stalled operation without Promise.race', async () => {
    assert.doesNotMatch(source, /Promise\.race/);
    const pending = new Promise<void>(() => undefined);
    // Production always has a listening server. Keep this isolated test process
    // alive while exercising the deliberately unref'ed deadline timer.
    const keepAlive = setTimeout(() => undefined, 1_000);
    try {
        await assert.rejects(
            () => withTelegramOperationDeadline(pending, 5, 'Telegram operation timed out'),
            /Telegram operation timed out/,
        );
    } finally {
        clearTimeout(keepAlive);
    }
});

test('Telegram operation deadline clears its timer after completion', async () => {
    await assert.doesNotReject(() => withTelegramOperationDeadline(Promise.resolve('ok'), 100, 'timeout'));
});

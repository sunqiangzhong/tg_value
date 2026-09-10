import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTelegramProgressInterval, startTelegramProgressTicker } from './telegramProgressSettings.js';
import { normalizeAdvancedSettingsPatch } from '../utils/advancedSettings.js';

test('progress intervals share the panel validation contract', () => {
    for (const value of [3, 5, 10, 15, 30, 60]) {
        assert.equal(normalizeTelegramProgressInterval(value), value);
        assert.equal(normalizeAdvancedSettingsPatch({ telegramProgressIntervalSeconds: value }).telegramProgressIntervalSeconds, value);
    }
    for (const value of [0, 1, -5, 3.5, 61, 'bad', null]) {
        assert.throws(() => normalizeTelegramProgressInterval(value));
        assert.throws(() => normalizeAdvancedSettingsPatch({ telegramProgressIntervalSeconds: value }));
    }
});

test('ticker waits for an edit, adopts interval changes, and stops scheduling', async () => {
    let delay = 5000;
    let finish!: () => void;
    let refreshes = 0;
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    let cancelled = 0;
    const stop = startTelegramProgressTicker(async () => {
        refreshes++;
        await new Promise<void>(resolve => { finish = resolve; });
    }, async () => delay, (callback, ms) => {
        scheduled.push({ callback, delay: ms });
        return { unref() {} } as ReturnType<typeof setTimeout>;
    }, () => { cancelled++; });
    await Promise.resolve();
    assert.equal(scheduled[0].delay, 5000);
    scheduled[0].callback();
    await Promise.resolve();
    assert.equal(refreshes, 1);
    assert.equal(scheduled.length, 1);
    delay = 10000;
    finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(scheduled[1].delay, 10000);
    await stop();
    scheduled[1].callback();
    await Promise.resolve();
    assert.equal(refreshes, 1);
    assert.equal(cancelled, 1);
    assert.equal(scheduled.length, 2);
});

test('stopping before interval lookup resolves never starts a timer', async () => {
    let resolveInterval!: (value: number) => void;
    const stop = startTelegramProgressTicker(async () => { assert.fail('edit'); }, () => new Promise(resolve => { resolveInterval = resolve; }), () => { assert.fail('scheduled'); });
    const done = stop();
    resolveInterval(5000);
    await done;
});

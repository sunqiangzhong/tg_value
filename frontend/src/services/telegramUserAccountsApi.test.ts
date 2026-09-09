import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const listeners = new Map<string, Set<(event: Event) => void>>();
const storage = new Map<string, string>();
storage.set('tg-vault.locale', 'zh-CN');
const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) };
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage });
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage,
    setTimeout, clearTimeout,
    addEventListener: (type: string, listener: (event: Event) => void) => { const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set); },
    removeEventListener: (type: string, listener: (event: Event) => void) => listeners.get(type)?.delete(listener),
    dispatchEvent: (event: Event) => { listeners.get(event.type)?.forEach(listener => listener(event)); return true; },
} });

const { fileApi } = await import('./api');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

function mockJson(payload: unknown) {
    globalThis.fetch = (async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
}

test('QR login adapter maps backend pending/qrData to the public polling contract without exposing raw fields', async () => {
    mockJson({ flowId: 'qr-1', status: 'pending', qrData: 'tg://login?token=secret', expiresAt: '2026-08-29T12:00:00.000Z', version: 1 });
    assert.deepEqual(await fileApi.startTelegramUserQrLogin(), {
        flowId: 'qr-1', status: 'waiting_for_scan', qrCode: 'tg://login?token=secret', qrExpiresAt: '2026-08-29T12:00:00.000Z', expiresAt: '2026-08-29T12:00:00.000Z',
    });
});

test('phone and 2FA responses normalize legacy backend step responses into UI states', async () => {
    mockJson({ flowId: 'phone-1', delivery: 'app', expiresAt: '2026-08-29T12:00:00.000Z' });
    assert.deepEqual(await fileApi.startTelegramUserPhoneLogin('+86…'), {
        flowId: 'phone-1', status: 'code_required', expiresAt: '2026-08-29T12:00:00.000Z', delivery: 'app', message: 'Telegram 应用',
    });

    mockJson({ step: 'password_required' });
    assert.deepEqual(await fileApi.submitTelegramUserLoginCode('phone-1', '12345'), { flowId: 'phone-1', status: 'password_required' });

    mockJson({ step: 'complete', account: { userId: '42', username: 'vault', displayName: null } });
    assert.deepEqual(await fileApi.submitTelegramUserLoginPassword('phone-1', 'secret'), {
        flowId: 'phone-1', status: 'complete', account: { userId: '42', username: 'vault', displayName: null },
    });
});

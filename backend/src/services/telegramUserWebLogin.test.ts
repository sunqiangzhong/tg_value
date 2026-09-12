import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramUserWebLoginFlows, TelegramUserLoginFlowError } from './telegramUserWebLogin.js';

test('legacy handoff never activates after failed disconnect', async () => {
    const fx = fixture();
    const started = await fx.flows.start('admin', '+8613800138000');
    fx.clients[0].disconnect = async () => { throw new Error('disconnect failed'); };
    await assert.rejects(fx.flows.submitCode('admin', started.flowId, '12345'));
    assert.deepEqual(fx.saved, []);
});

type FakeClient = {
    disconnects: number;
    destroyCount: number;
    connect(): Promise<void>;
    sendCode(_credentials: unknown, phone: string): Promise<{ phoneCodeHash: string; isCodeViaApp: boolean }>;
    signInCode(phone: string, hash: string, code: string): Promise<'authorized' | 'password_needed'>;
    signInPassword(password: string): Promise<void>;
    getMe(): Promise<{ id: string; username?: string; firstName?: string; lastName?: string }>;
    saveSession(): string;
    disconnect(): Promise<void>;
    destroy(): Promise<void>;
};

function fixture(now = 1_000) {
    const clients: FakeClient[] = [];
    const saved: Array<{ session: string; enabled: boolean }> = [];
    const flows = new TelegramUserWebLoginFlows<FakeClient>({
        now: () => now,
        ttlMs: 5 * 60_000,
        maxErrors: 3,
        credentials: async () => ({ apiId: 123, apiHash: 'a'.repeat(32) }),
        createClient: () => {
            const client: FakeClient = {
                disconnects: 0,
                destroyCount: 0,
                async connect() {},
                async sendCode(_credentials, phone) {
                    assert.equal(phone, '+8613800138000');
                    return { phoneCodeHash: 'server-only-hash', isCodeViaApp: true };
                },
                async signInCode(_phone, hash, code) {
                    assert.equal(hash, 'server-only-hash');
                    if (code === '00000') throw new Error('PHONE_CODE_INVALID');
                    return code === '22222' ? 'password_needed' : 'authorized';
                },
                async signInPassword(password) {
                    if (password !== 'correct horse') throw new Error('PASSWORD_HASH_INVALID');
                },
                async getMe() { return { id: '42', username: 'vault_owner', firstName: 'Vault' }; },
                saveSession() { return 'SECRET_STRING_SESSION'; },
                async disconnect() { this.disconnects += 1; },
                async destroy() { this.destroyCount += 1; },
            };
            clients.push(client);
            return client;
        },
        persistAndActivate: async (session, account) => {
            assert.equal(clients.at(-1)?.disconnects, 1);
            assert.equal(clients.at(-1)?.destroyCount, 1);
            assert.equal(account.userId, '42');
            saved.push({ session, enabled: true });
        },
    });
    return { flows, clients, saved, advance(ms: number) { now += ms; } };
}

test('phone -> code finalizes a session without exposing phone hash or StringSession', async () => {
    const fx = fixture();
    const started = await fx.flows.start('web-session-a', '+86 138 0013 8000');
    assert.deepEqual(Object.keys(started).sort(), ['delivery', 'expiresAt', 'flowId']);
    assert.equal(JSON.stringify(started).includes('server-only-hash'), false);

    const completed = await fx.flows.submitCode('web-session-a', started.flowId, '12345');
    assert.deepEqual(completed, {
        step: 'complete',
        account: { userId: '42', username: 'vault_owner', displayName: 'Vault' },
    });
    assert.deepEqual(fx.saved, [{ session: 'SECRET_STRING_SESSION', enabled: true }]);
    assert.equal(JSON.stringify(completed).includes('SECRET_STRING_SESSION'), false);
    assert.equal(fx.clients[0].disconnects, 1);
    assert.equal(fx.clients[0].destroyCount, 1);
});

test('code can require 2FA and the flow is bound to the current Web session', async () => {
    const fx = fixture();
    const started = await fx.flows.start('web-session-a', '+8613800138000');
    await assert.rejects(
        fx.flows.submitCode('different-web-session', started.flowId, '22222'),
        (error: unknown) => error instanceof TelegramUserLoginFlowError && error.code === 'FLOW_NOT_FOUND',
    );
    assert.deepEqual(await fx.flows.submitCode('web-session-a', started.flowId, '22222'), { step: 'password_required' });
    const completed = await fx.flows.submitPassword('web-session-a', started.flowId, 'correct horse');
    assert.equal(completed.step, 'complete');
    assert.equal(fx.saved.length, 1);
});

test('flows expire after five minutes and enforce a per-flow error limit', async () => {
    const fx = fixture();
    const expired = await fx.flows.start('web-session-a', '+8613800138000');
    fx.advance(5 * 60_000 + 1);
    await assert.rejects(
        fx.flows.submitCode('web-session-a', expired.flowId, '12345'),
        (error: unknown) => error instanceof TelegramUserLoginFlowError && error.code === 'FLOW_EXPIRED',
    );
    assert.equal(fx.clients[0].disconnects, 1);

    const limited = await fx.flows.start('web-session-a', '+8613800138000');
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await assert.rejects(fx.flows.submitCode('web-session-a', limited.flowId, '00000'));
    }
    await assert.rejects(
        fx.flows.submitCode('web-session-a', limited.flowId, '12345'),
        (error: unknown) => error instanceof TelegramUserLoginFlowError && error.code === 'TOO_MANY_ERRORS',
    );
    assert.equal(fx.clients[1].disconnects, 1);
});

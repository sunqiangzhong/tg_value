import assert from 'node:assert/strict';
import test from 'node:test';
import { getTelegramProxy } from './telegramProxy.js';

test('parses a SOCKS5 Telegram proxy', () => {
    const previous = process.env.TELEGRAM_PROXY_URL;
    process.env.TELEGRAM_PROXY_URL = 'socks5://user:p%40ss@192.168.5.199:7890';
    try {
        assert.deepEqual(getTelegramProxy(), {
            ip: '192.168.5.199', port: 7890, socksType: 5, timeout: 15,
            username: 'user', password: 'p@ss',
        });
    } finally {
        if (previous === undefined) delete process.env.TELEGRAM_PROXY_URL;
        else process.env.TELEGRAM_PROXY_URL = previous;
    }
});

test('rejects an HTTP URL because GramJS requires SOCKS', () => {
    const previous = process.env.TELEGRAM_PROXY_URL;
    process.env.TELEGRAM_PROXY_URL = 'http://192.168.5.199:7890';
    try {
        assert.throws(() => getTelegramProxy(), /仅支持 socks4:\/\/ 或 socks5:\/\//);
    } finally {
        if (previous === undefined) delete process.env.TELEGRAM_PROXY_URL;
        else process.env.TELEGRAM_PROXY_URL = previous;
    }
});

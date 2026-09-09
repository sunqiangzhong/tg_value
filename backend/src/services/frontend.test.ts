import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mountFrontend, isSameOriginRequest } from './frontend.js';

test('integrated frontend serves SPA routes without swallowing API and missing assets', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'vault-ui-'));
    mkdirSync(path.join(root, 'assets'));
    writeFileSync(path.join(root, 'index.html'), '<html>vault</html>');
    writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log(1)');
    const app = express();
    app.post('/origin', (req, res) => res.sendStatus(isSameOriginRequest(req) ? 204 : 403));
    mountFrontend(app, root);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    try {
        for (const route of ['/', '/files', '/settings']) {
            const response = await fetch(base + route);
            assert.equal(response.status, 200);
            assert.equal(await response.text(), '<html>vault</html>');
            assert.equal(response.headers.get('cache-control'), 'no-cache');
        }
        for (const route of ['/api/missing', '/assets/missing.js', '/uploads/missing']) {
            assert.equal((await fetch(base + route)).status, 404);
        }
        assert.match((await fetch(base + '/assets/app.js')).headers.get('cache-control')!, /immutable/);
        assert.equal((await fetch(base + '/origin', { method: 'POST', headers: { Origin: base } })).status, 204);
        assert.equal((await fetch(base + '/origin', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        rmSync(root, { recursive: true, force: true });
    }
});

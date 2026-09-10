import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

export function isSameOriginRequest(req: express.Request): boolean {
    const origin = req.headers.origin;
    if (!origin) return false;
    let host = req.get('host');
    const trust = req.app.get('trust proxy fn');
    // Match Express's protocol/hostname trust boundary, but retain the public port.
    if (req.socket.remoteAddress && trust?.(req.socket.remoteAddress, 0)) {
        host = req.get('x-forwarded-host')?.split(',')[0].trim() || host;
    }
    if (!host) return false;
    return origin === `${req.protocol}://${host}`;
}

export function mountFrontend(app: express.Express, directory: string): void {
    const root = path.resolve(directory);
    if (!fs.existsSync(path.join(root, 'index.html'))) {
        throw new Error(`Frontend build missing: ${root}/index.html`);
    }
    // Never turn an unknown API or protected media URL into the SPA document.
    app.use(['/api', '/uploads', '/thumbnails', '/previews'], (_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });
    app.use(express.static(root, {
        setHeaders(res, filePath) {
            res.setHeader('Cache-Control', filePath.includes(`${path.sep}assets${path.sep}`)
                ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
    }));
    app.get('*', (req, res, next) => {
        if (path.extname(req.path) || !req.accepts('html')) return next();
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(root, 'index.html'));
    });
}

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

export function isSameOriginRequest(req: express.Request): boolean {
    const origin = req.headers.origin;
    if (!origin || !req.get('host')) return false;
    return origin === `${req.protocol}://${req.get('host')}`;
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

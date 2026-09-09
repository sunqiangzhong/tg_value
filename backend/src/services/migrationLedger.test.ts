import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const db = fs.readFileSync(new URL('../db/index.ts', import.meta.url), 'utf8');
const schema = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const init = fs.readFileSync(new URL('../../../init.sql', import.meta.url), 'utf8');
const trigram = fs.readFileSync(new URL('../db/migrations/2026082901_file_search_trigram.sql', import.meta.url), 'utf8');
const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
const durableDerivatives = fs.readFileSync(new URL('../db/migrations/2026082903_durable_media_derivatives.sql', import.meta.url), 'utf8');
const telegramAuthRepair = fs.readFileSync(new URL('../db/migrations/2026091001_ensure_telegram_auth.sql', import.meta.url), 'utf8');

test('database startup uses immutable incremental migrations under an advisory lock', () => {
    assert.match(schema, /CREATE TABLE IF NOT EXISTS schema_migrations/);
    assert.match(db, /MIGRATIONS_DIR/);
    assert.match(db, /pg_advisory_lock/);
    assert.match(db, /checksum\/name mismatch/);
    assert.match(db, /INSERT INTO schema_migrations/);
    assert.doesNotMatch(db, /inDollarQuote|split SQL|CANONICAL_SCHEMA_VERSION/);
});

test('each pending migration runs in its own transaction without rewriting applied checksums', () => {
    assert.match(db, /for \(const migration of await listMigrations\(\)\)/);
    assert.match(db, /await client\.query\('BEGIN'\)/);
    assert.match(db, /await client\.query\('COMMIT'\)/);
    assert.doesNotMatch(db, /ON CONFLICT \(version\) DO UPDATE/);
});

test('first-install init remains generated from the canonical schema snapshot', () => {
    assert.match(init, /GENERATED FROM backend\/src\/db\/schema\.sql/);
    assert.match(init, /schema_migrations/);
    assert.match(init, /telegram_notification_preferences/);
});

test('file search migration enables trigram indexes for infix search', () => {
    assert.match(trigram, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
    assert.match(trigram, /name gin_trgm_ops/);
    assert.match(trigram, /folder gin_trgm_ops/);
});

test('production build ships immutable migration files beside the bundled entrypoint', () => {
    assert.match(db, /MIGRATIONS_DIR = path\.join\(__dirname, 'migrations'\)/);
    assert.match(dockerfile, /COPY --from=builder \/app\/src\/db\/migrations \.\/dist\/migrations/);
});

test('durable media derivative migration persists recovery metadata and a pending-work index', () => {
    assert.match(durableDerivatives, /derivative_source_path/);
    assert.match(durableDerivatives, /derivative_cleanup_source/);
    assert.match(durableDerivatives, /idx_files_derivative_pending/);
});

test('legacy databases receive the Telegram authorization table through a migration', () => {
    assert.match(telegramAuthRepair, /CREATE TABLE IF NOT EXISTS telegram_auth/);
    assert.match(telegramAuthRepair, /user_id BIGINT PRIMARY KEY/);
});

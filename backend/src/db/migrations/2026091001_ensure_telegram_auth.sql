-- Some legacy databases created the migration ledger before telegram_auth was
-- added to the canonical snapshot. Allowlist management must work even when
-- Telegram Bot has never completed its first MTProto connection.
CREATE TABLE IF NOT EXISTS telegram_auth (
    user_id BIGINT PRIMARY KEY,
    authenticated_at TIMESTAMPTZ DEFAULT NOW()
);

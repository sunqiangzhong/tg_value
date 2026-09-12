/** Account-wide errors must not be retried as source permission failures. */
export function telegramAccountStopReason(error: unknown): { kind: 'expired' | 'cooldown'; seconds: number } | null {
    const value = error as { errorMessage?: unknown; errorCode?: unknown; message?: unknown; seconds?: unknown; value?: unknown } | null;
    const text = typeof error === 'string' ? error : `${value?.errorMessage || ''} ${value?.errorCode || ''} ${value?.message || ''}`;
    if (/AUTH_KEY_(DUPLICATED|UNREGISTERED|INVALID)|SESSION_(REVOKED|EXPIRED)|USER_DEACTIVATED|PHONE_NUMBER_BANNED/i.test(text)) {
        return { kind: 'expired', seconds: 0 };
    }
    if (/FLOOD|Too many requests|Too many attempts/i.test(text)) {
        const seconds = Number(value?.seconds || value?.value || text.match(/(?:FLOOD(?:_PREMIUM)?_WAIT|FLOOD_TEST_PHONE_WAIT)_?(\d+)/i)?.[1] || 300);
        return { kind: 'cooldown', seconds: Number.isFinite(seconds) ? Math.max(1, seconds) : 300 };
    }
    return null;
}

/** Do not hand an authorization to a new connection unless shutdown succeeds. */
export async function closeTelegramLoginForHandoff(client: { disconnect(): Promise<unknown>; destroy(): Promise<unknown> }): Promise<void> {
    try {
        await client.disconnect();
    } finally {
        await client.destroy();
    }
}

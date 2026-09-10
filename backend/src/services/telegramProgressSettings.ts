import { getSetting, setSetting } from '../utils/settings.js';

export const TELEGRAM_PROGRESS_INTERVAL_KEY = 'telegram_progress_interval_seconds';
export const TELEGRAM_PROGRESS_INTERVALS = [3, 5, 10, 15, 30, 60] as const;
export function normalizeTelegramProgressInterval(value: unknown): number {
    const seconds = Number(value);
    if (!(TELEGRAM_PROGRESS_INTERVALS as readonly number[]).includes(seconds)) throw new Error('进度刷新间隔必须是 3/5/10/15/30/60 秒');
    return seconds;
}
let cachedSeconds = 5;
let loadedAt = 0;
export async function getTelegramProgressIntervalMs(): Promise<number> {
    if (Date.now() - loadedAt > 5000) {
        const value = await getSetting(TELEGRAM_PROGRESS_INTERVAL_KEY, '5');
        try { cachedSeconds = normalizeTelegramProgressInterval(value); } catch { cachedSeconds = 5; }
        loadedAt = Date.now();
    }
    return cachedSeconds * 1000;
}
export async function setTelegramProgressInterval(value: unknown): Promise<void> {
    const seconds = normalizeTelegramProgressInterval(value);
    await setSetting(TELEGRAM_PROGRESS_INTERVAL_KEY, String(seconds));
    cachedSeconds = seconds;
    loadedAt = Date.now();
}

/** Serialize periodic edits and stop scheduling when the owning download finishes. */
export function startTelegramProgressTicker(
    refresh: () => Promise<void>,
    interval: () => Promise<number> = getTelegramProgressIntervalMs,
    schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
    cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
): () => Promise<void> {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: Promise<void> = Promise.resolve();
    const arm = async () => {
        const delay = await interval();
        if (stopped) return;
        timer = schedule(() => {
            active = (async () => {
                try { if (!stopped) await refresh(); }
                catch (error) { console.warn('Telegram progress refresh failed:', error); }
                finally { if (!stopped) await arm(); }
            })();
        }, delay);
        timer.unref?.();
    };
    active = arm();
    return async () => {
        stopped = true;
        if (timer) cancel(timer);
        await active;
    };
}

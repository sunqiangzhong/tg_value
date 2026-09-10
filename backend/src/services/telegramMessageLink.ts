export interface TelegramMessageLink {
    source: string;
    messageId: number;
}

/** Accept one complete message link, including Telegram's web preview and private links. */
export function parseTelegramMessageLink(input: string): TelegramMessageLink | null {
    const trimmed = input.trim();
    const markdown = trimmed.match(/^\[[^\]]*\]\((https?:\/\/[^\s)]+)\)$/i);
    const link = markdown?.[1] || trimmed;
    const match = link.match(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:(c)\/(\d+)|(?:s\/)?([A-Za-z][A-Za-z0-9_]*))\/(\d+)\/?(?:[?#][^\s]*)?$/i);
    if (!match || (match[3] && ['c', 's', 'joinchat'].includes(match[3].toLowerCase()))) return null;
    const messageId = Number(match[4]);
    if (!Number.isSafeInteger(messageId) || messageId < 1 || messageId > 2147483647) return null;
    if (match[1] && !/^[1-9]\d*$/.test(match[2])) return null;
    return { source: match[1] ? `-100${match[2]}` : `@${match[3]}`, messageId };
}

export async function runTelegramMessageLinkDownload<T>(
    link: TelegramMessageLink,
    dependencies: {
        assertSourceAllowed: (source: string) => Promise<void>;
        getTarget: () => Promise<T>;
        download: (source: string, ids: number[], target: T) => Promise<{ successful: number; failed: number }>;
    },
) {
    await dependencies.assertSourceAllowed(link.source);
    const target = await dependencies.getTarget();
    return dependencies.download(link.source, [link.messageId], target);
}

/** Convert pasted public channel/post links into a channel username. */
export function normalizeTelegramChannelSource(input: string): string {
    const trimmed = input.trim();
    const markdown = trimmed.match(/^\[[^\]]*\]\((https?:\/\/[^\s)]+)\)$/i);
    const source = markdown?.[1] || trimmed;
    const publicLink = source.match(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z][A-Za-z0-9_]*)(?:\/\d+)*\/?(?:[?#].*)?$/i);
    if (publicLink && !['joinchat', 'c', 's'].includes(publicLink[1].toLowerCase())) {
        return `@${publicLink[1]}`;
    }
    if (!source || source.startsWith('@') || /^-?\d+$/.test(source) || /^https?:\/\//i.test(source)) return source;
    return `@${source}`;
}

export interface TelegramSocksProxy {
    ip: string;
    port: number;
    socksType: 4 | 5;
    timeout: number;
    username?: string;
    password?: string;
}

/**
 * GramJS uses a direct MTProto TCP connection and does not read HTTP_PROXY.
 * TELEGRAM_PROXY_URL therefore provides an explicit SOCKS proxy for every
 * Bot and user-account TelegramClient created by the application.
 */
export function getTelegramProxy(): TelegramSocksProxy | undefined {
    const raw = process.env.TELEGRAM_PROXY_URL?.trim();
    if (!raw) return undefined;

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error('TELEGRAM_PROXY_URL 格式无效，应为 socks5://主机:端口');
    }

    const socksType = url.protocol === 'socks5:' || url.protocol === 'socks5h:'
        ? 5
        : url.protocol === 'socks4:'
            ? 4
            : null;
    const port = Number.parseInt(url.port, 10);
    if (!socksType || !url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('TELEGRAM_PROXY_URL 仅支持 socks4:// 或 socks5://，并且必须包含有效端口');
    }

    return {
        ip: url.hostname,
        port,
        socksType,
        timeout: 15,
        ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
        ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    };
}

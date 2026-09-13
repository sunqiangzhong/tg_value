/**
 * 孤儿文件清理服务
 *
 * 共享下载目录中的未索引文件不代表临时文件，禁止自动删除。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getSetting } from '../utils/settings.js';

const YIELD_EVERY = Math.max(25, parseInt(process.env.ORPHAN_CLEANUP_YIELD_EVERY || '250', 10) || 250);

export interface ScannedFile {
    name: string;
    path: string;
    size: number;
    mtimeMs: number;
}

export function isReservedTransientUploadPath(filePath: string, reservedDirs: string[] = []): boolean {
    const resolvedPath = path.resolve(filePath);
    return reservedDirs.some(directory => {
        const resolvedDirectory = path.resolve(directory);
        return resolvedPath === resolvedDirectory || resolvedPath.startsWith(`${resolvedDirectory}${path.sep}`);
    });
}

export function isAutoCleanupEnabled(): boolean {
    return ['1', 'true', 'yes', 'on'].includes((process.env.AUTO_CLEANUP_ORPHANS || 'false').toLowerCase());
}

export async function applyPersistedOrphanCleanupSetting(): Promise<boolean> {
    const configured = await getSetting('auto_cleanup_orphans', process.env.AUTO_CLEANUP_ORPHANS || 'false');
    const enabled = ['1', 'true', 'yes', 'on'].includes(String(configured ?? 'false').toLowerCase());
    process.env.AUTO_CLEANUP_ORPHANS = String(enabled);
    return enabled;
}

export interface CleanupStats {
    deletedCount: number;
    freedBytes: number;
    freedSpace: string;
    deletedFiles: string[];
}

async function yieldToEventLoop(): Promise<void> {
    await new Promise<void>(resolve => setImmediate(resolve));
}

/**
 * Streams files without following symlinks or entering reserved transient workspaces.
 * Read/stat races are logged and skipped rather than aborting the maintenance run.
 */
export async function* walkFiles(
    dirPath: string,
    reservedDirs: string[] = [],
    state: { visited: number } = { visited: 0 },
): AsyncGenerator<ScannedFile> {
    if (isReservedTransientUploadPath(dirPath, reservedDirs)) return;

    let directory;
    try {
        directory = await fs.opendir(dirPath);
    } catch (error: any) {
        if (error?.code !== 'ENOENT') console.warn(`🧹 无法读取目录: ${dirPath}`, error);
        return;
    }

    try {
        for await (const entry of directory) {
            const fullPath = path.join(dirPath, entry.name);
            if (isReservedTransientUploadPath(fullPath, reservedDirs)) continue;
            try {
                const stat = await fs.lstat(fullPath);
                if (stat.isSymbolicLink()) continue;
                if (stat.isDirectory()) {
                    yield* walkFiles(fullPath, reservedDirs, state);
                } else if (stat.isFile()) {
                    yield { name: entry.name, path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs };
                }
            } catch (error: any) {
                if (error?.code !== 'ENOENT') console.warn(`🧹 无法读取文件状态: ${fullPath}`, error);
            }
            state.visited += 1;
            if (state.visited % YIELD_EVERY === 0) await yieldToEventLoop();
        }
    } catch (error: any) {
        if (error?.code !== 'ENOENT') console.warn(`🧹 扫描目录失败: ${dirPath}`, error);
    }
}

/** Compatibility helper for callers/tests that need a materialized snapshot. */
export async function getAllFiles(dirPath: string, reservedDirs: string[] = []): Promise<ScannedFile[]> {
    const files: ScannedFile[] = [];
    for await (const file of walkFiles(dirPath, reservedDirs)) files.push(file);
    return files;
}

async function runCleanup(): Promise<CleanupStats> {
    // Shared downloads (for example qBittorrent) and lost indexes are not garbage.
    // Keep legacy callers and persisted opt-ins non-destructive until cleanup can
    // prove ownership of disposable temporary files in a dedicated workspace.
    console.log('🧹 已跳过孤儿文件删除：保留共享下载目录中的未索引文件及文件夹');
    return { deletedCount: 0, freedBytes: 0, freedSpace: '0 B', deletedFiles: [] };
}

let cleanupInFlight: Promise<CleanupStats> | null = null;

/** Concurrent triggers share one run so periodic/manual cleanup never overlaps. */
export function cleanupOrphanFiles(): Promise<CleanupStats> {
    if (cleanupInFlight) return cleanupInFlight;
    cleanupInFlight = runCleanup()
        .catch(error => {
            console.error('🧹 孤儿文件清理失败:', error);
            throw error;
        })
        .finally(() => { cleanupInFlight = null; });
    return cleanupInFlight;
}

let cleanupInterval: NodeJS.Timeout | null = null;

export function startPeriodicCleanup(intervalMs: number = 60 * 60 * 1000): void {
    if (!isAutoCleanupEnabled()) {
        console.log('🧹 自动孤儿文件清理已关闭 (AUTO_CLEANUP_ORPHANS=false)');
        return;
    }
    if (cleanupInterval) clearInterval(cleanupInterval);
    cleanupInterval = setInterval(() => {
        console.log('🧹 执行定期孤儿文件清理...');
        void cleanupOrphanFiles().then(stats => {
            if (stats.deletedCount > 0) console.log(`🧹 定期清理完成: 删除 ${stats.deletedCount} 个文件，释放 ${stats.freedSpace}`);
        }).catch(error => console.error('🧹 定期清理失败:', error));
    }, intervalMs);
    cleanupInterval.unref?.();
    console.log(`🧹 已启动定期清理任务 (间隔: ${intervalMs / 1000 / 60} 分钟)`);
}

export function stopPeriodicCleanup(): void {
    if (!cleanupInterval) return;
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('🧹 已停止定期清理任务');
}

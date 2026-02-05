/**
 * @file    fs.ts
 * @brief   File system adapter for WeChat MiniGame
 */

/// <reference types="minigame-api-typings" />

// =============================================================================
// Types
// =============================================================================

type WxFileSystemManager = WechatMinigame.FileSystemManager;

// =============================================================================
// WeChat File System
// =============================================================================

let fsManager: WxFileSystemManager | null = null;

function getFileSystemManager(): WxFileSystemManager {
    if (!fsManager) {
        fsManager = wx.getFileSystemManager();
    }
    return fsManager;
}

/**
 * Read file as ArrayBuffer (synchronous)
 */
export function wxReadFileSync(path: string): ArrayBuffer {
    const fs = getFileSystemManager();
    return fs.readFileSync(path) as ArrayBuffer;
}

/**
 * Read file as string (synchronous)
 */
export function wxReadTextFileSync(path: string, encoding: 'utf8' | 'utf-8' = 'utf-8'): string {
    const fs = getFileSystemManager();
    return fs.readFileSync(path, encoding) as string;
}

/**
 * Read file as ArrayBuffer (async)
 */
export function wxReadFile(path: string): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const fs = getFileSystemManager();
        fs.readFile({
            filePath: path,
            success: (res) => {
                resolve(res.data as ArrayBuffer);
            },
            fail: (err) => {
                reject(new Error(`Failed to read file "${path}": ${err.errMsg}`));
            },
        });
    });
}

/**
 * Read file as string (async)
 */
export function wxReadTextFile(path: string, encoding: 'utf8' | 'utf-8' = 'utf-8'): Promise<string> {
    return new Promise((resolve, reject) => {
        const fs = getFileSystemManager();
        fs.readFile({
            filePath: path,
            encoding,
            success: (res) => {
                resolve(res.data as string);
            },
            fail: (err) => {
                reject(new Error(`Failed to read file "${path}": ${err.errMsg}`));
            },
        });
    });
}

/**
 * Check if file exists
 */
export function wxFileExists(path: string): Promise<boolean> {
    return new Promise((resolve) => {
        const fs = getFileSystemManager();
        fs.access({
            path,
            success: () => resolve(true),
            fail: () => resolve(false),
        });
    });
}

/**
 * Check if file exists (sync)
 */
export function wxFileExistsSync(path: string): boolean {
    const fs = getFileSystemManager();
    try {
        fs.accessSync(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Write file
 */
export function wxWriteFile(path: string, data: string | ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
        const fs = getFileSystemManager();
        fs.writeFile({
            filePath: path,
            data,
            success: () => resolve(),
            fail: (err) => {
                reject(new Error(`Failed to write file "${path}": ${err.errMsg}`));
            },
        });
    });
}

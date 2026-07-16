// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fs.ts
 * @brief   Filesystem helpers over a mini-game FileSystemManager (vendor-neutral).
 *
 * Thin wrappers over `MiniGameGlobal.getFileSystemManager()`. Path conversion
 * (toBuildPath) happens at the adapter level, not here — this layer is pure I/O.
 * The `hostLabel` threads the vendor name ("WeChat" / "抖音") into permission
 * guidance so the message names the right devtools.
 */

import { isCustomExtension } from '../../assetTypes';
import type { MiniGameFileSystemManager } from './api';

export function formatReadError(path: string, errMsg: string, hostLabel: string): string {
    const msg = errMsg.toLowerCase();
    if (msg.includes('permission denied')) {
        if (isCustomExtension(path)) {
            const ext = path.substring(path.lastIndexOf('.'));
            return `[ESEngine] Cannot read "${path}": ${hostLabel} blocked access to "${ext}" files. `
                + `Add { type: "suffix", value: "${ext}" } to packOptions.include in project.config.json. `
                + `Some suffixes are denied regardless of packOptions — the exporter restages those `
                + `as "${ext}.bin" (ktx2/esv already are); re-export if this file predates that.`;
        }
        return `[ESEngine] Cannot read "${path}": permission denied. Check file is included in ${hostLabel} package`;
    }
    if (msg.includes('no such file') || msg.includes('not found')) {
        return `[ESEngine] File not found: "${path}". Ensure the asset is included in the build `
            + `(referenced by a scene or added to an addressable group with export mode "always")`;
    }
    return `[ESEngine] Failed to read "${path}": ${errMsg}`;
}

export function mgReadFileSync(fs: MiniGameFileSystemManager, path: string, hostLabel: string): ArrayBuffer {
    try {
        return fs.readFileSync(path) as ArrayBuffer;
    } catch (e) {
        throw new Error(formatReadError(path, e instanceof Error ? e.message : String(e), hostLabel));
    }
}

export function mgReadTextFileSync(
    fs: MiniGameFileSystemManager,
    path: string,
    hostLabel: string,
    encoding: 'utf8' | 'utf-8' = 'utf-8',
): string {
    try {
        return fs.readFileSync(path, encoding) as string;
    } catch (e) {
        throw new Error(formatReadError(path, e instanceof Error ? e.message : String(e), hostLabel));
    }
}

export function mgReadFile(fs: MiniGameFileSystemManager, path: string, hostLabel: string): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        fs.readFile({
            filePath: path,
            success: (res) => resolve(res.data as ArrayBuffer),
            fail: (err) => reject(new Error(formatReadError(path, err.errMsg, hostLabel))),
        });
    });
}

export function mgReadTextFile(
    fs: MiniGameFileSystemManager,
    path: string,
    hostLabel: string,
    encoding: 'utf8' | 'utf-8' = 'utf-8',
): Promise<string> {
    return new Promise((resolve, reject) => {
        fs.readFile({
            filePath: path,
            encoding,
            success: (res) => resolve(res.data as string),
            fail: (err) => reject(new Error(formatReadError(path, err.errMsg, hostLabel))),
        });
    });
}

export function mgFileExists(fs: MiniGameFileSystemManager, path: string): Promise<boolean> {
    return new Promise((resolve) => {
        fs.access({
            path,
            success: () => resolve(true),
            fail: () => resolve(false),
        });
    });
}

export function mgFileExistsSync(fs: MiniGameFileSystemManager, path: string): boolean {
    try {
        fs.accessSync(path);
        return true;
    } catch {
        return false;
    }
}

export function mgWriteFile(fs: MiniGameFileSystemManager, path: string, data: string | ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
        fs.writeFile({
            filePath: path,
            data,
            success: () => resolve(),
            fail: (err) => reject(new Error(`Failed to write file "${path}": ${err.errMsg}`)),
        });
    });
}

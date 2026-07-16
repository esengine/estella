// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fs.ts
 * @brief   Public `wx*` filesystem helpers — thin back-compat wrappers that bind
 *          the WeChat filesystem manager to the vendor-neutral family fs (see
 *          ../minigame/fs.ts). Retained because they are part of the public
 *          `esengine/wechat` surface.
 */

/// <reference types="minigame-api-typings" />

import type { MiniGameFileSystemManager } from '../minigame';
import {
    mgReadFileSync,
    mgReadTextFileSync,
    mgReadFile,
    mgReadTextFile,
    mgFileExists,
    mgFileExistsSync,
    mgWriteFile,
} from '../minigame';

const HOST_LABEL = 'WeChat';

let fsManager: MiniGameFileSystemManager | null = null;

function fs(): MiniGameFileSystemManager {
    if (!fsManager) {
        fsManager = wx.getFileSystemManager() as unknown as MiniGameFileSystemManager;
    }
    return fsManager;
}

export function wxReadFileSync(path: string): ArrayBuffer {
    return mgReadFileSync(fs(), path, HOST_LABEL);
}

export function wxReadTextFileSync(path: string, encoding: 'utf8' | 'utf-8' = 'utf-8'): string {
    return mgReadTextFileSync(fs(), path, HOST_LABEL, encoding);
}

export function wxReadFile(path: string): Promise<ArrayBuffer> {
    return mgReadFile(fs(), path, HOST_LABEL);
}

export function wxReadTextFile(path: string, encoding: 'utf8' | 'utf-8' = 'utf-8'): Promise<string> {
    return mgReadTextFile(fs(), path, HOST_LABEL, encoding);
}

export function wxFileExists(path: string): Promise<boolean> {
    return mgFileExists(fs(), path);
}

export function wxFileExistsSync(path: string): boolean {
    return mgFileExistsSync(fs(), path);
}

export function wxWriteFile(path: string, data: string | ArrayBuffer): Promise<void> {
    return mgWriteFile(fs(), path, data);
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for zip.js — the module is plain ESM so the CLI can run it unbuilt, and
// this is how the editor's TypeScript sees it.

export interface ZipEntry {
    /** Path inside the archive, with forward slashes. */
    name: string;
    data: Buffer;
}

export function makeZip(entries: readonly ZipEntry[]): Buffer;
export function zipTree(dir: string, prefix?: string): ZipEntry[];
export function readZip(buf: Buffer): ZipEntry[];
export function extractZip(buf: Buffer, destDir: string): string[];

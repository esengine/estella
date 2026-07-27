// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for zip.js — the module is plain ESM so the CLI can run it unbuilt, and
// this is how the editor's TypeScript sees it.

export interface ZipEntry {
    /** Path inside the archive, with forward slashes. */
    name: string;
    data: Buffer;
    /** Store uncompressed — for an entry the OS mmaps out of the package. */
    store?: boolean;
    /** Byte boundary the entry's data must start on (stored entries only). */
    align?: number;
}

export interface ZipLayout {
    eocdOffset: number;
    centralDirOffset: number;
    centralDirSize: number;
    entryCount: number;
}

/** One entry as the central directory describes it — nothing inflated. */
export interface ZipListing {
    name: string;
    /** Uncompressed size, as the archive CLAIMS it. Verified only on extraction. */
    size: number;
    compressedSize: number;
}

export function makeZip(entries: readonly ZipEntry[]): Buffer;
export function zipLayout(buf: Buffer): ZipLayout;
export function zipTree(
    dir: string,
    prefix?: string,
    filter?: (name: string, isDirectory: boolean) => boolean,
): ZipEntry[];
export function listZip(buf: Buffer): ZipListing[];
export function readZip(buf: Buffer): ZipEntry[];
export function extractZip(buf: Buffer, destDir: string): string[];

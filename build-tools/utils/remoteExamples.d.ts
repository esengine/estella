// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

export const REMOTE_EXAMPLES: readonly string[];
export const EXAMPLE_INDEX_KIND: 'estella-examples';
export const EXAMPLE_INDEX_FORMAT: 1;
export const EXAMPLES_PREFIX: string;
export const EXAMPLES_INDEX: string;
export const REMOTE_EXAMPLE_STUB_FILES: readonly string[];

export interface ExampleIndexEntry {
    name: string;
    file: string;
    sha256: string;
    bytes: number;
}

export function isRemoteExample(name: string): boolean;
export function exampleArchiveName(name: string, sha256: string): string;
export function exampleArchiveKept(name: string, isDirectory: boolean): boolean;
export function parseExampleIndex(doc: unknown): ExampleIndexEntry[] | null;
export function exampleBases(mirrors: readonly string[]): string[];
export function exampleStoreDir(): string;
export function installedExampleDir(name: string, storeDir?: string): string;

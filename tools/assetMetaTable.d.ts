// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export const EXT_TO_TYPE: Readonly<Record<string, string>>;
export const SUFFIX_TO_TYPE: Readonly<Record<string, string>>;
export const CONTENT_TYPED_EXTENSIONS: readonly string[];
export const CONTENT_SNIFF_BYTES: number;
export function metaTypeForExt(fileOrExt: string): string | null;
export function needsContentType(fileOrExt: string): boolean;
export function metaTypeForContent(fileOrExt: string, head: string): string | null;
export function isProjectPlumbing(fileOrPath: string): boolean;
export const DATA_TEXTURE_IMPORTER: Readonly<Record<string, unknown>>;
export function dataImporterForHead(fileOrPath: string, head: Uint8Array | null | undefined): Record<string, unknown> | null;

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for peResource.js, which is plain ESM so the CLI runs it unbuilt.

/**
 * Replace a Windows executable's icon with @p png (square; scaled down to the
 * largest icon size it covers). Everything else the executable's resource tree
 * held is carried over.
 */
export function setExeIcon(exe: Buffer, png: Buffer): Buffer;

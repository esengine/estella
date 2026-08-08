// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for vdf.js, which is plain ESM so the CLI runs it unbuilt.

/** Serialize `value` as Valve KeyValues under `rootKey`. */
export function writeVdf(rootKey: string, value: Record<string, unknown>): string;

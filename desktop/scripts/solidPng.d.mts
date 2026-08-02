// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** A single-colour PNG, for fixtures that need real image bytes. */
export function solidPng(
  width: number,
  height: number,
  rgba?: readonly [number, number, number, number],
): Buffer;

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** A single-colour PNG, for fixtures that need real image bytes. */
export function solidPng(
  width: number,
  height: number,
  rgba?: readonly [number, number, number, number],
): Buffer;
export function noisePng(width: number, height: number, seed?: number): Buffer;
export function pixelPng(
  width: number,
  height: number,
  texel: (x: number, y: number) => readonly [number, number, number, number],
): Buffer;

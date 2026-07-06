// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Cross-panel "locate asset" door: anything holding an asset path
 *        (inspector ref fields, log links, …) calls revealAsset; the Content
 *        Browser subscribes and finishes the job (navigate, select, scroll).
 */
import { dockApi } from '@/layout/dockApi';

type Listener = (path: string) => void;
const listeners = new Set<Listener>();

export function onAssetReveal(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function revealAsset(path: string): void {
  dockApi.revealAndExpand('content');
  for (const fn of listeners) fn(path);
}

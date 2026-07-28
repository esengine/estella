// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editorModeStore.ts — transient editor-mode UI state (never serialized).
 *        `pinned` is an explicit mode override that follows-selection when null;
 *        the device/orientation/safe-area fields drive the UI-mode design-resolution
 *        viewport preview (consumed by the Viewport overlay + device dropdown).
 */
import { create } from 'zustand';
import type { EditorModeId } from '@/mode/editorModes';

interface EditorModeState {
  /** Explicit mode override; null ⇒ follow the selection-suggested mode. */
  pinned: EditorModeId | null;
  /** Simulated target screen ('design' = no letterbox). A project may declare its
   *  own presets, so this is any id the preset table resolves — not a closed set. */
  device: string;
  orientation: 'portrait' | 'landscape';
  showSafeArea: boolean;
  setMode(id: EditorModeId): void;
  clearPin(): void;
  setDevice(id: string): void;
  toggleOrientation(): void;
  toggleSafeArea(): void;
}

export const useEditorMode = create<EditorModeState>((set) => ({
  pinned: null,
  device: 'design',
  orientation: 'landscape',
  showSafeArea: false,
  setMode: (id) => set({ pinned: id }),
  clearPin: () => set({ pinned: null }),
  setDevice: (device) => set({ device }),
  toggleOrientation: () => set((s) => ({ orientation: s.orientation === 'portrait' ? 'landscape' : 'portrait' })),
  toggleSafeArea: () => set((s) => ({ showSafeArea: !s.showSafeArea })),
}));

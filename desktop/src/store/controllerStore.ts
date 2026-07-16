// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { create } from 'zustand';

/**
 * Transient UI state for the Controllers panel + gear authoring. Like
 * sequencerStore, this is view state only — the controller/gear DATA lives on the
 * entities (UIController / UIGear components). `activeController` is the controller
 * a gear dot binds to and that record mode captures into; `recording` arms the
 * ControllerRecorder so editing a geared field writes the active page's value.
 */
interface ControllerUiState {
  /** The controller (by name) that gear dots bind to and record targets. */
  activeController: string | null;
  setActiveController: (name: string | null) => void;

  /** Record mode: editing a geared field auto-writes the active controller's current page. */
  recording: boolean;
  toggleRecording: () => void;
  setRecording: (on: boolean) => void;
}

export const useControllerStore = create<ControllerUiState>((set) => ({
  activeController: null,
  setActiveController: (activeController) => set({ activeController }),

  recording: false,
  toggleRecording: () => set((s) => ({ recording: !s.recording })),
  setRecording: (recording) => set({ recording }),
}));

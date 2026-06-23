// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { create } from 'zustand';

// Sequencer UI + playback state. Kept separate from
// editorStore (scene-level UI) and the TimelineDocument (the asset data) — this is
// the transient view state: playhead, transport flags, track-tree collapse,
// keyframe selection. The playhead `time` is in SECONDS (the asset's unit); the
// panel renders it as a frame via the document's fps.
interface SequencerState {
  // Playhead position, in seconds.
  time: number;
  setTime: (t: number) => void;

  // Transport.
  playing: boolean;
  loop: boolean;
  setPlaying: (p: boolean) => void;
  togglePlay: () => void;
  toggleLoop: () => void;

  // Snap the playhead / keyframes to whole frames.
  snap: boolean;
  toggleSnap: () => void;

  // Dope-sheet vs curve editor.
  view: 'sheet' | 'curve';
  setView: (v: 'sheet' | 'curve') => void;

  // Record mode — editing a tracked property auto-keys at the playhead (P2).
  recording: boolean;
  toggleRecording: () => void;

  // Collapsed track-tree groups (entity / component rows), keyed by groupKey.
  collapsedGroups: Set<string>;
  toggleGroup: (key: string) => void;

  // Muted channels (editor-only; not saved to the asset), keyed by muteKey(ref).
  // The preview skips these so the viewport reflects the mute.
  mutedTracks: Set<string>;
  toggleMute: (key: string) => void;

  // Selected keyframe id (P2 editing), `${rowId}@${time}`.
  selectedKey: string | null;
  selectKey: (id: string | null) => void;

  // Reset transient state when a different clip is opened.
  resetForClip: () => void;
}

export const useSequencerStore = create<SequencerState>((set) => ({
  time: 0,
  setTime: (time) => set({ time: Math.max(0, time) }),

  playing: false,
  loop: true,
  setPlaying: (playing) => set({ playing }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  toggleLoop: () => set((s) => ({ loop: !s.loop })),

  snap: true,
  toggleSnap: () => set((s) => ({ snap: !s.snap })),

  view: 'sheet',
  setView: (view) => set({ view }),

  recording: false,
  toggleRecording: () => set((s) => ({ recording: !s.recording })),

  collapsedGroups: new Set<string>(),
  toggleGroup: (key) =>
    set((s) => {
      const next = new Set(s.collapsedGroups);
      next.has(key) ? next.delete(key) : next.add(key);
      return { collapsedGroups: next };
    }),

  mutedTracks: new Set<string>(),
  toggleMute: (key) =>
    set((s) => {
      const next = new Set(s.mutedTracks);
      next.has(key) ? next.delete(key) : next.add(key);
      return { mutedTracks: next };
    }),

  selectedKey: null,
  selectKey: (selectedKey) => set({ selectedKey }),

  resetForClip: () =>
    set({
      time: 0, playing: false, selectedKey: null, recording: false,
      mutedTracks: new Set<string>(), collapsedGroups: new Set<string>(),
    }),
}));

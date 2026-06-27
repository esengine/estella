// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  audioPreview.ts
 * @brief Content Browser audio preview — play a project sound (over the
 *        `estella://` transport) without wiring an AudioSource + Play. One clip at
 *        a time; re-triggering the playing clip stops it (toggle).
 */
interface Player {
  play(): Promise<void> | void;
  pause(): void;
  currentTime: number;
  onended: (() => void) | null;
}

// Injectable so the toggle logic is testable without a DOM <audio> element. The
// real element is cast at this boundary (its `onended` handler takes an Event).
let make: (url: string) => Player = (url) => new Audio(url) as unknown as Player;

/** Override the audio factory (tests). */
export function _setAudioFactory(factory: (url: string) => Player): void {
  make = factory;
}

let current: Player | null = null;
let currentPath: string | null = null;

export function stopAudioPreview(): void {
  if (current) {
    current.pause();
    current.currentTime = 0;
  }
  current = null;
  currentPath = null;
}

/** Play `path` (toggle: a second trigger on the playing clip stops it). */
export function toggleAudioPreview(path: string): void {
  if (currentPath === path) {
    stopAudioPreview();
    return;
  }
  stopAudioPreview();
  const a = make(`estella://project/${path}`);
  a.onended = () => {
    if (current === a) stopAudioPreview();
  };
  current = a;
  currentPath = path;
  void Promise.resolve(a.play()).catch(() => stopAudioPreview());
}

/** The path of the clip currently previewing, or null. */
export function previewingPath(): string | null {
  return currentPath;
}

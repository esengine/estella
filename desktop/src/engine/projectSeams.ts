// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The project settings the ENGINE layer reads, published by the store.
 *
 * The engine modules must not import ProjectStore — the store is built on top of
 * them — so the handful of project facts they legitimately need arrive by
 * injection: the store calls each `set*` as it opens a project, and the engine
 * side reads the getter. Each has a defined answer before (and without) a
 * project, so a module that reads one works in a bare editor, in a test, and in
 * a headless boot.
 *
 * They lived in entitySources, which is about CREATING entities and has nothing
 * to do with camera fit or design resolution: reading one from the viewport
 * dragged in the whole entity-source registry, and through it the scene commands
 * that call back into the viewport — a dependency cycle grown out of a seam
 * parked in the nearest file rather than its own.
 */
import type { EntitySource } from './entitySources';

// -- The project's reference (design) resolution ------------------------------
// A new Canvas seeds its designResolution from it, and the editor's design /
// device preview reads it so the preview works without a UI Canvas at all.

let canvasDesignSeed: (() => { width: number; height: number }) | null = null;

export function setCanvasDesignSeed(fn: () => { width: number; height: number }): void {
  canvasDesignSeed = fn;
}

export function projectDesignSeed(): { width: number; height: number } {
  return canvasDesignSeed?.() ?? { width: 1920, height: 1080 };
}

// -- The project's camera fit -------------------------------------------------
// `scaleMode` is a CanvasScaleMode (0..4) or -1 (off). The device preview reads
// it so its letterbox matches what the runtime will do (WYSIWYG).

let projectCameraFitSeed: (() => { scaleMode: number; matchWidthOrHeight: number }) | null = null;

export function setProjectCameraFit(fn: () => { scaleMode: number; matchWidthOrHeight: number }): void {
  projectCameraFitSeed = fn;
}

export function projectCameraFit(): { scaleMode: number; matchWidthOrHeight: number } {
  return projectCameraFitSeed?.() ?? { scaleMode: -1, matchWidthOrHeight: 0.5 };
}

// -- How each sorting layer resolves its contents ------------------------------
// The two bitmasks the renderer sorts by (y-sort, depth). Picking has to rank
// overlapping entities the way the frame was drawn — a click that ranks them any
// other way selects something the person cannot see — and the ranking runs in
// the viewport, below the store that owns the project setting.

let sortingLayerModesSeed: (() => { ySort: number; depth: number }) | null = null;

export function setProjectSortingLayerModes(fn: () => { ySort: number; depth: number }): void {
  sortingLayerModesSeed = fn;
}

/** Both masks; all-painter (0, 0) with no project — the pre-2.5D default. */
export function projectSortingLayerModes(): { ySort: number; depth: number } {
  return sortingLayerModesSeed?.() ?? { ySort: 0, depth: 0 };
}

// -- The project's own prefabs, as entity sources ------------------------------
// Injected by the store, which owns the asset registry; they join the one list
// every "create an entity" surface offers (see allEntitySources).

let projectPrefabSourcesFn: () => EntitySource[] = () => [];

export function setProjectPrefabSources(fn: () => EntitySource[]): void {
  projectPrefabSourcesFn = fn;
}

export function projectPrefabSources(): EntitySource[] {
  return projectPrefabSourcesFn();
}

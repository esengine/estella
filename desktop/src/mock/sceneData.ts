import type { AssetItem, LogEntry } from '@/types';

// Placeholder content for panels not yet wired to live data (Content Browser,
// Output Log). The scene tree and inspector now read the real engine — see
// EngineHost.readSceneTree / readInspector.

export const MOCK_ASSETS: AssetItem[] = [
  { id: 'a1', name: 'scenes', type: 'folder' },
  { id: 'a2', name: 'sprites', type: 'folder' },
  { id: 'a3', name: 'audio', type: 'folder' },
  { id: 'a4', name: 'scripts', type: 'folder' },
  { id: 'a5', name: 'Level_01', type: 'scene' },
  { id: 'a6', name: 'hero', type: 'spine' },
  { id: 'a7', name: 'slime', type: 'sprite' },
  { id: 'a8', name: 'tileset', type: 'texture' },
  { id: 'a9', name: 'jump', type: 'audio' },
  { id: 'a10', name: 'Coin', type: 'prefab' },
  { id: 'a11', name: 'water', type: 'material' },
  { id: 'a12', name: 'PlayerController', type: 'script' },
  { id: 'a13', name: 'Bullet', type: 'prefab' },
  { id: 'a14', name: 'explosion', type: 'texture' },
];

export const MOCK_LOG: LogEntry[] = [
  { id: 1, level: 'info', time: '12:04:01', source: 'Engine', message: 'esengine.wasm instantiated (1.34 MB) in 38ms' },
  { id: 2, level: 'info', time: '12:04:01', source: 'Assets', message: 'Loaded project "platformer" — 14 assets indexed' },
  { id: 3, level: 'success', time: '12:04:02', source: 'Scene', message: 'Opened Level_01.scene — 15 entities, 38 components' },
  { id: 4, level: 'warn', time: '12:04:05', source: 'Spine', message: 'Player: animation "dash" referenced but not found in skeleton' },
  { id: 5, level: 'info', time: '12:04:06', source: 'Physics', message: 'Box2D world stepped at fixed 60Hz' },
  { id: 6, level: 'error', time: '12:04:09', source: 'Script', message: 'PlayerController.ts:42 — Cannot read "velocity" of undefined' },
  { id: 7, level: 'info', time: '12:04:12', source: 'Render', message: 'Draw calls: 23 · batches: 6 · triangles: 4.1k' },
];

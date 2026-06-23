// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  projectSettings.ts — project-scoped settings, persisted to
 *        project.esproject (the editorSettings.ts extension point for project/
 *        plugin sections). Registered as a side effect; SettingsDialog renders
 *        them under the "Project" category with no UI change. Bound to
 *        ProjectStore, which owns manifest read/write.
 */
import { settingsRegistry } from './registry';
import { ProjectStore } from '@/project/ProjectStore';

// ── Physics (the enable flag = UE Plugins-Browser analog; gravity = Project Settings) ──
settingsRegistry.registerSection({ id: 'physics', label: 'Physics', category: 'project', order: 1 });

// ── Rendering (named sorting layers feed the inspector's render `layer` dropdown) ──
settingsRegistry.registerSection({ id: 'rendering', label: 'Rendering', category: 'project', order: 2 });

settingsRegistry.register({
  id: 'project.rendering.sortingLayers',
  type: 'stringList',
  scope: 'project',
  section: 'rendering',
  group: 'Sorting Layers',
  label: 'Layer names',
  description: 'Name render sorting layers (lowest first); a render `layer` field then picks from them instead of a raw number.',
  count: 8,
  placeholder: (i) => `Layer ${i}`,
  default: Array.from({ length: 8 }, () => ''),
  bind: {
    get: () => ProjectStore.renderingFeature().sortingLayers,
    set: (v) => void ProjectStore.setRendering({ sortingLayers: v }),
  },
});

settingsRegistry.register({
  id: 'project.physics.enabled',
  type: 'boolean',
  scope: 'project',
  section: 'physics',
  group: 'Physics',
  label: 'Enable physics',
  description: 'Install the Box2D world when this project plays — required for bodies a script spawns at runtime.',
  default: false,
  bind: {
    get: () => ProjectStore.physicsFeature().enabled,
    set: (v) => void ProjectStore.setPhysics({ enabled: v }),
  },
});

settingsRegistry.register({
  id: 'project.physics.gravityX',
  type: 'number',
  scope: 'project',
  section: 'physics',
  group: 'Gravity',
  label: 'Gravity X',
  default: 0,
  step: 0.1,
  bind: {
    get: () => ProjectStore.physicsFeature().gravity.x,
    set: (v) => void ProjectStore.setPhysics({ gravity: { ...ProjectStore.physicsFeature().gravity, x: v } }),
  },
});

settingsRegistry.register({
  id: 'project.physics.collisionLayers',
  type: 'stringList',
  scope: 'project',
  section: 'physics',
  group: 'Collision Layers',
  label: 'Layer names',
  description: 'Names for the 16 collision-filter layers — shown in collider Category/Mask pickers.',
  count: 16,
  placeholder: (i) => `Layer ${i}`,
  default: Array.from({ length: 16 }, (_, i) => (i === 0 ? 'Default' : '')),
  bind: {
    get: () => ProjectStore.physicsFeature().collisionLayers,
    set: (v) => void ProjectStore.setPhysics({ collisionLayers: v }),
  },
});

settingsRegistry.register({
  id: 'project.physics.gravityY',
  type: 'number',
  scope: 'project',
  section: 'physics',
  group: 'Gravity',
  label: 'Gravity Y',
  description: 'Negative pulls down (Box2D default −9.81).',
  default: -9.81,
  step: 0.1,
  bind: {
    get: () => ProjectStore.physicsFeature().gravity.y,
    set: (v) => void ProjectStore.setPhysics({ gravity: { ...ProjectStore.physicsFeature().gravity, y: v } }),
  },
});

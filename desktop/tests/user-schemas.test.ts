// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  User-component schema reflection — setUserSchemas stores the project's
 *        component field schemas and bumps a revision so the inspector re-renders
 *        on a live edit (the T4 reflection loop). Pure TS (no WASM).
 */
import { describe, it, expect } from 'vitest';
import {
  setUserSchemas,
  userSchema,
  assetFieldType,
  subscribeSchemas,
  getSchemaRevision,
  type UserComponentSchema,
} from '@/engine/schema';

const marker = (count: number): UserComponentSchema => ({
  name: 'SpawnMarker',
  isTag: false,
  default: { count },
  colorKeys: [],
  assetFields: [{ field: 'icon', type: 'texture' }],
});

describe('user-component schemas', () => {
  it('stores schemas, bumps the revision, and notifies subscribers', () => {
    const r0 = getSchemaRevision();
    let notified = 0;
    const unsub = subscribeSchemas(() => notified++);

    setUserSchemas([marker(3)]);
    expect(getSchemaRevision()).toBe(r0 + 1);
    expect(notified).toBe(1);
    expect((userSchema('SpawnMarker')?.default as { count: number }).count).toBe(3);

    // A user component's asset field resolves as an asset control (inspector).
    expect(assetFieldType('SpawnMarker', 'icon')).toBe('texture');
    expect(assetFieldType('SpawnMarker', 'count')).toBeNull();

    // A live re-extract replaces the set and bumps again.
    setUserSchemas([marker(9)]);
    expect((userSchema('SpawnMarker')?.default as { count: number }).count).toBe(9);
    expect(notified).toBe(2);

    unsub();
    setUserSchemas([]);
    expect(notified).toBe(2); // unsubscribed → not notified
    expect(userSchema('SpawnMarker')).toBeUndefined();
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Per-entity dynamic enum registry — string fields whose choices depend on
 *        an entity's runtime state (e.g. spine animation/skin names). The inspector
 *        renders a dropdown when a provider yields options.
 */
import { describe, it, expect } from 'vitest';
import { registerDynamicEnum, dynamicEnumOptions } from '@/engine/schema';

describe('dynamic enum registry', () => {
  it('returns a provider\'s options for the registered (component, field)', () => {
    registerDynamicEnum('Foo', 'anim', () => ['walk', 'run']);
    expect(dynamicEnumOptions('Foo', 'anim', 1)).toEqual(['walk', 'run']);
  });

  it('is null for an unregistered field, and for empty options (falls back to a text field)', () => {
    expect(dynamicEnumOptions('Nope', 'x', 1)).toBeNull();
    registerDynamicEnum('Foo', 'empty', () => []);
    expect(dynamicEnumOptions('Foo', 'empty', 1)).toBeNull();
  });

  it('passes the entity source id to the provider (per-entity options)', () => {
    let seen = -1;
    registerDynamicEnum('Foo', 'byEntity', (id) => {
      seen = id;
      return ['x'];
    });
    dynamicEnumOptions('Foo', 'byEntity', 42);
    expect(seen).toBe(42);
  });
});

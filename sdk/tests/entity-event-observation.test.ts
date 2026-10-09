// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { EntityEventQueue } from '../src/ecs/entityEvents';
import type { Entity, EntityEventObservation } from '../src';
describe('dispatch observation', () => {
 it('records completed target and actual bubble steps with one event identity', () => {
  const q = new EntityEventQueue(), seen: EntityEventObservation[] = [];
  q.on(2 as Entity, 'click', event => { event.preventDefault(); event.stopPropagation(); });
  q.observe(event => seen.push(event));
  const root = q.emit(1 as Entity, 'click', { privateText: 'not recorded' });
  q.emitBubbled(2 as Entity, root); q.emitBubbled(3 as Entity, root);
  expect(seen.map(row => row.currentTarget)).toEqual([1, 2]);
  expect(seen[1].eventId).toBe(seen[0].eventId);
  expect(seen[1]).toMatchObject({ target: 1, propagationStopped: true, defaultPrevented: true });
  expect(seen[0]).toMatchObject({ propagationStopped: false, defaultPrevented: false });
  expect(Object.isFrozen(seen[0])).toBe(true); expect('data' in seen[0]).toBe(false);
  expect(q.drain()).toHaveLength(2);
 });
 it('does not become a producer listener and detaches without draining', () => {
  const q = new EntityEventQueue(), seen: EntityEventObservation[] = [];
  const off = q.observe(event => seen.push(event)); expect(q.hasListenersFor('shown')).toBe(false);
  q.emit(1 as Entity, 'shown'); off(); off(); q.emit(1 as Entity, 'shown');
  expect(seen).toHaveLength(1); expect(q.query('shown')).toHaveLength(2);
 });
 it('keeps nested events distinct and omits suppressed recursive dispatch', () => {
  const q = new EntityEventQueue(), seen: EntityEventObservation[] = [];
  q.observe(event => seen.push(event)); q.on(1 as Entity, 'click', () => { q.emit(1 as Entity, 'click'); q.emit(2 as Entity, 'change'); });
  q.emit(1 as Entity, 'click'); expect(seen.map(row => row.type)).toEqual(['change', 'click']);
  expect(seen[0].eventId).not.toBe(seen[1].eventId); expect(q.drain()).toHaveLength(3);
 });
 it('clear releases observers', () => { const q = new EntityEventQueue(), seen: unknown[] = []; q.observe(e=>seen.push(e)); q.clear(); q.emit(1 as Entity,'click'); expect(seen).toHaveLength(0); });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { bootMockApp } from './helpers/mockApp';
import { Disabled, Sprite } from '../src/ecs/component';
import { SpriteAnimator, SpriteAnimationAPI } from '../src/animation/SpriteAnimator';

function setup() {
    const { app } = bootMockApp(), world = app.world;
    const animation = new SpriteAnimationAPI();
    animation.registerClip({ name: 'walk', fps: 10, loop: true,
        frames: [{ texture: 11 }, { texture: 22 }, { texture: 33 }],
        events: [{ frame: 0, name: 'start' }, { frame: 1, name: 'step' }],
    });
    const spawn = () => {
        const entity = world.spawn();
        world.insert(entity, Sprite, { texture: 99 });
        world.insert(entity, SpriteAnimator, { clip: 'walk' });
        return entity;
    };
    return { app, world, animation, spawn };
}

it('refreshes a replaced clip while paused without advancing its frame or firing events', () => {
    const { app, world, animation, spawn } = setup(), entity = spawn();
    animation.update(world, 0.15);
    world.update(entity, SpriteAnimator, data => { data.playing = false; });
    const frame = world.get(entity, SpriteAnimator).currentFrame;
    const timer = world.get(entity, SpriteAnimator).frameTimer;
    const event = vi.fn(); animation.onEvent(entity, event);
    const clip = animation.getClip('walk')!;
    animation.registerClip({ ...clip, frames: [{ texture: 111 }, { texture: 222 }, { texture: 333 }] });
    animation.update(world, 1);
    expect(world.get(entity, Sprite).texture).toBe(222);
    expect(world.get(entity, SpriteAnimator).currentFrame).toBe(frame);
    expect(world.get(entity, SpriteAnimator).frameTimer).toBe(timer);
    expect(world.get(entity, SpriteAnimator).playing).toBe(false);
    expect(event).not.toHaveBeenCalled();
    const writes = vi.spyOn(world, 'set');
    for (let i = 0; i < 100; i++) animation.update(world, 1);
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
    app.quit();
});

it('advances frame events without writing an unchanged sprite', () => {
    const { app, world, animation, spawn } = setup(), entity = spawn();
    try {
        animation.registerClip({ name: 'walk', fps: 10, loop: true, frames: [{ texture: 11 }, { texture: 11 }],
            events: [{ frame: 1, name: 'step' }] });
        animation.update(world, 0);
        const event = vi.fn();
        animation.onEvent(entity, event);
        const stamp = vi.spyOn(world, 'markChanged');
        animation.update(world, 0.1);
        expect(world.get(entity, SpriteAnimator).currentFrame).toBe(1);
        expect(event).toHaveBeenCalledWith(expect.objectContaining({ name: 'step' }), entity);
        expect(stamp).not.toHaveBeenCalledWith(entity, Sprite);
        stamp.mockRestore();
    } finally { app.quit(); }
});

it.each(['self', 'ancestor', 'component'] as const)('stops event dispatch and sprite writes when a callback disables %s', target => {
    const { app, world, animation, spawn } = setup(), entity = spawn();
    const parent = world.spawn();
    world.setParent(entity, parent);
    const events: string[] = [], global = vi.fn();
    const off = animation.onEvent(entity, event => {
        events.push(event.name);
        if (target === 'component') world.update(entity, SpriteAnimator, data => { data.enabled = false; });
        else world.insert(target === 'self' ? entity : parent, Disabled);
    });
    animation.onEventGlobal(global);
    animation.update(world, 0.15);
    expect(events).toEqual(['start']);
    expect(global).not.toHaveBeenCalled();
    expect(world.get(entity, Sprite).texture).toBe(99);
    off();
    if (target === 'component') world.update(entity, SpriteAnimator, data => { data.enabled = true; });
    else world.remove(target === 'self' ? entity : parent, Disabled);
    animation.update(world, 0);
    expect(world.get(entity, Sprite).texture).toBe(22);
    expect(global).not.toHaveBeenCalled();
    app.quit();
});

it('applies a deferred final frame without replaying a completed one-shot', () => {
    const { app, world, animation, spawn } = setup(), entity = spawn();
    world.update(entity, SpriteAnimator, data => { data.loop = false; });
    const off = animation.onEvent(entity, () => world.insert(entity, Disabled));
    animation.update(world, 1);
    expect(world.get(entity, SpriteAnimator).finished).toBe(true);
    expect(world.get(entity, Sprite).texture).toBe(99);
    off();
    world.remove(entity, Disabled);
    animation.update(world, 0);
    expect(world.get(entity, SpriteAnimator).currentFrame).toBe(2);
    expect(world.get(entity, SpriteAnimator).finished).toBe(true);
    expect(world.get(entity, SpriteAnimator).playing).toBe(false);
    expect(world.get(entity, Sprite).texture).toBe(33);
    app.quit();
});

it.each(['entity', 'ancestor'] as const)('skips a later query entry disabled through its %s by an earlier callback', target => {
    const { app, world, animation, spawn } = setup(), first = spawn(), next = spawn();
    const parent = world.spawn();
    world.setParent(next, parent);
    const nextEvent = vi.fn();
    animation.onEvent(first, () => world.insert(target === 'entity' ? next : parent, Disabled));
    animation.onEvent(next, nextEvent);
    animation.update(world, 0.15);
    expect(world.get(next, SpriteAnimator).currentFrame).toBe(0);
    expect(world.get(next, SpriteAnimator).frameTimer).toBe(0);
    expect(world.get(next, Sprite).texture).toBe(99);
    expect(nextEvent).not.toHaveBeenCalled();
    app.quit();
});

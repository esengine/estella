// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { AnimationPlugin } from '../src/animation/AnimationPlugin';
import { Tween } from '../src/animation/Tween';
import { SpriteAnimation, SpriteAnimator } from '../src/animation/SpriteAnimator';
const apps: App[] = [];
function build(plugin: AnimationPlugin) { const app = App.new(); apps.push(app); app.addPlugin(plugin); return app; }
afterEach(() => { for (const app of apps.splice(0)) app.quit(); });
it('quitting an older app releases only its animation despawn subscription', () => {
    const plugin = new AnimationPlugin(), first = build(plugin), second = build(plugin);
    expect(first.world.getStorageSizes().despawnCallbacks).toBe(1);
    expect(second.world.getStorageSizes().despawnCallbacks).toBe(1);
    first.quit();
    expect(first.world.getStorageSizes().despawnCallbacks).toBe(0);
    expect(second.world.getStorageSizes().despawnCallbacks).toBe(1);
    const entity = second.world.spawn(), cancel = vi.spyOn(second.getResource(Tween), 'cancelAll');
    const remove = vi.spyOn(second.getResource(SpriteAnimation), 'removeEntityListeners');
    second.world.despawn(entity); expect(cancel).toHaveBeenCalledWith(entity); expect(remove).toHaveBeenCalledWith(entity);
    second.quit(); expect(second.world.getStorageSizes().despawnCallbacks).toBe(0);
});
it('withdraws the despawn listener if installing an animation system fails', () => {
    const plugin = new AnimationPlugin();
    const main = build(plugin);
    const preview = App.new();
    apps.push(preview);
    vi.spyOn(preview, 'addSystemToSchedule').mockImplementationOnce(() => { throw Error('system rejected'); });
    expect(() => preview.addPlugin(plugin)).toThrow('system rejected');
    expect(preview.world.getStorageSizes().despawnCallbacks).toBe(0);
    expect(main.world.getStorageSizes().despawnCallbacks).toBe(1);
});
it('preview shutdowns leave the main animation listener active without accumulating old subscriptions', () => {
    const plugin = new AnimationPlugin(), main = build(plugin);
    for (let cycle = 0; cycle < 100; cycle++) {
        const preview = build(plugin); preview.quit();
        expect(preview.world.getStorageSizes().despawnCallbacks).toBe(0);
        expect(main.world.getStorageSizes().despawnCallbacks).toBe(1);
    }
    main.quit(); expect(main.world.getStorageSizes().despawnCallbacks).toBe(0);
});
it('parameterless cleanup withdraws only the latest subscription and stays idempotent', () => {
    const plugin = new AnimationPlugin(), first = build(plugin), second = build(plugin);
    plugin.cleanup(); plugin.cleanup();
    expect(first.world.getStorageSizes().despawnCallbacks).toBe(1);
    expect(second.world.getStorageSizes().despawnCallbacks).toBe(0);
    first.quit(); second.quit(); expect(first.world.getStorageSizes().despawnCallbacks).toBe(0);
});
it('quitting a newer app preserves older sprite animation playback', async () => {
    const plugin = new AnimationPlugin(), first = build(plugin), second = build(plugin);
    const animation = first.getResource(SpriteAnimation);
    animation.registerClip({ name: 'walk', fps: 10, loop: true, frames: [{ texture: 0 }, { texture: 0 }] });
    const entity = first.world.spawn(); first.world.insert(entity, SpriteAnimator, { clip: 'walk' });
    second.quit(); await first.tick(.1);
    expect(first.world.get(entity, SpriteAnimator).currentFrame).toBe(1);
    first.quit(); expect(first.world.getStorageSizes().despawnCallbacks).toBe(0);
});

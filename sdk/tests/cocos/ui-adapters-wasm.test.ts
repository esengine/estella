// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Cocos's built-in UI components as views on the engine's, against the real engine (Sprite is a C++ component).
 *
 * What a script relies on and cannot be told is wrong: that `label.string = ...` is the Text that is drawn, that a colour set in
 * Cocos's 0..255 comes back as the same 0..255, that line height keeps its pixel value when the font size changes (the engine stores
 * a ratio), that the overflow numbers translate (SHRINK is 2 in Cocos and 3 in the engine), and that a size set on UITransform
 * reaches the Sprite and Text that draw into it.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { World } from '../../src/ecs/world';
import { Sprite as EngineSprite, Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { AppContext, setDefaultContext } from '../../src/ecs/context';
import { Text } from '../../src/ui/core/text';
import { TextOverflow } from '../../src/ui/core/text';
import { GroupOpacity } from '../../src/ecs/component';
import { Color, Label, LabelOutline, LabelShadow, Node, Size, Sprite, SpriteFrame, Texture2D, UIOpacity, UITransform, Vec2, Vec3, setCurrentWorld } from '../../src/cocos';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';

describe.skipIf(!HAS_WASM)('built-in UI components on the engine', () => {
    let module: ESEngineModule;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;
    let world: World | undefined;
    const W = (): World => world!;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });

    function connect(): void {
        setDefaultContext(new AppContext());
        ensureBuiltinComponentsRegistered();
        registry = new module.Registry();
        world = new World();
        world.connectCpp(registry, module);
        setCurrentWorld(world);
    }
    afterEach(() => {
        setCurrentWorld(null);
        world?.disconnectCpp();
        registry?.delete();
        registry = undefined;
        world = undefined;
    });

    const node = (name: string): Node => { const n = new Node(name); W().insert(n._entity, Transform); return n; };

    describe('Label', () => {
        it('is the Text on its node: added if there is none, the same view each time', () => {
            connect();
            const n = node('l');
            expect(n.getComponent(Label)).toBeNull();
            const label = n.addComponent(Label)!;
            expect(label).toBeInstanceOf(Label);
            expect(W().has(n._entity, Text)).toBe(true);
            expect(n.getComponent(Label)).toBe(label);
            expect(n.getComponent('cc.Label')).toBe(label);
        });

        it('writes the string, size and flags through to the Text that is drawn', () => {
            connect();
            const n = node('l');
            const label = n.addComponent(Label)!;
            label.string = '胜利';
            label.fontSize = 36;
            label.isBold = true;
            label.enableWrapText = false;
            const t = W().get(n._entity, Text);
            expect(t.content).toBe('胜利');
            expect(t.fontSize).toBe(36);
            expect(t.bold).toBe(true);
            expect(t.wordWrap).toBe(false);
            expect(label.string).toBe('胜利');
        });

        it('takes a game that replaces the engine\'s string setter and writes its internal _string', () => {
            connect();
            const n = node('l');
            const label = n.addComponent(Label)!;
            const original = Object.getOwnPropertyDescriptor(Label.prototype, 'string')!;
            // what a project patching the engine's Label does: it sets the engine's own field and marks the element for a rebuild
            Object.defineProperty(Label.prototype, 'string', {
                set(this: { _string: string; markForUpdateRenderData(): void }, value: string) {
                    if (this._string === value) return;
                    this._string = value;
                    this.markForUpdateRenderData();
                },
            });
            try {
                label.string = 'patched';
                expect(W().get(n._entity, Text).content).toBe('patched');
                expect(label.string).toBe('patched');
            } finally {
                Object.defineProperty(Label.prototype, 'string', original);
            }
        });

        it('turns a null or undefined string into empty text, as Cocos does', () => {
            connect();
            const label = node('l').addComponent(Label)!;
            label.string = 'x';
            label.string = undefined as never;
            expect(label.string).toBe('');
        });

        it('converts a colour between Cocos 0..255 and the engine 0..1, and reads back what was set', () => {
            connect();
            const n = node('l');
            const label = n.addComponent(Label)!;
            label.color = new Color(255, 128, 0, 64);
            const t = W().get(n._entity, Text);
            expect(t.color.r).toBeCloseTo(1, 5);
            expect(t.color.g).toBeCloseTo(128 / 255, 5);
            expect(t.color.b).toBe(0);
            expect(t.color.a).toBeCloseTo(64 / 255, 5);
            const back = label.color;
            expect([back.r, back.g, back.b, back.a]).toEqual([255, 128, 0, 64]);
        });

        it('keeps a line height in pixels when the font size changes, though the engine stores a ratio', () => {
            connect();
            const label = node('l').addComponent(Label)!;
            label.fontSize = 20;
            label.lineHeight = 30;
            expect(label.lineHeight).toBeCloseTo(30, 5);
            label.fontSize = 40;
            expect(label.lineHeight).toBeCloseTo(30, 5);   // still 30px, not 60
        });

        it('translates the overflow numbers and the alignments', () => {
            connect();
            const n = node('l');
            const label = n.addComponent(Label)!;
            label.overflow = Label.Overflow.SHRINK;
            expect(W().get(n._entity, Text).overflow).toBe(TextOverflow.Shrink);
            expect(label.overflow).toBe(Label.Overflow.SHRINK);
            label.overflow = Label.Overflow.CLAMP;
            expect(W().get(n._entity, Text).overflow).toBe(TextOverflow.Clip);
            label.overflow = Label.Overflow.RESIZE_HEIGHT;
            expect(W().get(n._entity, Text).overflow).toBe(TextOverflow.ResizeHeight);
            expect(label.overflow).toBe(Label.Overflow.RESIZE_HEIGHT);
            label.isUnderline = true;
            expect(W().get(n._entity, Text).underline).toBe(true);
            expect(label.isUnderline).toBe(true);
            label.horizontalAlign = Label.HorizontalAlign.RIGHT;
            label.verticalAlign = Label.VerticalAlign.BOTTOM;
            const t = W().get(n._entity, Text);
            expect([t.align, t.verticalAlign]).toEqual([2, 2]);
        });

        it('has its outline and shadow as properties of the same Text', () => {
            connect();
            const n = node('l');
            n.addComponent(Label);
            const outline = n.addComponent(LabelOutline)!;
            outline.color = new Color(0, 0, 255, 255);
            outline.width = 3;
            const shadow = n.addComponent(LabelShadow)!;
            shadow.offset = { x: 2, y: -4 };
            shadow.blur = 5;
            const t = W().get(n._entity, Text);
            expect(t.strokeWidth).toBe(3);
            expect(t.strokeColor.b).toBe(1);
            // Cocos's y is up; the engine's shadow y is down
            expect(t.shadowOffsetX).toBe(2);
            expect(t.shadowOffsetY).toBe(4);
            expect(t.shadowBlur).toBe(5);
            expect(shadow.offset).toEqual({ x: 2, y: -4 });
        });
    });

    describe('Sprite and UIOpacity', () => {
        it('is the engine Sprite on its node, with Cocos colour and type numbers', () => {
            connect();
            const n = node('s');
            const sprite = n.addComponent(Sprite)!;
            expect(W().has(n._entity, EngineSprite)).toBe(true);
            sprite.color = new Color(10, 20, 30, 255);
            expect(W().get(n._entity, EngineSprite).color.g).toBeCloseTo(20 / 255, 5);
            sprite.type = Sprite.Type.SLICED;
            expect(sprite.type).toBe(Sprite.Type.SLICED);
            sprite.type = Sprite.Type.TILED;
            expect(sprite.type).toBe(Sprite.Type.TILED);
            sprite.enabled = false;
            expect(W().get(n._entity, EngineSprite).enabled).toBe(false);
        });

        it('draws the texture of the frame it is given, and lets go of it when given none', () => {
            connect();
            const n = node('f');
            const sprite = n.addComponent(Sprite)!;
            const texture = new Texture2D('gold.png');
            texture._handle = 7;
            texture.width = 64;
            texture.height = 32;
            const frame = new SpriteFrame('gold.png');
            frame.texture = texture;
            sprite.spriteFrame = frame;
            expect(sprite.spriteFrame).toBe(frame);
            expect(W().get(n._entity, EngineSprite).texture).toBe(7);
            sprite.spriteFrame = null;
            expect(W().get(n._entity, EngineSprite).texture).toBe(0);
        });

        it('is the engine\'s GroupOpacity, in Cocos\'s 0..255', () => {
            connect();
            const n = node('p');
            const opacity = n.addComponent(UIOpacity)!;
            expect(opacity.opacity).toBe(255);
            opacity.opacity = 128;
            expect(W().get(n._entity, GroupOpacity).opacity).toBeCloseTo(128 / 255, 5);
            expect(opacity.opacity).toBe(128);
            opacity.opacity = 999;
            expect(opacity.opacity).toBe(255);
        });
    });

    describe('UITransform', () => {
        it('starts from the renderer the node has, and is there for a node that draws nothing', () => {
            connect();
            const withSprite = node('a');
            withSprite.addComponent(Sprite);
            W().set(withSprite._entity, EngineSprite, { ...W().get(withSprite._entity, EngineSprite), size: { x: 80, y: 40 }, pivot: { x: 0, y: 1 } });
            const t = withSprite.getComponent(UITransform)!;
            expect(t.contentSize.width).toBe(80);
            expect(t.contentSize.height).toBe(40);
            expect(t.anchorPoint.equals(new Vec2(0, 1))).toBe(true);

            const bare = node('b');
            const bt = bare.addComponent(UITransform)!;
            bt.setContentSize(300, 200);
            expect(bare.getComponent(UITransform)).toBe(bt);
            expect(bt.width).toBe(300);
            expect(bt.height).toBe(200);
        });

        it('carries a size and anchor to the Sprite and Text that draw into it', () => {
            connect();
            const n = node('both');
            n.addComponent(Sprite);
            n.addComponent(Label);
            const t = n.addComponent(UITransform)!;
            t.contentSize = new Size(120, 60);
            t.anchorPoint = new Vec2(0.5, 1);
            const s = W().get(n._entity, EngineSprite);
            expect([s.size.x, s.size.y, s.pivot.x, s.pivot.y]).toEqual([120, 60, 0.5, 1]);
            const x = W().get(n._entity, Text);
            expect([x.boxWidth, x.boxHeight, x.boxPivot?.x, x.boxPivot?.y]).toEqual([120, 60, 0.5, 1]);
        });

        it('tests a world point against its rectangle, anchor and position applied', () => {
            connect();
            const n = node('hit');
            const t = n.addComponent(UITransform)!;
            t.setContentSize(100, 50);
            t.setAnchorPoint(0.5, 0.5);
            n.setPosition(200, 100, 0);
            expect(t.isHit(new Vec2(200, 100))).toBe(true);
            expect(t.isHit(new Vec2(249, 124))).toBe(true);
            expect(t.isHit(new Vec2(251, 100))).toBe(false);
            expect(t.isHit(new Vec2(200, 126))).toBe(false);
            // an anchor at the bottom-left moves the rectangle up and to the right of the node
            t.setAnchorPoint(0, 0);
            expect(t.isHit(new Vec2(250, 120))).toBe(true);
            expect(t.isHit(new Vec2(199, 100))).toBe(false);
        });

        it('converts between node space and world space under a scaled, moved parent', () => {
            connect();
            const parent = node('p'), child = node('c');
            parent.addChild(child);
            parent.setPosition(100, 0, 0);
            parent.setScale(2, 2, 1);
            child.setPosition(10, 5, 0);
            const t = child.addComponent(UITransform)!;
            const world = t.convertToWorldSpaceAR(new Vec3(0, 0, 0));
            expect(world.x).toBeCloseTo(120, 3);   // 100 + 10 * 2
            expect(world.y).toBeCloseTo(10, 3);
            const back = t.convertToNodeSpaceAR(world);
            expect(back.x).toBeCloseTo(0, 3);
            expect(back.y).toBeCloseTo(0, 3);
            const box = t.getBoundingBoxToWorld();
            expect(box.width).toBeCloseTo(200, 3);   // the 100px default width, scaled by the parent
        });
    });
});

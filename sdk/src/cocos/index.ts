// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/index.ts
 * @brief   `esengine/cocos`: the Cocos Creator `cc` module, for scripts that were written against it.
 *
 * A project that brings Cocos scripts across builds them with `cc` aliased to this entry (the project-script bundler does that
 * for a project that asks for it), so `import { Component, Node, _decorator } from 'cc'` resolves here. The names exported are
 * the ones a Cocos script imports; what stands behind them is the engine — a `Node` is an entity, a `Component` subclass is an
 * Estella component with an instance — and the parts of Cocos that have no counterpart are not simulated (see each file).
 */
export { Vec2, Vec3, Quat, Color, Size, Rect, v2, v3, color, size, rect, math, toRadian, toDegree, clamp, clamp01, lerp } from './math';
export { Vec4, Mat4 } from './mat4';
export { Component } from './component';
export { Node, setCurrentWorld, getCurrentWorld } from './node';
import { Node as NodeClass } from './node';
/** The event names, under the name scripts import them by. */
export const NodeEventType = NodeClass.EventType;
export {
    _decorator, ccclass, property, requireComponent, executionOrder, menu, help, icon, inspector, playOnFocus, executeInEditMode,
    disallowMultiple, type, integer, float, string, boolean, CCInteger, CCFloat, CCString, CCBoolean, Enum,
} from './decorators';
export { director, Director, Scene, find, isValid, reportFrame } from './director';
export {
    Asset, ImageAsset, Texture2D, SpriteFrame, SpriteAtlas, Prefab, AudioClip, Material, JsonAsset, TextAsset, BitmapFont, Font,
    AnimationClip, SceneAsset, EffectAsset, Mesh,
} from './assets';
export { registerBuiltinComponent, type BuiltinAdapter } from './builtins';
export { UITransform, Label, LabelOutline, LabelShadow, Sprite, UIOpacity, Button, EventHandler, Widget, Layout, Camera, RichText, Mask, Toggle, ToggleContainer, ProgressBar, Slider, BlockInputEvents, ScrollView, Graphics, EditBox, getVisibleSize, setVisibleSize } from './ui';
export { Touch, EventTouch } from './input';
export { tween, Tween, tweenUtil, easing, updateTweens } from './tween';
export { instantiate, loadPrefab, providePrefab } from './prefabs';
export { sys } from './sys';
export { macro } from './macro';
export { Layers } from './layers';
export { view, View, ResolutionPolicy, screen } from './view';
export { game, Game } from './game';
export { input, Input, KeyCode, EventKeyboard, EventMouse } from './inputApi';
export { Emitter as EventTarget } from './emitter';
export { assetManager, AssetManager, Bundle, Cache, resources, setResourceManifest, type ResourceManifest, type ResourceEntry } from './assetManager';
export { declareBuiltinScripts, redeclareBuiltinScripts } from './builtinScripts';
/** `cc/env` is the same module here: its flags are named exports beside the rest. */
export * from './env';
export { classInfoNamed, classInfoOf, allClassInfos, COMPONENT_PREFIX, resetClassRegistry } from './registry';

import { declareBuiltinScripts as declare } from './builtinScripts';
// Declared once, into the context a game runs in, when the layer is imported.
declare();

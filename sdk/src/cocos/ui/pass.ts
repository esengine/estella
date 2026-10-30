// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/pass.ts
 * @brief   The end-of-frame pass that aligns widgets and arranges layouts.
 *
 * Cocos does both after the frame's scripts have run, so a script that moves or resizes something this frame is answered by the
 * alignment in the same frame. Widgets go first (a stretched container changes what its layout sees), then layouts innermost-first,
 * then widgets once more for the ones that follow a size the layouts just set (those set to align every frame).
 */
import { Schedule, defineSystem, addSystemToSchedule, GetWorld } from '../../ecs/system';
import { Res } from '../../ecs/resource';
import { UICameraInfo } from '../../ui/core/ui-camera-info';
import { ScreenLayout, type ScreenLayoutData } from '../../ui/core/screen-layout';
import { setCurrentWorld } from '../node';
import { declareWidget } from './widget';
import { alignAllRectAnchors } from '../../ui/layout/rect-anchors';
import { layoutAll, declareLayout } from './layout';
import { declareControls } from './controls';
import { declareGraphics } from './graphics';
import { declareEditBox } from './editBox';
import { declareScrollView } from './scrollView';
import { getVisibleSize, setSafeInsets, setScreenLayout, setUiCameraData, setVisibleSize, setWindowPixels, visibleSizeGeneration } from './screen';
import { declarePages } from './pages';
import { declareMisc } from './misc';

/** The screen the pass aligns to: the engine's, or — where there is none yet (a test, a host before its first frame) — the visible size it was told. */
function screenOrVisible(screen: ScreenLayoutData | undefined): ScreenLayoutData {
    if (screen?.valid) return screen;
    const v = getVisibleSize();
    const halfW = v.width / 2, halfH = v.height / 2;
    return { valid: true, left: -halfW, right: halfW, bottom: -halfH, top: halfH, safeLeft: -halfW, safeRight: halfW, safeBottom: -halfH, safeTop: halfH, scale: 1, viewportW: v.width, viewportH: v.height };
}

export function declareUiPass(): void {
    declareWidget();
    declareLayout();
    declareControls();
    declareGraphics();
    declareEditBox();
    declarePages();
    declareMisc();
    declareScrollView();
    const system = defineSystem(
        [Res(UICameraInfo), Res(ScreenLayout), GetWorld()],
        (camera, screen, world) => {
            // The camera is kept for the conversions a Cocos `Camera` offers. What the player sees, and the window, are the screen's: the
            // layout box UI is placed within, and the framebuffer it projects onto.
            setUiCameraData(camera ?? null);
            const layout = screenOrVisible(screen);
            setScreenLayout(layout);
            if (screen?.valid) {
                setVisibleSize(screen.right - screen.left, screen.top - screen.bottom);
                setWindowPixels(screen.viewportW, screen.viewportH);
                setSafeInsets(
                    Math.max(0, screen.safeLeft - screen.left), Math.max(0, screen.right - screen.safeRight),
                    Math.max(0, screen.top - screen.safeTop), Math.max(0, screen.safeBottom - screen.bottom));
            }
            const previous = setCurrentWorld(world);
            try {
                // The engine's anchors, between the layouts that depend on them: a Layout resizes what a widget then pins to.
                alignAllRectAnchors(world, layout, visibleSizeGeneration());
                layoutAll(world);
                alignAllRectAnchors(world, layout, visibleSizeGeneration());
            } finally {
                setCurrentWorld(previous);
            }
        },
        { name: 'Cocos:UiPass', touches: { opaque: true } },
    );
    addSystemToSchedule(Schedule.Last, system);
}

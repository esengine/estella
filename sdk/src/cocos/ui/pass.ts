// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/pass.ts
 * @brief   Registers the Cocos UI components and the systems that arrange layouts and publish the screen to scripts.
 *
 * Alignment is the engine's (RectAnchors); the Layout arithmetic is Cocos's, and runs between the engine's two anchor passes.
 */
import { Schedule, defineSystem, addSystemToSchedule, GetWorld } from '../../ecs/system';
import { Res } from '../../ecs/resource';
import { UICameraInfo } from '../../ui/core/ui-camera-info';
import { ScreenLayout, type ScreenLayoutData } from '../../ui/core/screen-layout';
import { ScreenScaling, type ScreenScalingData } from '../../camera/ScreenScaling';
import { setCurrentWorld } from '../node';
import { declareWidget } from './widget';
import { rectAnchorsPlugin, setRectAnchorsScreenFallback } from '../../ui/layout/rect-anchors';
import { SystemLabel } from '../../ecs/systemLabels';
import { Renderer } from '../../render/renderer';
import { getDefaultContext } from '../../ecs/context';
import { layoutAll, declareLayout } from './layout';
import { declareControls } from './controls';
import { declareGraphics } from './graphics';
import { declareEditBox } from './editBox';
import { declareScrollView } from './scrollView';
import { getVisibleSize, setProjectDesign, setSafeInsets, setScreenLayout, setUiCameraData, setVisibleSize, setWindowPixels } from './screen';
import { declarePages } from './pages';
import { declareMisc } from './misc';

/** The screen the pass aligns to: the engine's, or — where there is none yet (a test, a host before its first frame) — the visible size it was told. */
function screenOrVisible(screen: ScreenLayoutData | undefined): ScreenLayoutData {
    if (screen?.valid) return screen;
    const v = getVisibleSize();
    const halfW = v.width / 2, halfH = v.height / 2;
    return { valid: true, left: -halfW, right: halfW, bottom: -halfH, top: halfH, safeLeft: -halfW, safeRight: halfW, safeBottom: -halfH, safeTop: halfH, scale: 1, viewportW: v.width, viewportH: v.height };
}

/** Cocos's UI_2D layer, as a bit of the engine's layer mask. */
const TREE_ORDERED_LAYERS = (1 << 25) >>> 0;

export function declareUiPass(): void {
    declareWidget();
    declareLayout();
    declareControls();
    declareGraphics();
    declareEditBox();
    declarePages();
    declareMisc();
    declareScrollView();
    // The engine's anchor system places what is pinned; a Cocos Layout then arranges and resizes, and the engine's second anchor pass
    // follows the sizes the layouts set (the nodes set to align every frame). Cocos does both after the frame's scripts have run, so a
    // script that moves or resizes something this frame is answered in the same frame.
    getDefaultContext().pendingPlugins.push(rectAnchorsPlugin);
    setRectAnchorsScreenFallback(() => screenOrVisible(undefined));
    addSystemToSchedule(Schedule.PostUpdate, defineSystem(
        [GetWorld()],
        (world) => {
            const previous = setCurrentWorld(world);
            try { layoutAll(world); } finally { setCurrentWorld(previous); }
        },
        { name: 'Cocos:Layout', touches: { opaque: true }, runAfter: [SystemLabel.RectAnchors], runBefore: [SystemLabel.RectAnchorsLate] },
    ));
    // What scripts read about the screen, before they run: the project design, the visible size and the framebuffer, the safe insets,
    // the camera for the conversions a Cocos `Camera` offers.
    addSystemToSchedule(Schedule.PreUpdate, defineSystem(
        [Res(UICameraInfo), Res(ScreenLayout), Res(ScreenScaling)],
        (camera, screen: ScreenLayoutData | undefined, scaling: ScreenScalingData | undefined) => {
            // Cocos paints a layer's nodes in hierarchy order, a label no different from an image: a popup covers the text of the view under
            // it. The UI layer is therefore painted in tree order, which is a setting of the renderer and so is stated where the pass is.
            Renderer.setTreeSortLayers(TREE_ORDERED_LAYERS);
            if (scaling) setProjectDesign(scaling.designWidth, scaling.designHeight, scaling.scaleMode);
            setUiCameraData(camera ?? null);
            setScreenLayout(screenOrVisible(screen));
            if (screen?.valid) {
                setVisibleSize(screen.right - screen.left, screen.top - screen.bottom);
                setWindowPixels(screen.viewportW, screen.viewportH);
                setSafeInsets(
                    Math.max(0, screen.safeLeft - screen.left), Math.max(0, screen.right - screen.safeRight),
                    Math.max(0, screen.top - screen.safeTop), Math.max(0, screen.safeBottom - screen.bottom));
            }
        },
        { name: 'Cocos:Screen', touches: { opaque: true } },
    ));
}

// Everything interesting lives here. Three demos, all built on the same two
// components — UIController (a named enum of "pages") and UIGear (per-page
// values for a field) — plus the free helpers setControllerPage / gearBinding:
//
//   1. Tab bar   — one 'tab' controller on the Canvas; the three tab buttons,
//                  the content card's colour, and the card label's text are each
//                  a gear keyed to that controller. Click a tab → everything
//                  reflows. No bespoke state code anywhere.
//   2. $interaction button — a button whose normal/hover/pressed/disabled look
//                  is a UIController(interactionController) + a colour gear. This
//                  is the unified replacement for StateMachine + StateVisuals.
//   3. Popup     — a 'popup' controller (closed/open) whose panel gears its scale
//                  and alpha with an eased tween, toggled by the button.
import {
    defineSystem, Res, GetWorld, Schedule,
    UIEvents,
    Transform, UIVisual, Interactable, UIInteraction,
    spawnUIEntity, px, percent, UIPositionType,
    UIController, UIGear, interactionController, controllerState,
    setControllerPage, getControllerPage, gearBinding,
    EasingType,
} from 'esengine';
import type { Entity, World, Color, UIEventQueue } from 'esengine';

const TAB_PAGES = ['overview', 'stats', 'about'] as const;
type TabPage = (typeof TAB_PAGES)[number];

const TAB_LABEL: Record<TabPage, string> = {
    overview: 'Overview', stats: 'Stats', about: 'About',
};
const CARD_COLOR: Record<TabPage, Color> = {
    overview: { r: 0.16, g: 0.18, b: 0.26, a: 1 },
    stats:    { r: 0.21, g: 0.16, b: 0.26, a: 1 },
    about:    { r: 0.15, g: 0.23, b: 0.21, a: 1 },
};
const CARD_TEXT: Record<TabPage, string> = {
    overview: 'One controller, many gears — this whole card is driven by the "tab" page.',
    stats:    'Switching tabs only changes a page name; every geared field follows.',
    about:    'Controllers + Gears are plain ECS components — they travel with prefabs.',
};

const ACCENT: Color = { r: 0.35, g: 0.55, b: 0.95, a: 1 };
const MUTED: Color = { r: 0.22, g: 0.24, b: 0.30, a: 1 };

const BTN_NORMAL: Color = { r: 0.30, g: 0.33, b: 0.42, a: 1 };
const BTN_HOVER: Color = { r: 0.39, g: 0.43, b: 0.55, a: 1 };
const BTN_PRESSED: Color = { r: 0.22, g: 0.24, b: 0.32, a: 1 };
const BTN_DISABLED: Color = { r: 0.20, g: 0.20, b: 0.24, a: 0.6 };

let built = false;

export const buildSystem = defineSystem(
    [Res(UIEvents), GetWorld()],
    (events: UIEventQueue, world: World) => {
        if (built) return;
        const canvas = world.findEntityByName('Canvas');
        if (canvas === null) return; // scene not loaded yet — try again next frame
        built = true;

        // The Canvas hosts the two shared controllers; gears on descendants
        // resolve up to it. ($interaction lives on the button itself.)
        world.insert(canvas, UIController, {
            controllers: [
                controllerState('tab', [...TAB_PAGES], 'overview'),
                controllerState('popup', ['closed', 'open'], 'closed'),
            ],
        });

        title(world, canvas, 'Controllers & Gears', 26, 24);
        title(world, canvas, 'Click the tabs · hover the button · toggle the popup', 14, 58, MUTED);

        buildTabBar(world, events, canvas);
        buildContentCard(world, canvas);
        buildInteractionButton(world, events, canvas);
        buildPopup(world, canvas);
    },
    { name: 'BuildUIControllerDemo' },
);

// ── 1. Tab bar ───────────────────────────────────────────────────────────────

function buildTabBar(world: World, events: UIEventQueue, canvas: Entity): void {
    TAB_PAGES.forEach((page, i) => {
        const btn = panel(world, canvas, {
            width: 150, height: 40, top: 96, centerOffsetX: (i - 1) * 160,
            color: MUTED,
        });
        makeInteractive(world, btn);
        label(world, btn, TAB_LABEL[page], 15);

        // Radio highlight: this button is ACCENT only on its own page.
        const pages: Record<string, Color> = {};
        for (const p of TAB_PAGES) pages[p] = p === page ? ACCENT : MUTED;
        world.insert(btn, UIGear, {
            bindings: [gearBinding('tab', 'UIVisual', 'color', pages,
                { easing: EasingType.EaseOutCubic, duration: 0.12 })],
        });

        events.on(btn, 'click', () => setControllerPage(world, canvas, 'tab', page));
    });
}

// ── 2. Content card (colour gear + text gear, both keyed to 'tab') ────────────

function buildContentCard(world: World, canvas: Entity): void {
    const card = panel(world, canvas, {
        width: 500, height: 150, top: 150, centerOffsetX: 0,
        color: CARD_COLOR.overview,
    });
    world.insert(card, UIGear, {
        bindings: [gearBinding('tab', 'UIVisual', 'color', CARD_COLOR,
            { easing: EasingType.EaseOutCubic, duration: 0.18 })],
    });

    const text = spawnUIEntity({
        world, parent: card,
        node: { position: UIPositionType.Absolute, insetLeft: px(24), insetRight: px(24),
            insetTop: px(0), insetBottom: px(0) },
        text: { content: CARD_TEXT.overview, fontSize: 16, wordWrap: true,
            color: { r: 0.92, g: 0.94, b: 0.98, a: 1 } },
    });
    // Text is a snap gear (strings can't interpolate).
    world.insert(text, UIGear, {
        bindings: [gearBinding('tab', 'Text', 'content', CARD_TEXT)],
    });
}

// ── 3. $interaction button — StateVisuals parity through the unified layer ─────

function buildInteractionButton(world: World, events: UIEventQueue, canvas: Entity): void {
    const btn = panel(world, canvas, {
        width: 220, height: 46, top: 326, centerOffsetX: 0,
        color: BTN_NORMAL,
    });
    makeInteractive(world, btn);
    label(world, btn, 'Toggle Popup', 15);

    // The button owns its own $interaction controller; the driver writes its
    // page from pointer state and this colour gear paints each page.
    world.insert(btn, UIController, { controllers: [interactionController()] });
    world.insert(btn, UIGear, {
        bindings: [gearBinding('$interaction', 'UIVisual', 'color', {
            normal: BTN_NORMAL, hover: BTN_HOVER, pressed: BTN_PRESSED, disabled: BTN_DISABLED,
        }, { easing: EasingType.EaseOutCubic, duration: 0.1 })],
    });

    events.on(btn, 'click', () => {
        const open = getControllerPage(world, canvas, 'popup') === 'open';
        setControllerPage(world, canvas, 'popup', open ? 'closed' : 'open');
    });
}

// ── 4. Popup — scale + alpha gears with an eased tween on the 'popup' controller ─

function buildPopup(world: World, canvas: Entity): void {
    const popup = spawnUIEntity({
        world, parent: canvas,
        node: { position: UIPositionType.Absolute, width: px(360), height: px(170),
            insetLeft: percent(50), marginLeft: px(-180),
            insetTop: percent(50), marginTop: px(-85) },
        visual: { color: { r: 0.16, g: 0.17, b: 0.24, a: 0 } }, // starts closed → alpha 0
    });
    // Match the 'closed' page at spawn (scale 0.7) so there's no startup pop.
    setScale(world, popup, 0.7);

    world.insert(popup, UIGear, {
        bindings: [
            gearBinding('popup', 'Transform', 'scale',
                { closed: { x: 0.7, y: 0.7, z: 1 }, open: { x: 1, y: 1, z: 1 } },
                { easing: EasingType.EaseOutBack, duration: 0.28 }),
            gearBinding('popup', 'UIVisual', 'color.a',
                { closed: 0, open: 0.97 },
                { easing: EasingType.EaseOutCubic, duration: 0.28 }),
        ],
    });

    const text = spawnUIEntity({
        world, parent: popup,
        node: { position: UIPositionType.Absolute, insetLeft: px(20), insetRight: px(20),
            insetTop: px(0), insetBottom: px(0) },
        text: { content: 'Popped via a "popup" controller.\nScale + alpha are gears with an EaseOutBack tween.',
            fontSize: 15, wordWrap: true, color: { r: 0, g: 0, b: 0, a: 0 } },
    });
    world.insert(text, UIGear, {
        bindings: [gearBinding('popup', 'Text', 'color.a',
            { closed: 0, open: 1 }, { easing: EasingType.EaseOutCubic, duration: 0.28 })],
    });
}

// ── small local UI helpers ────────────────────────────────────────────────────

interface PanelInit { width: number; height: number; top: number; centerOffsetX: number; color: Color; }

/** A horizontally-centered absolute panel at a given top offset. */
function panel(world: World, parent: Entity, p: PanelInit): Entity {
    return spawnUIEntity({
        world, parent,
        node: {
            position: UIPositionType.Absolute,
            width: px(p.width), height: px(p.height),
            insetLeft: percent(50), marginLeft: px(p.centerOffsetX - p.width / 2),
            insetTop: px(p.top),
        },
        visual: { color: p.color },
    });
}

function title(world: World, parent: Entity, content: string, fontSize: number, top: number, color?: Color): Entity {
    return spawnUIEntity({
        world, parent,
        node: { position: UIPositionType.Absolute, width: px(700),
            insetLeft: percent(50), marginLeft: px(-350), insetTop: px(top), height: px(fontSize + 8) },
        text: { content, fontSize, bold: fontSize >= 20, color: color ?? { r: 1, g: 1, b: 1, a: 1 } },
    });
}

function label(world: World, parent: Entity, content: string, fontSize: number): Entity {
    return spawnUIEntity({
        world, parent,
        node: { position: UIPositionType.Absolute, insetLeft: px(0), insetRight: px(0),
            insetTop: px(0), insetBottom: px(0) },
        text: { content, fontSize, color: { r: 1, g: 1, b: 1, a: 1 } },
    });
}

function makeInteractive(world: World, e: Entity): void {
    world.insert(e, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
    world.insert(e, UIInteraction, { hovered: false, pressed: false, justPressed: false, justReleased: false });
}

function setScale(world: World, e: Entity, s: number): void {
    const t = world.get(e, Transform) as { scale: { x: number; y: number; z: number } };
    t.scale = { x: s, y: s, z: 1 };
    world.insert(e, Transform, t);
}

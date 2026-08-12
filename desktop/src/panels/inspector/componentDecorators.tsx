// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  componentDecorators.tsx — the one door for per-component inspector UI.
 * @brief Extra UI a component gets beyond its reflected fields: the UINode anchor
 *        grid, the collider shape switch, the "put me under a Canvas" action.
 *
 * Built-ins register under owner `'core'` like every other contribution, so the
 * panel never branches on a component name.
 *
 * A decorator declares its `surfaces`, defaulting to edit-only: the Game
 * inspector selects by realm runtime id, which is a different id space from the
 * edit model's source ids, so one that walks SceneModel would misread it.
 */

import { Fragment, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronRight, Circle,
  CornerLeftUp, Hexagon, MousePointerClick, Plus, Square, StretchHorizontal,
  StretchVertical, X,
} from 'lucide-react';
import { Segmented, type SegmentedOption } from '@/components/Segmented';
import { readGearBindings, resolveControllers } from '@/controller/controllerModel';
import { SceneCommands } from '@/engine/SceneCommands';
import { SceneModel } from '@/engine/SceneModel';
import { SceneStore } from '@/engine/SceneStore';
import { COMP_COLLIDER_SHAPE, type ColliderShapeKind } from '@/engine/colliderConvert';
import { sourceById, createFromSource } from '@/engine/entitySources';
import { useControllerStore } from '@/store/controllerStore';
import { useInspectorCollapse, isSectionCollapsed } from '@/store/inspectorCollapse';
import { ContributionRegistry, type Disposable, type Owner } from '@/contrib/ContributionRegistry';
import { t } from '@/i18n';
import {
  DimensionUnit, AnchorAxis, detectAnchorAxes, UIPositionType, FlexDirection,
  FlexWrap, JustifyContent, AlignItems, INTERACTION_CONTROLLER, INTERACTION_PAGES,
} from 'esengine';
import type { InspectorComponent, InspectorField, EntityId } from '@/types';

async function addTextLayoutBox(sourceId: EntityId): Promise<void> {
  let canvas = SceneCommands.findCanvas();
  if (canvas == null) {
    const src = sourceById('canvas');
    canvas = src ? await createFromSource(src, { parent: null }) : null;
  }
  if (canvas != null) SceneCommands.attachUINodeBox(sourceId, canvas, 240, 80);
}

/** The one-click "Add layout box" action for a boxless Text (no UINode), else undefined. */
function textBoxAction(comp: InspectorComponent, sourceId: EntityId): { label: string; title: string; run: () => void } | undefined {
  if (comp.name !== 'Text') return undefined;
  const e = SceneModel.entityBySource(sourceId);
  if (!e || e.components.some((c) => c.type === 'UINode')) return undefined;
  return {
    label: t('det.addLayoutBox'),
    title: t('det.addLayoutBoxTip'),
    run: () => void addTextLayoutBox(sourceId),
  };
}

/** Whether a UI element sits under a Canvas (the UI layout root) — walks ancestors. */
function hasCanvasAncestor(sourceId: EntityId): boolean {
  for (let p = SceneModel.entityBySource(sourceId)?.parent; p != null; p = SceneModel.entityBySource(p)?.parent) {
    if (SceneModel.entityBySource(p)?.components.some((c) => c.type === 'Canvas')) return true;
  }
  return false;
}

/** Ensure a Canvas exists (create one if the scene has none) and place `sourceIds` under it. */
async function placeUnderCanvas(sourceIds: EntityId[]): Promise<void> {
  let canvas = SceneCommands.findCanvas();
  if (canvas == null) {
    const src = sourceById('canvas');
    canvas = src ? await createFromSource(src, { parent: null }) : null;
  }
  if (canvas == null) return;
  for (const id of sourceIds) if (id !== canvas) SceneCommands.setParent(id, canvas);
}

/** The one-click "Place under a Canvas" action for a UINode with no Canvas ancestor —
 *  a UI element with no Canvas can't lay out or be moved — else undefined. */
function uiNodeCanvasAction(ids: EntityId[], comp: InspectorComponent): { label: string; title: string; run: () => void } | undefined {
  if (comp.name !== 'UINode') return undefined;
  const orphans = ids.filter((id) => !hasCanvasAncestor(id));
  if (orphans.length === 0) return undefined;
  return {
    label: t('det.placeUnderCanvas'),
    title: t('det.placeUnderCanvasTip'),
    run: () => void placeUnderCanvas(orphans),
  };
}

const ANCHOR_H = { [AnchorAxis.Start]: t('det.anchorLeft'), [AnchorAxis.Center]: t('det.anchorCenter'), [AnchorAxis.End]: t('det.anchorRight'), [AnchorAxis.Stretch]: t('det.anchorStretchH') };
const ANCHOR_V = { [AnchorAxis.Start]: t('det.anchorTop'), [AnchorAxis.Center]: t('det.anchorMiddle'), [AnchorAxis.End]: t('det.anchorBottom'), [AnchorAxis.Stretch]: t('det.anchorStretchV') };
const anchorTitle = (h: AnchorAxis, v: AnchorAxis) =>
  h === AnchorAxis.Stretch && v === AnchorAxis.Stretch ? t('det.anchorStretch') : `${ANCHOR_V[v]} · ${ANCHOR_H[h]}`;

// Point-anchor labels for the 3×3 grid cells (columns Left/Centre/Right, rows Top/
// Middle/Bottom) — the cell's tooltip reads "row · column", e.g. "Top · Left".
const ANCHOR_H_LABEL = [t('det.anchorLeft'), t('det.anchorCenter'), t('det.anchorRight')];
const ANCHOR_V_LABEL = [t('det.anchorTop'), t('det.anchorMiddle'), t('det.anchorBottom')];

const POSITION_MODE_OPTS = [
  { value: String(UIPositionType.Relative), label: t('det.inLayout') },
  { value: String(UIPositionType.Absolute), label: t('det.absolute') },
];
// alignSelf enum: 0 Auto · 1 Start · 2 Center · 3 End · 4 Stretch (matches the SDK).
const ALIGN_SELF_OPTS = [
  { value: '0', label: t('det.alignAuto') },
  { value: '1', label: t('det.alignStart') },
  { value: '2', label: t('det.alignCenter') },
  { value: '3', label: t('det.alignEnd') },
  { value: '4', label: t('det.alignStretch') },
];

/** The UINode fields the Layout block owns, so the generic field flow skips them —
 *  which set depends on the positioning MODE (an anchor/inset belongs to Absolute,
 *  the flex knobs to flow). Mirrors how box cards claim their edge fields. */
function uiLayoutOwnedFields(absolute: boolean): ReadonlySet<string> {
  const base = ['position', 'alignSelf'];
  // Flow: offsets are meaningless (inset only applies to Absolute). Absolute: the
  // flex-item knobs don't participate (the node is out of flow).
  return new Set(absolute ? [...base, 'flexGrow', 'flexShrink', 'flexBasis'] : [...base, 'insetLeft', 'insetRight', 'insetTop', 'insetBottom']);
}

/** The anchor picker for an ABSOLUTE UINode: a clickable 3×3 grid for the nine point
 *  anchors (Left/Centre/Right × Top/Middle/Bottom) plus a Stretch toggle per axis. Each
 *  axis is written alone (setUINodeAnchor) so the other keeps its state, read back
 *  per-axis via detectAnchorAxes — a hand-tuned axis simply lights no cell. */
function AnchorPicker({ entities, comp }: { entities: EntityId[]; comp: InspectorComponent }) {
  const dim = (key: string) => {
    const v = comp.fields.find((f) => f.key === key)?.value as { value: number; unit: number } | undefined;
    return v ?? { value: 0, unit: DimensionUnit.Auto };
  };
  const node = {
    position: UIPositionType.Absolute,
    insetLeft: dim('insetLeft'), insetRight: dim('insetRight'),
    insetTop: dim('insetTop'), insetBottom: dim('insetBottom'),
    marginLeft: dim('marginLeft'), marginRight: dim('marginRight'),
    marginTop: dim('marginTop'), marginBottom: dim('marginBottom'),
    width: dim('width'), height: dim('height'),
  } as Parameters<typeof detectAnchorAxes>[0];
  // Each axis classifies independently, so a box with one hand-tuned axis still
  // shows (and keeps) the clean one; writing an axis touches ONLY that axis.
  const axes = detectAnchorAxes(node);
  const clean = axes.h !== null && axes.v !== null;
  const hStretch = axes.h === AnchorAxis.Stretch;
  const vStretch = axes.v === AnchorAxis.Stretch;
  // The lit grid cell — only when BOTH axes pin to a point (a Stretch or hand-tuned
  // axis leaves no single cell; the Stretch toggles carry that state instead).
  const activeCell = axes.h !== null && axes.h <= AnchorAxis.End && axes.v !== null && axes.v <= AnchorAxis.End
    ? { c: axes.h, r: axes.v }
    : null;
  const setAnchor = (patch: { h?: number; v?: number }) => SceneCommands.setUINodeAnchor(entities, patch);
  return (
    <>
      <div className="anchor-head">
        <span className="anchor-t">{t('det.anchor')}</span>
        <em className="anchor-cur">{clean ? anchorTitle(axes.h!, axes.v!) : t('det.anchorCustom')}</em>
      </div>
      <div className="anchor-grid-row">
        <AlignGrid
          active={activeCell}
          dim={hStretch || vStretch}
          ariaLabel={t('det.anchor')}
          cellTitle={(c, r) => `${ANCHOR_V_LABEL[r]} · ${ANCHOR_H_LABEL[c]}`}
          onPick={(c, r) => setAnchor({ h: c, v: r })}
        />
        <div className="anchor-stretch">
          <button
            type="button"
            className={`mini-toggle${hStretch ? ' on' : ''}`}
            title={t('det.anchorStretchH')}
            aria-pressed={hStretch}
            onClick={() => setAnchor({ h: hStretch ? AnchorAxis.Start : AnchorAxis.Stretch })}
          >
            <StretchHorizontal size={13} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className={`mini-toggle${vStretch ? ' on' : ''}`}
            title={t('det.anchorStretchV')}
            aria-pressed={vStretch}
            onClick={() => setAnchor({ v: vStretch ? AnchorAxis.Start : AnchorAxis.Stretch })}
          >
            <StretchVertical size={13} strokeWidth={1.9} />
          </button>
        </div>
      </div>
    </>
  );
}

/** The flow-layout controls for a RELATIVE (In-Layout) UINode: its parent's flex
 *  layout decides the placement, so the only per-node control is the cross-axis
 *  Align Self (the flow analog of a 1-axis anchor). Grow/shrink/basis live in the
 *  field flow below. */
function FlowLayoutControls({ entities, comp }: { entities: EntityId[]; comp: InspectorComponent }) {
  const field = comp.fields.find((f) => f.key === 'alignSelf');
  const value = field?.mixed ? '' : String(Number(field?.value ?? 0));
  const set = (val: string) => {
    SceneCommands.beginGesture('Align Self');
    for (const id of entities) SceneCommands.setField(id, 'UINode', 'alignSelf', 'enum', Number(val));
    SceneCommands.endGesture();
  };
  return (
    <>
      <div className="anchor-body">
        <div className="anchor-axes">
          <label className="anchor-axis">
            <span>{t('det.alignSelf')}</span>
            <Segmented grow ariaLabel={t('det.alignSelfAria')} value={value} options={ALIGN_SELF_OPTS} onChange={set} />
          </label>
        </div>
      </div>
      <div className="anchor-hint">{t('det.flowHint')}</div>
    </>
  );
}

/** The UINode positioning block: an explicit In-Layout ↔ Absolute mode switch, then
 *  the controls that actually apply in that mode — the anchor presets for Absolute,
 *  Align Self for flow. Anchors are an absolute-positioning concept, so a flow node
 *  never shows a meaningless "Custom" anchor; it shows how it sits in its parent's
 *  flex layout instead. The mode switch writes `position` (flipping to Absolute bakes
 *  the current on-screen box into px insets — see SceneCommands.setField). */
// The convertible collider shapes, shown as a segmented switch on the collider card's
// header. Converting preserves material / sensor / filter and re-derives geometry (see
// SceneCommands.convertCollider) — you can start with a box and turn it into a slope
// polygon without losing what you set.
const COLLIDER_SHAPE_OPTIONS: SegmentedOption<ColliderShapeKind>[] = [
  { value: 'box', label: t('det.shapeBox'), icon: <Square size={11} />, title: t('det.shapeBox') },
  { value: 'circle', label: t('det.shapeCircle'), icon: <Circle size={11} />, title: t('det.shapeCircle') },
  { value: 'polygon', label: t('det.shapePolygon'), icon: <Hexagon size={11} />, title: t('det.shapePolygon') },
];

// Shape switch for a box/circle/polygon collider card — click another shape to convert
// the collider on every selected entity (one undo step). Null for non-convertible cards.
function ColliderShapeControl({ entities, current }: { entities: EntityId[]; current: string }) {
  const kind = COMP_COLLIDER_SHAPE[current];
  if (!kind) return null;
  return (
    <div className="collider-shape">
      <span className="collider-shape-lbl">{t('det.colliderShape')}</span>
      <Segmented
        value={kind}
        options={COLLIDER_SHAPE_OPTIONS}
        ariaLabel={t('det.colliderShape')}
        grow
        onChange={(to) => { if (to !== kind) SceneCommands.convertColliderMany(entities, to); }}
      />
    </div>
  );
}

function UILayoutControl({ entities, comp }: { entities: EntityId[]; comp: InspectorComponent }) {
  const posField = comp.fields.find((f) => f.key === 'position');
  const absolute = Number(posField?.value ?? 0) === UIPositionType.Absolute;
  const setMode = (val: string) => {
    SceneCommands.beginGesture('UI Position Mode');
    for (const id of entities) SceneCommands.setField(id, 'UINode', 'position', 'enum', Number(val));
    SceneCommands.endGesture();
  };
  return (
    <div className="anchor-block">
      <div className="ui-mode-row">
        <span className="anchor-t">{t('det.position')}</span>
        <Segmented
          grow
          ariaLabel={t('det.positionModeAria')}
          value={posField?.mixed ? '' : String(absolute ? UIPositionType.Absolute : UIPositionType.Relative)}
          options={POSITION_MODE_OPTS}
          onChange={setMode}
        />
      </div>
      {absolute ? <AnchorPicker entities={entities} comp={comp} /> : <FlowLayoutControls entities={entities} comp={comp} />}
    </div>
  );
}

// The FlexContainer "auto-layout" widget — direction, a 3×3 alignment grid, main-axis
// distribution and a cross-axis stretch toggle, in place of five stacked enum dropdowns.
// The grid's axes swap with the flow direction so the highlighted cell always reads as
// where the children actually pack (the Figma model). Gap + padding stay as normal
// fields below (padding via the reflected 'sides' control).
const FLEX_DIR_OPTS: SegmentedOption<string>[] = [
  { value: String(FlexDirection.Row), icon: <ArrowRight size={12} strokeWidth={2.2} />, title: t('det.flexRow') },
  { value: String(FlexDirection.Column), icon: <ArrowDown size={12} strokeWidth={2.2} />, title: t('det.flexColumn') },
  { value: String(FlexDirection.RowReverse), icon: <ArrowLeft size={12} strokeWidth={2.2} />, title: t('det.flexRowReverse') },
  { value: String(FlexDirection.ColumnReverse), icon: <ArrowUp size={12} strokeWidth={2.2} />, title: t('det.flexColumnReverse') },
];
const FLEX_DISTRIBUTE_OPTS: SegmentedOption<string>[] = [
  { value: 'packed', label: t('det.flexPacked') },
  { value: String(JustifyContent.SpaceBetween), label: t('det.flexBetween') },
  { value: String(JustifyContent.SpaceAround), label: t('det.flexAround') },
  { value: String(JustifyContent.SpaceEvenly), label: t('det.flexEvenly') },
];
const FLEX_MAIN_LABEL = [t('det.flexMainStart'), t('det.flexMainCenter'), t('det.flexMainEnd')];
const FLEX_CROSS_LABEL = [t('det.flexCrossStart'), t('det.flexCrossCenter'), t('det.flexCrossEnd')];
// Fields the widget owns, so the generic field flow skips them — gap, padding and the
// wrap-only alignContent stay as normal rows below (padding via the 'sides' control).
const FLEX_WIDGET_OWNED_FIELDS: ReadonlySet<string> = new Set(['direction', 'justifyContent', 'alignItems', 'wrap']);
// Place the cell's dot at its spatial position (col → left/centre/right, row →
// top/middle/bottom) so the grid previews where content lands, Figma-style.
const ALIGN_CELL_CSS = ['flex-start', 'center', 'flex-end'];

// The shared 3×3 alignment picker — one idiom for choosing a 2-D position across the
// editor (UINode anchor + FlexContainer justify×align). The caller maps grid columns
// (c) / rows (r) to its own axes; `active` lights the current cell, `dim` fades the
// grid when another control (a Stretch/Distribute mode) owns an axis.
function AlignGrid({ active, dim, onPick, cellTitle, ariaLabel }: {
  active: { c: number; r: number } | null;
  dim?: boolean;
  onPick: (c: number, r: number) => void;
  cellTitle: (c: number, r: number) => string;
  ariaLabel: string;
}) {
  return (
    <div className="align-grid" role="group" aria-label={ariaLabel}>
      {[0, 1, 2].map((r) =>
        [0, 1, 2].map((c) => {
          const on = active?.c === c && active?.r === r;
          return (
            <button
              key={`${c}-${r}`}
              type="button"
              className={`align-cell${on ? ' on' : ''}${dim ? ' dim' : ''}`}
              style={{ justifyContent: ALIGN_CELL_CSS[c], alignItems: ALIGN_CELL_CSS[r] }}
              title={cellTitle(c, r)}
              aria-pressed={on}
              onClick={() => onPick(c, r)}
            >
              <i />
            </button>
          );
        }),
      )}
    </div>
  );
}

function FlexLayoutControl({ entities, comp }: { entities: EntityId[]; comp: InspectorComponent }) {
  const field = (key: string) => comp.fields.find((f) => f.key === key);
  const fieldNum = (key: string, dflt: number) => {
    const f = field(key);
    return f && f.mixed !== true ? Number(f.value) : dflt;
  };
  const dir = fieldNum('direction', FlexDirection.Row);
  const justify = fieldNum('justifyContent', JustifyContent.Start);
  const align = fieldNum('alignItems', AlignItems.Stretch);
  const wrap = fieldNum('wrap', FlexWrap.NoWrap);
  const horizontal = dir === FlexDirection.Row || dir === FlexDirection.RowReverse;

  const write = (label: string, edits: Array<[string, number]>) => {
    SceneCommands.beginGesture(label);
    for (const id of entities) for (const [k, v] of edits) SceneCommands.setField(id, 'FlexContainer', k, 'enum', v);
    SceneCommands.endGesture();
  };

  // 3×3 grid cell (col c, row r), c/r ∈ {0 Start, 1 Centre, 2 End}. The MAIN axis is
  // columns when the flow is horizontal, rows when vertical — so a click packs the
  // children where the cell sits. Space-mode justify has no single active cell.
  const packed = justify <= JustifyContent.End;
  const activeMain = packed ? justify : null;
  const activeCross = align <= AlignItems.End ? align : null; // Stretch → no single lane
  // Map a grid cell (c, r) to flex axes: the MAIN axis is columns when the flow is
  // horizontal, rows when vertical — so a click packs the children where the cell sits.
  const cellAxes = (c: number, r: number) => ({ main: horizontal ? c : r, cross: horizontal ? r : c });
  // The lit cell: only when both axes are packed to a single lane (Start/Centre/End).
  const activeCell = activeMain !== null && activeCross !== null
    ? { c: horizontal ? activeMain : activeCross, r: horizontal ? activeCross : activeMain }
    : null;
  const distributeValue = justify >= JustifyContent.SpaceBetween ? String(justify) : 'packed';
  const stretched = align === AlignItems.Stretch;

  return (
    <div className="flex-block">
      <div className="flex-row">
        <span className="flex-lbl">{t('det.flexDirection')}</span>
        <Segmented
          grow
          ariaLabel={t('det.flexDirectionAria')}
          value={field('direction')?.mixed ? '' : String(dir)}
          options={FLEX_DIR_OPTS}
          onChange={(v) => write('Flex Direction', [['direction', Number(v)]])}
        />
      </div>
      <div className="flex-row flex-align-row">
        <span className="flex-lbl">{t('det.flexAlign')}</span>
        <AlignGrid
          active={activeCell}
          dim={!packed}
          ariaLabel={t('det.flexAlignGridAria')}
          cellTitle={(c, r) => {
            const a = cellAxes(c, r);
            return t('det.flexAlignCell', { main: FLEX_MAIN_LABEL[a.main], cross: FLEX_CROSS_LABEL[a.cross] });
          }}
          onPick={(c, r) => {
            const a = cellAxes(c, r);
            write('Flex Align', [['justifyContent', a.main], ['alignItems', a.cross]]);
          }}
        />
        <button
          type="button"
          className={`mini-toggle${stretched ? ' on' : ''}`}
          title={t('det.flexStretchAria')}
          aria-pressed={stretched}
          onClick={() => write('Flex Stretch', [['alignItems', stretched ? AlignItems.Center : AlignItems.Stretch]])}
        >
          {t('det.flexStretch')}
        </button>
      </div>
      <div className="flex-row">
        <span className="flex-lbl">{t('det.flexDistribute')}</span>
        <Segmented
          grow
          ariaLabel={t('det.flexDistributeAria')}
          value={distributeValue}
          options={FLEX_DISTRIBUTE_OPTS}
          onChange={(val) => write('Flex Distribute', [['justifyContent', val === 'packed' ? JustifyContent.Start : Number(val)]])}
        />
      </div>
      <div className="flex-row">
        <span className="flex-lbl">{t('det.flexWrap')}</span>
        <button
          type="button"
          className={`mini-toggle${wrap === FlexWrap.Wrap ? ' on' : ''}`}
          title={t('det.flexWrapAria')}
          aria-pressed={wrap === FlexWrap.Wrap}
          onClick={() => write('Flex Wrap', [['wrap', wrap === FlexWrap.Wrap ? FlexWrap.NoWrap : FlexWrap.Wrap]])}
        >
          {t('det.flexWrap')}
        </button>
      </div>
    </div>
  );
}

// The nine pivot presets, as the fraction each grid cell writes. Columns are
// left/centre/right; rows read top→bottom while pivot Y runs bottom-up (0 = bottom),
// so row 0 is Y 1. Values a click can produce — every other pivot is "Custom".
const PIVOT_X = [0, 0.5, 1];
const PIVOT_Y = [1, 0.5, 0];

/** The pivot picker under Sprite.pivot: one click for the nine presets a sprite is
 *  almost always pivoted at, so the common case needs no arithmetic in either unit.
 *  The numeric row stays — pivot is continuous, and a preset is only a shortcut into
 *  it (as with UINode anchors, the fields remain the single source of truth). */
function PivotPicker({ entities, field }: { entities: EntityId[]; field: InspectorField }) {
  const [x, y] = (field.value as number[]) ?? [0.5, 0.5];
  const c = PIVOT_X.indexOf(x);
  const r = PIVOT_Y.indexOf(y);
  const preset = c >= 0 && r >= 0 && field.mixed !== true;
  const pick = (col: number, row: number) => {
    SceneCommands.beginGesture('Pivot');
    for (const id of entities) SceneCommands.setField(id, 'Sprite', 'pivot', 'vec2', [PIVOT_X[col], PIVOT_Y[row]]);
    SceneCommands.endGesture();
  };
  return (
    <div className="pivot-pick">
      <AlignGrid
        active={preset ? { c, r } : null}
        ariaLabel={t('det.pivotPresets')}
        cellTitle={(col, row) => `${ANCHOR_V_LABEL[row]} · ${ANCHOR_H_LABEL[col]}`}
        onPick={pick}
      />
      <em className="pivot-cur">
        {preset ? `${ANCHOR_V_LABEL[r]} · ${ANCHOR_H_LABEL[c]}` : t('det.anchorCustom')}
      </em>
    </div>
  );
}

// The inline Controllers strip — the panel's per-node authoring brought into the
// inspector so choosing a state page and gearing a field happen in ONE place (no
// cross-panel dance). Reuses the exact model readers + SceneCommands the Controllers
// panel uses; clicking a page chip switches the page (live edit-mode preview) AND arms
// that controller as the active one the field gear dots bind to. Resolves self →
// ancestor, so a geared leaf still shows (and switches) the root's controllers.
function ControllersInline({ entityId }: { entityId: EntityId }) {
  useSyncExternalStore(SceneStore.subscribe, SceneStore.getRevision);
  const collapseExplicit = useInspectorCollapse((s) => s.explicit);
  const toggleCollapse = useInspectorCollapse((s) => s.toggle);
  const collapsed = isSectionCollapsed(collapseExplicit, '__controllers');
  const activeController = useControllerStore((s) => s.activeController);
  const setActiveController = useControllerStore((s) => s.setActiveController);
  const recording = useControllerStore((s) => s.recording);
  const toggleRecording = useControllerStore((s) => s.toggleRecording);
  const [newCtrl, setNewCtrl] = useState('');

  const controllers = resolveControllers(entityId);
  const gears = readGearBindings(entityId);

  // Default the active controller to the first one resolvable here (matches the panel).
  useEffect(() => {
    if (controllers.length === 0) return;
    if (!activeController || !controllers.some((c) => c.ctrl.name === activeController)) {
      setActiveController(controllers[0]!.ctrl.name);
    }
  }, [controllers, activeController, setActiveController]);

  const hasInteraction = controllers.some((c) => c.ctrl.name === INTERACTION_CONTROLLER);
  const addController = () => {
    const name = newCtrl.trim();
    if (!name) return;
    SceneCommands.addController(entityId, name);
    setActiveController(name);
    setNewCtrl('');
  };
  const addInteraction = () => {
    SceneCommands.addController(entityId, INTERACTION_CONTROLLER, [...INTERACTION_PAGES]);
    setActiveController(INTERACTION_CONTROLLER);
  };

  return (
    <div className="ctrl-inline">
      <div
        className="ctrl-head ctrl-fold"
        role="button"
        tabIndex={0}
        onClick={() => toggleCollapse('__controllers')}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapse('__controllers'); } }}
      >
        <span className="ctrl-caret">{collapsed ? <ChevronRight size={12} strokeWidth={2.4} /> : <ChevronDown size={12} strokeWidth={2.4} />}</span>
        <span className="ctrl-title">{t('ctrl.title')}</span>
        <button type="button" className={`ctrl-rec${recording ? ' on' : ''}`} title={t('ctrl.recordTitle')} onClick={(e) => { e.stopPropagation(); toggleRecording(); }}>
          <Circle size={9} fill="currentColor" />
          {t('ctrl.record')}
        </button>
      </div>

      {!collapsed && (<>
      {controllers.length === 0 && <div className="ctrl-hint">{t('ctrl.hintAdd')}</div>}

      {controllers.length > 0 && (
        <div className="ctrl-list">
          {controllers.map((rc) => (
            <div
              key={`${rc.owner}:${rc.ctrl.name}`}
              className={`ctrl-row${rc.ctrl.name === activeController ? ' active' : ''}`}
              onClick={() => setActiveController(rc.ctrl.name)}
            >
              <div className="ctrl-row-head">
                <span className="ctrl-name">{rc.ctrl.name}</span>
                {rc.inherited && (
                  <span className="ctrl-owner" title={t('ctrl.inheritedFrom')}><CornerLeftUp size={10} />{rc.ownerName}</span>
                )}
                {rc.ctrl.name === activeController && <span className="ctrl-badge">{t('ctrl.active')}</span>}
              </div>
              <div className="ctrl-chips">
                {rc.ctrl.pages.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`ctrl-chip${p === rc.ctrl.current ? ' on' : ''}`}
                    title={t('ctrl.chipHint')}
                    onClick={(e) => { e.stopPropagation(); setActiveController(rc.ctrl.name); SceneCommands.setControllerPage(rc.owner, rc.ctrl.name, p); }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {gears.length > 0 && (
        <div className="ctrl-gears">
          <div className="ctrl-gears-title">{t('ctrl.gearsTitle')}</div>
          {gears.map((b) => (
            <div key={`${b.controller}:${b.component}.${b.property}`} className="ctrl-gear-row">
              <span className="ctrl-gear-field">{b.component}.{b.property}</span>
              <span className="ctrl-gear-meta">
                ← {b.controller} · {Object.keys(b.pages).length}{t('ctrl.gearPagesSuffix')}{b.tween ? ` · ${b.tween.duration}s` : ''}
              </span>
              <button type="button" className="ctrl-del" title={t('ctrl.gearUnbind')} onClick={() => SceneCommands.removeGearBinding(entityId, b.controller, b.component, b.property)}>
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="ctrl-add">
        <input
          className="ctrl-input sm"
          placeholder={t('ctrl.newController')}
          value={newCtrl}
          onChange={(e) => setNewCtrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addController(); }}
        />
        <button type="button" className="ctrl-btn sm" title={t('ctrl.addController')} onClick={addController}><Plus size={12} /></button>
        <button type="button" className="ctrl-btn sm" title={t('ctrl.addInteraction')} disabled={hasInteraction} onClick={addInteraction}><MousePointerClick size={12} /></button>
      </div>
      </>)}
    </div>
  );
}

// — The registry ——————————————————————————————————————————————————————————————

/**
 * Which inspector body a decorator may render in. `edit` is the Details panel over
 * the scene MODEL (source ids, undoable through SceneCommands); `play` is the live
 * Game inspector over the running realm (runtime ids, writes routed to the realm).
 */
export type InspectorSurface = 'edit' | 'play';

/** What a decorator is handed: the component, and every selected entity carrying it. */
export interface DecoratorContext {
  entities: EntityId[];
  comp: InspectorComponent;
  surface: InspectorSurface;
}

/** Extra UI one component type gets beyond the fields its registry entry declares. */
export interface ComponentDecorator {
  /** Namespaced, e.g. `core.uinode.layout` — the id the registry resolves on. */
  id: string;
  /** The component type this attaches to. */
  component: string;
  /** Surfaces it may render in. Default `['edit']` — see the file header. */
  surfaces?: readonly InspectorSurface[];
  /** Rendered inside the component's own section, below its field rows. */
  render?(ctx: DecoratorContext): ReactNode;
  /** Field keys `render` owns. The generic field flow skips them, so a value is
   *  never editable in two places at once. */
  ownedFields?(ctx: DecoratorContext): ReadonlySet<string> | undefined;
  /** A one-click affordance in the section header, or undefined when it does not
   *  apply to this selection (an orphaned UI element has one; a parented one does not). */
  action?(ctx: DecoratorContext): { label: string; title: string; run: () => void } | undefined;
}

/**
 * Extra UI for ONE FIELD, rendered directly under that field's row — the rung
 * between a component decorator (whole section) and an entity one (whole entity).
 * A preset picker belongs beside the numbers it writes, and a component decorator
 * cannot put it there: its block renders once, above every row in the section.
 */
export interface FieldDecorator {
  id: string;
  component: string;
  /** The field key this attaches under. */
  field: string;
  surfaces?: readonly InspectorSurface[];
  render(ctx: DecoratorContext & { field: InspectorField }): ReactNode;
}

/**
 * Extra UI for the ENTITY rather than one component, rendered above the sections.
 * A separate kind because its trigger is a predicate over the whole component set,
 * and it must appear once for an entity matching it twice.
 */
export interface EntityDecorator {
  id: string;
  surfaces?: readonly InspectorSurface[];
  /** Whether this entity gets the decoration, given the components it carries. */
  applies(componentNames: readonly string[]): boolean;
  render(ctx: { entity: EntityId; surface: InspectorSurface }): ReactNode;
}

const componentContrib = new ContributionRegistry<ComponentDecorator>('inspector component decorator');
const fieldContrib = new ContributionRegistry<FieldDecorator>('inspector field decorator');
const entityContrib = new ContributionRegistry<EntityDecorator>('inspector entity decorator');

const serves = (d: { surfaces?: readonly InspectorSurface[] }, surface: InspectorSurface): boolean =>
  (d.surfaces ?? ['edit']).includes(surface);

/** The editor's own component decorators. Registered under `'core'` like every
 *  other built-in contribution, so a plugin reads through the same door. */
const BUILTIN_COMPONENT_DECORATORS: ComponentDecorator[] = [
  {
    id: 'core.uinode.layout',
    component: 'UINode',
    render: ({ entities, comp }) => <UILayoutControl entities={entities} comp={comp} />,
    ownedFields: ({ comp }) =>
      uiLayoutOwnedFields(
        Number(comp.fields.find((f) => f.key === 'position')?.value ?? 0) === UIPositionType.Absolute,
      ),
    action: ({ entities, comp }) => uiNodeCanvasAction(entities, comp),
  },
  {
    id: 'core.flexcontainer.layout',
    component: 'FlexContainer',
    render: ({ entities, comp }) => <FlexLayoutControl entities={entities} comp={comp} />,
    ownedFields: () => FLEX_WIDGET_OWNED_FIELDS,
  },
  {
    // Edit-only: it creates a Canvas and reparents through SceneCommands.
    id: 'core.text.layout-box',
    component: 'Text',
    action: ({ entities, comp }) => (entities.length === 1 ? textBoxAction(comp, entities[0]!) : undefined),
  },
  // One per convertible collider: the switch converts the component itself.
  ...Object.keys(COMP_COLLIDER_SHAPE).map((component): ComponentDecorator => ({
    id: `core.collider.shape.${component}`,
    component,
    render: ({ entities }) => <ColliderShapeControl entities={entities} current={component} />,
  })),
];

const BUILTIN_FIELD_DECORATORS: FieldDecorator[] = [
  {
    id: 'core.sprite.pivot',
    component: 'Sprite',
    field: 'pivot',
    render: ({ entities, field }) => <PivotPicker entities={entities} field={field} />,
  },
];

const BUILTIN_ENTITY_DECORATORS: EntityDecorator[] = [
  {
    id: 'core.ui.controllers',
    applies: (names) => names.includes('UINode') || names.includes('Canvas'),
    render: ({ entity }) => <ControllersInline entityId={entity} />,
  },
];

componentContrib.registerAll('core', BUILTIN_COMPONENT_DECORATORS);
fieldContrib.registerAll('core', BUILTIN_FIELD_DECORATORS);
entityContrib.registerAll('core', BUILTIN_ENTITY_DECORATORS);

export const decoratorRegistry = {
  registerComponent: (owner: Owner, d: ComponentDecorator): Disposable => componentContrib.register(owner, d),
  registerField: (owner: Owner, d: FieldDecorator): Disposable => fieldContrib.register(owner, d),
  registerEntity: (owner: Owner, d: EntityDecorator): Disposable => entityContrib.register(owner, d),
  disposeOwner: (owner: Owner): void => {
    componentContrib.disposeOwner(owner);
    fieldContrib.disposeOwner(owner);
    entityContrib.disposeOwner(owner);
  },
  subscribe: (fn: () => void): (() => void) => {
    const a = componentContrib.subscribe(fn);
    const b = fieldContrib.subscribe(fn);
    const c = entityContrib.subscribe(fn);
    return () => { a(); b(); c(); };
  },
  getRevision: (): number =>
    componentContrib.getRevision() + fieldContrib.getRevision() + entityContrib.getRevision(),
};

/** Decorators attached to one component type on this surface. */
export function componentDecorators(component: string, surface: InspectorSurface): ComponentDecorator[] {
  return componentContrib.all().filter((d) => d.component === component && serves(d, surface));
}

/** Entity-level decorators that apply to an entity carrying `componentNames`. */
export function entityDecorators(componentNames: readonly string[], surface: InspectorSurface): EntityDecorator[] {
  return entityContrib.all().filter((d) => serves(d, surface) && d.applies(componentNames));
}

/**
 * The rendered extra block for a component section, or undefined when none applies.
 *
 * Fragments, not wrapper elements: decorator bodies are block-level and the section
 * lays them out as its own children, so an element in between collapses them.
 */
export function decoratorExtra(ctx: DecoratorContext): ReactNode | undefined {
  const parts = componentDecorators(ctx.comp.name, ctx.surface).filter((d) => d.render);
  if (!parts.length) return undefined;
  return <>{parts.map((d) => <Fragment key={d.id}>{d.render!(ctx)}</Fragment>)}</>;
}

/** The rendered block that sits under one field's row, or undefined when none applies. */
export function decoratorFieldExtra(ctx: DecoratorContext & { field: InspectorField }): ReactNode | undefined {
  const parts = fieldContrib.all().filter(
    (d) => d.component === ctx.comp.name && d.field === ctx.field.key && serves(d, ctx.surface),
  );
  if (!parts.length) return undefined;
  return <>{parts.map((d) => <Fragment key={d.id}>{d.render(ctx)}</Fragment>)}</>;
}

/** Every field key claimed by this component's decorators, or undefined when none is. */
export function decoratorOwnedFields(ctx: DecoratorContext): ReadonlySet<string> | undefined {
  const keys = new Set<string>();
  for (const d of componentDecorators(ctx.comp.name, ctx.surface))
    for (const k of d.ownedFields?.(ctx) ?? []) keys.add(k);
  return keys.size ? keys : undefined;
}

/** The header action for a component section. First registered wins, matching the
 *  registry's own conflict rule — core registers at module load, so a plugin cannot
 *  displace a built-in affordance. */
export function decoratorAction(ctx: DecoratorContext): { label: string; title: string; run: () => void } | undefined {
  for (const d of componentDecorators(ctx.comp.name, ctx.surface)) {
    const a = d.action?.(ctx);
    if (a) return a;
  }
  return undefined;
}

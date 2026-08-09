// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import {
  AlertTriangle,
  Box,
  Camera,
  Check,
  ChevronRight,
  Code2,
  Cog,
  Component as ComponentIcon,
  Copy,
  ClipboardPaste,
  Filter,
  HelpCircle,
  FolderOpen,
  Globe,
  Monitor,
  MessageSquare,
  Play,
  Smartphone,
  Apple,
  Image as ImageIcon,
  MoreHorizontal,
  Move3d,
  Package,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Square,
  SquarePen,
  Trash2,
  Upload,
  Volume2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AssetIcon } from '@/components/icons';
import { EventBindingSection } from '@/events/EventBindingSection';
import { AudioWavePreview } from '@/components/AudioWavePreview';
import { NineSliceEditor } from '@/components/NineSliceEditor';
import { fsRefresh } from '@/project/fsRefresh';
import { Toasts } from '@/store/Toasts';
import { baseName, IMAGE_RE } from '@/project/assetMeta';
import { BUILTIN_PLATFORMS, type BuiltinPlatform } from '@/project/platforms';
import { formatBytes } from '@/project/sizeBudget';
import { useSelection } from '@/store/selectionStore';
import { usePrefabConflicts } from '@/store/prefabConflicts';
import { useEditorStore } from '@/store/editorStore';
import { useControllerStore } from '@/store/controllerStore';
import { useInspectorCollapse, isSectionCollapsed } from '@/store/inspectorCollapse';
import { controllerCurrentPage, drivenField, readComponentData, readModelField, readGearBindings } from '@/controller/controllerModel';
import { useOutliner } from '@/outliner/OutlinerController';
import { isFolderUnder, folderName } from '@/outliner/folders';
import { EngineHost } from '@/engine/EngineHost';
import { SceneStore } from '@/engine/SceneStore';
import { SceneQuery, buildEntityInfo, buildInspector } from '@/engine/SceneQuery';
import { SceneModel } from '@/engine/SceneModel';
import { InspectorClipboard } from '@/engine/inspectorClipboard';
import { SceneCommands, toModelValue } from '@/engine/SceneCommands';
import { PlayInspect } from '@/engine/PlayInspect';
import { parseLocaleTable, EasingType, BUILTIN_SHADER_TEMPLATES } from 'esengine';
import type { SceneData, InputMapAsset, ActionType, Binding, LocaleTableAsset, PluralCategory, GearValue, GearTween, MaterialAssetData } from 'esengine';
import { modelAddableComponentEntries, subscribeSchemas, getSchemaRevision, boxGroupsFor, isRequiredEmpty, inspectorFields, type BoxGroupDef } from '@/engine/schema';
import { inspectorRegistry, buildContributedSection, isInfoRow } from '@/plugins/inspector';
import { localizePlugin } from '@/plugins/localize';
import type { AssetInspectorContribution, ComponentInspectorContribution } from '@/plugins/types';
import * as imap from '@/project/inputMapDoc';
import * as ldoc from '@/project/localeTableDoc';
import { buildImporterComponent, applyImporterEdit, readTextureCookSettings } from '@/project/assetImporter';
import { findAssetUsages } from '@/project/assetUsages';
import { FindUsagesDialog } from '@/components/FindUsagesDialog';
import { ProjectStore } from '@/project/ProjectStore';
import { AssetRegistry } from '@/project/AssetRegistry';
import { confirmDiscard, confirmDiscardDoc } from '@/project/discardGuard';
import { t, editorLocale } from '@/i18n';
import { componentDocUrl } from '@/engine/componentDocUrl';
import { MaterialDocument } from '@/material/MaterialDocument';
import { DirtyRegistry } from '@/document/DirtyRegistry';
import {
  isMaterialAsset,
  resolveMaterialContext,
  buildMaterialComponents,
  makeMaterialWrite,
  projectMaterialToHandle,
  renderMaterialThumbnail,
  shaderProjectPathOf,
  shaderRelRef,
  BUILTIN_SHADER_PREFIX,
  type MaterialContext,
} from '@/material/materialInspectorModel';
import { convertShaderToUnique } from '@/material/openMaterial';
import { AnimClipDocument } from '@/flipbook/AnimClipDocument';
import { buildAnimClipComponents, makeAnimClipWrite } from '@/flipbook/animClipInspectorModel';
import { ColorControl } from '@/components/ColorControl';
import { IconButton } from '@/components/IconButton';
import { EmptyState } from '@/components/EmptyState';
import { ContextMenu } from '@/components/Menu';
import { NumField, useScrub } from '@/components/NumField';
import { Popover, usePopover } from '@/components/Popover';
import { SearchField } from '@/components/SearchField';
import { Select } from '@/components/Select';
import { Segmented } from '@/components/Segmented';
import { AddComponentMenu } from '@/components/AddComponentMenu';
import type { InspectorComponent, InspectorField, InspectorFieldValue, EntityId, NodeKind, GradientValue, CurveValue, DimensionValue, MapValue, InspectSource, FieldWrite } from '@/types';


// Field-value equality for the "modified" (override) mark. Vectors compare
// element-wise; numbers tolerate float drift so a no-op edit doesn't read as one.
function fieldEqual(a: InspectorFieldValue, b: InspectorFieldValue): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((n, i) => Math.abs(n - (b[i] as number)) < 1e-6);
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  return a === b;
}

/** The union of components addable to ANY entity in a multi-selection — a component
 *  is offered if at least one selected entity lacks it (Add applies per-entity). */
function unionAddableComponents(ids: readonly number[]): ReturnType<typeof modelAddableComponentEntries> {
  const byName = new Map<string, ReturnType<typeof modelAddableComponentEntries>[number]>();
  for (const id of ids) {
    const e = SceneModel.entityBySource(id);
    if (!e) continue;
    for (const entry of modelAddableComponentEntries(e)) if (!byName.has(entry.name)) byName.set(entry.name, entry);
  }
  return [...byName.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Whether a field differs from its reset target (prefab base, else class default). */
function isModified(f: InspectorField): boolean {
  return f.defaultValue !== undefined && !fieldEqual(f.value, f.defaultValue);
}

// Component domain → header glyph, derived from the component name (the engine
// exposes no category metadata). The icon hue is neutral by design — set in CSS.
function componentIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (/transform/.test(n)) return Move3d;
  if (/camera/.test(n)) return Camera;
  if (/sprite|render|mesh|image|text|spine/.test(n)) return ImageIcon;
  if (/rigidbody|physics|body/.test(n)) return Box;
  if (/collider|collision/.test(n)) return Square;
  if (/audio|sound/.test(n)) return Volume2;
  if (/script|controller|behaviour|behavior|\bai\b|logic/.test(n)) return Code2;
  return ComponentIcon;
}

const KIND_LABEL: Record<NodeKind, string> = {
  camera: t('det.kindCamera'),
  sprite: t('det.kindSprite'),
  skeletal: t('det.kindSkeletal'),
  physics: t('det.kindPhysics'),
  ui: t('det.kindUi'),
  audio: t('det.kindAudio'),
  group: t('det.kindGroup'),
  light: t('det.kindLight'),
  empty: t('det.kindEntity'),
};

import {
  VecControl, SidesControl, EnumControl, EntityControl, FlagsControl, SliderControl, BoolControl, DimControl, StringControl, MapControl, GradientControl, CurveControl, AssetControl,
} from './inspector/controls';
import { decoratorAction, decoratorExtra, decoratorOwnedFields, entityDecorators } from './inspector/componentDecorators';

// A field write override (the live "Game" inspector routes edits to the realm
// instead of the undoable SceneCommands path). When set, gestures are no-ops.
// The contract itself lives in types.ts — controls outside this panel (the
// 9-slice editor) write through the same one.

// The write primitives for one field, shared by FieldRow and the compound
// BoxSidesControl so both commit through the identical door: an edit fans out to
// every selected entity (the open gesture coalesces them into one undo step) and
// clamps to the field's range; the live "Game" inspector routes to the realm
// instead, where gestures are no-ops.
function fieldWriter(entities: EntityId[], comp: string, field: InspectorField, write?: FieldWrite) {
  const ranged = field.min != null || field.max != null;
  const apply = (value: number | boolean | string | number[] | GradientValue | CurveValue | DimensionValue | MapValue) => {
    let v = value;
    if (ranged && typeof v === 'number') {
      if (field.min != null) v = Math.max(field.min, v);
      if (field.max != null) v = Math.min(field.max, v);
    }
    if (write) return write(field.key, field.type, v);
    for (const e of entities) SceneCommands.setField(e, comp, field.key, field.type, v as never);
  };
  const begin = () => (write ? undefined : SceneCommands.beginGesture(`Edit ${field.label}`));
  const end = () => (write ? undefined : SceneCommands.endGesture());
  // Escape: abort the gesture so each entity reverts to its own captured value.
  // Asset-editor writes (no scene gesture) have nothing to abort.
  const cancel = () => (write ? undefined : SceneCommands.abortGesture());
  return { apply, begin, end, cancel };
}

// Curated page-change easings for the gear popover, name → EasingType value.
const GEAR_EASINGS = [
  'Linear', 'EaseOutQuad', 'EaseInOutQuad', 'EaseOutCubic',
  'EaseInOutCubic', 'EaseOutBack', 'EaseOutElastic', 'EaseOutBounce',
] as const;
type GearEasingName = (typeof GEAR_EASINGS)[number];

/**
 * Settings for one bound gear: page-change transition (duration 0 = snap, else
 * duration + easing tween) and the unbind action — opened from a bound gear dot
 * so unbinding is a deliberate second step, not a destructive dot toggle.
 */
function GearPopover({ anchor, onClose, entity, controller, component, property }: {
  anchor: DOMRect;
  onClose: () => void;
  entity: EntityId;
  controller: string;
  component: string;
  property: string;
}) {
  useSyncExternalStore(SceneStore.subscribe, SceneStore.getRevision);
  const binding = readGearBindings(entity).find(
    (b) => b.controller === controller && b.component === component && b.property === property);
  const tween = binding?.tween;
  const duration = tween?.duration ?? 0;
  const [durText, setDurText] = useState(String(duration));

  if (!binding) return null;

  const setTween = (next?: GearTween) =>
    SceneCommands.setGearTween(entity, controller, component, property, next);
  const commitDuration = () => {
    const d = Math.max(0, parseFloat(durText) || 0);
    setDurText(String(d));
    if (d === duration) return;
    setTween(d > 0 ? { easing: tween?.easing ?? EasingType.EaseOutQuad, duration: d } : undefined);
  };
  const easingName: GearEasingName =
    GEAR_EASINGS.find((n) => EasingType[n] === (tween?.easing ?? EasingType.Linear)) ?? 'Linear';

  return (
    <Popover anchor={anchor} width={210} onClose={onClose} className="gear-pop">
      <div className="gear-pop-title">{controller} · {component}.{property}</div>
      <div className="gear-pop-row">
        <span className="gear-pop-label">{t('ctrl.gearDuration')}</span>
        <input
          type="number"
          className="gear-pop-num"
          min={0}
          step={0.05}
          value={durText}
          onChange={(e) => setDurText(e.target.value)}
          onBlur={commitDuration}
          onKeyDown={(e) => { if (e.key === 'Enter') commitDuration(); }}
        />
      </div>
      <div className="gear-pop-row">
        <span className="gear-pop-label">{t('ctrl.gearEasing')}</span>
        <Select<GearEasingName>
          value={easingName}
          options={GEAR_EASINGS.map((n) => ({ value: n }))}
          onChange={(n) => setTween({ easing: EasingType[n], duration: duration > 0 ? duration : 0.15 })}
          className="gear-pop-select"
          ariaLabel={t('ctrl.gearEasing')}
        />
      </div>
      <button
        type="button"
        className="gear-pop-remove"
        onClick={() => {
          SceneCommands.removeGearBinding(entity, controller, component, property);
          onClose();
        }}
      >
        {t('ctrl.gearUnbind')}
      </button>
    </Popover>
  );
}

/**
 * Gear dot for one (component, field) — only for a single authored entity that
 * resolves the active controller. Clicking an unbound dot binds the field
 * (seeding the current page with its value); clicking a bound dot opens the gear
 * popover (transition tween + unbind) instead of destructively toggling. While
 * recording, bound dots go red — "edits here land in the current page". Returns
 * the rendered dot (+ popover) or null, so both FieldRow and the component
 * header's promoted enable-checkbox share one implementation.
 */
function useGearDot(entities: EntityId[], comp: string, key: string, write?: FieldWrite): ReactNode {
  const activeController = useControllerStore((s) => s.activeController);
  const recording = useControllerStore((s) => s.recording);
  const gearPop = usePopover();
  const gearEntity = entities[0];
  const single = entities.length === 1 && !write;

  // A DRIVEN field always shows its dot, whatever the strip has selected: being
  // driven is a fact about the scene, and hiding the only sign of it is what let a
  // driven field pass for an ordinary one — you could edit it and watch nothing
  // happen. The strip still decides where a NEW binding would go, so the
  // bind-on-click affordance keeps needing an active controller.
  const driven = single ? drivenField(gearEntity, comp, key) : null;
  const gearPage = single && activeController != null
    ? controllerCurrentPage(gearEntity, activeController)
    : null;
  const bindable = gearPage != null && activeController != null;
  if (!driven && !bindable) return null;

  const controller = driven?.controller ?? activeController!;
  const geared = driven != null;

  const onGearClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (geared) {
      gearPop.open(e.currentTarget);
    } else {
      const value = readModelField(gearEntity, comp, key);
      if (value === undefined || activeController == null || gearPage == null) return;
      SceneCommands.addGearBinding(gearEntity, {
        controller: activeController,
        component: comp,
        property: key,
        pages: { [gearPage]: value as GearValue },
      });
    }
  };

  // Naming the page is the whole point of the title: "driven, and by which state"
  // is what turns a surprise into an explanation.
  const title = geared
    ? (driven!.page != null
        ? t('ctrl.gearDrivenBy', { controller: driven!.controller, page: driven!.page })
        : t('ctrl.gearSettings'))
    : t('ctrl.gearBind');

  return (
    <>
      <button
        type="button"
        className={`prop-gear${geared ? ' on' : ''}${geared && recording ? ' rec' : ''}`}
        tabIndex={-1}
        title={title}
        onClick={onGearClick}
      >
        <Cog size={11} strokeWidth={2} />
      </button>
      {gearPop.anchor && (
        <GearPopover
          anchor={gearPop.anchor}
          onClose={gearPop.close}
          entity={gearEntity}
          controller={controller}
          component={comp}
          property={key}
        />
      )}
    </>
  );
}

/**
 * Swap in the value a gear will actually apply.
 *
 * A driven field's own component value is dead — gear-apply overwrites it from the
 * current page — so showing it means showing a number that has no effect on
 * anything. Reads through the SAME `inspectorFields` conversion the row was built
 * with (by patching the page value into a copy of the component data) rather than
 * re-deriving colour/vector shapes here, so the two can never disagree.
 *
 * Kept in this panel because buildInspector is a pure model reader with no business
 * knowing about controllers — and this panel already renders the gear dot.
 */
function drivenFieldValue(
  entities: EntityId[],
  comp: string,
  field: InspectorField,
  write?: FieldWrite,
): InspectorField {
  if (entities.length !== 1 || write) return field;
  const driven = drivenField(entities[0], comp, field.key);
  if (!driven || driven.pageValue === undefined) return field;
  const data = readComponentData(entities[0], comp);
  if (!data) return field;
  const patched = inspectorFields(comp, { ...data, [field.key]: driven.pageValue })
    .find((f) => f.key === field.key);
  return patched ? { ...field, value: patched.value } : field;
}

function FieldRow({ entities, comp, field: rawField, write }: { entities: EntityId[]; comp: string; field: InspectorField; write?: FieldWrite }) {
  const field = drivenFieldValue(entities, comp, rawField, write);
  const mixed = field.mixed === true;
  const { apply, begin, end, cancel } = fieldWriter(entities, comp, field, write);
  const gearDot = useGearDot(entities, comp, field.key, write);

  // Plain numbers + angles scrub from the label; vectors from their axis tabs; a
  // slider owns its own drag so its label stays inert.
  const isScalar = (field.type === 'number' && !field.slider) || field.type === 'angle';
  const labelScrub = useScrub(isScalar ? (field.value as number) : 0, apply, {
    onBegin: begin,
    onEnd: end,
    step: field.step,
    min: field.min,
    max: field.max,
  });

  // A fixed set of string choices declared on the field itself (an importer's
  // compression format). Choices that depend on the scene — a spine animation, a
  // dragonBones armature, an i18n key — are an `enum` with name-valued options
  // (see setEnumSource) and render through EnumControl like every other dropdown.
  const selectOpts =
    !mixed && field.type === 'select' ? (field.selectOptions ?? []).map((o) => ({ value: o })) : null;
  let control;
  if (selectOpts) {
    const cur = String(field.value);
    control = (
      <span className="field dropdown">
        <Select
          variant="field"
          value={cur}
          ariaLabel={field.key}
          options={[
            ...(selectOpts.some((o) => o.value === cur) ? [] : [{ value: cur, label: cur || t('det.noneOption') }]),
            ...selectOpts,
          ]}
          onChange={(v) => {
            begin();
            apply(v);
            end();
          }}
        />
      </span>
    );
  } else
  switch (field.type) {
    case 'number':
      control =
        field.slider && field.min != null && field.max != null ? (
          <SliderControl
            value={field.value as number}
            min={field.min}
            max={field.max}
            step={field.step}
            unit={field.unit}
            mixed={mixed}
            onBegin={begin}
            onEnd={end}
            onChange={apply}
          />
        ) : (
          <NumField value={field.value as number} suffix={field.unit} mixed={mixed} step={field.step} min={field.min} max={field.max} onBegin={begin} onEnd={end} onCancel={cancel} onCommit={apply} />
        );
      break;
    case 'angle':
      control = <NumField value={field.value as number} suffix="°" mixed={mixed} step={field.step} onBegin={begin} onEnd={end} onCancel={cancel} onCommit={apply} />;
      break;
    case 'vec2':
    case 'vec3':
    case 'vec4':
      control = <VecControl value={field.value as number[]} mixed={mixed} mixedAxes={field.mixedAxes} onBegin={begin} onEnd={end} onCancel={cancel} onChange={apply} />;
      break;
    case 'dimension':
      control = <DimControl value={field.value as DimensionValue} mixed={mixed} onBegin={begin} onEnd={end} onChange={apply} />;
      break;
    case 'sides':
      control = <SidesControl value={field.value as number[]} mixed={mixed} onBegin={begin} onEnd={end} onCancel={cancel} onChange={apply} />;
      break;
    case 'bool':
      control = <BoolControl value={field.value as boolean} mixed={mixed} onBegin={begin} onEnd={end} onChange={apply} />;
      break;
    case 'enum':
      control = (
        <EnumControl
          value={field.value as string | number}
          options={field.options ?? []}
          open={field.open}
          mixed={mixed}
          onBegin={begin}
          onEnd={end}
          onChange={apply}
        />
      );
      break;
    case 'flags':
      control = (
        <FlagsControl
          value={field.value as number}
          options={field.options ?? []}
          mixed={mixed}
          onBegin={begin}
          onEnd={end}
          onChange={apply}
        />
      );
      break;
    case 'entity':
      control = <EntityControl value={field.value as number} mixed={mixed} onBegin={begin} onEnd={end} onChange={apply} />;
      break;
    case 'color':
      control = <ColorControl value={field.value as string} mixed={mixed} onBegin={begin} onEnd={end} onChange={apply} />;
      break;
    case 'gradient':
      control = <GradientControl value={field.value as GradientValue} onBegin={begin} onEnd={end} onChange={apply} />;
      break;
    case 'curve':
      control = <CurveControl value={field.value as CurveValue} onBegin={begin} onEnd={end} onChange={apply} />;
      break;
    case 'map':
      control = <MapControl value={field.value as MapValue} onBegin={begin} onEnd={end} onChange={apply} />;
      break;
    case 'asset':
      control = (
        <AssetControl
          value={field.value as string | number}
          assetType={field.assetType}
          mixed={mixed}
          readOnly={!!write}
          onBegin={begin}
          onEnd={end}
          onChange={apply}
        />
      );
      break;
    default:
      control = <StringControl value={String(field.value)} mixed={mixed} onBegin={begin} onEnd={end} onCancel={cancel} onChange={apply} />;
  }

  const modified = !mixed && isModified(field);
  const reset = () => {
    if (field.defaultValue === undefined) return;
    begin();
    apply(field.defaultValue);
    end();
  };

  // Right-click a property → Copy / Paste its value (the live "Game" inspector has no
  // undoable write door, so it's disabled there).
  const [fctx, setFctx] = useState<{ x: number; y: number } | null>(null);
  const pasteValue = InspectorClipboard.fieldValue(field.type);
  const doPaste = () => {
    if (pasteValue == null) return;
    begin();
    apply(pasteValue as never);
    end();
  };

  // A required field left empty (no asset / blank string) — flagged, not blocked
  // (soft). ONE predicate with the surface's getDiagnostics sweep, so automation
  // gates on exactly what this red flag shows.
  const invalid = !!field.required && isRequiredEmpty(field.value);

  return (
    <div
      className={`prop${modified ? ' modified' : ''}${mixed ? ' mixed' : ''}${invalid ? ' invalid' : ''}`}
      onContextMenu={
        write
          ? undefined
          : (e) => {
              e.preventDefault();
              e.stopPropagation();
              setFctx({ x: e.clientX, y: e.clientY });
            }
      }
    >
      <span
        className={`prop-label${isScalar ? ' scrub' : ''}`}
        title={field.tooltip}
        {...(isScalar ? labelScrub : {})}
      >
        {field.label}
      </span>
      <div className="prop-value">
        {control}
        {gearDot}
      </div>
      <button
        type="button"
        className={`prop-reset${modified ? ' show' : ''}`}
        tabIndex={-1}
        title={t('det.resetToDefault')}
        onClick={modified ? reset : undefined}
      >
        <RotateCcw size={11} strokeWidth={2} />
      </button>
      {fctx && (
        <ContextMenu
          x={fctx.x}
          y={fctx.y}
          onClose={() => setFctx(null)}
          items={[
            {
              label: t('det.copy'),
              icon: <Copy size={13} strokeWidth={1.9} />,
              disabled: mixed,
              onClick: () => InspectorClipboard.copyField(comp, field.key, field.type, field.value),
            },
            {
              label: t('det.paste'),
              icon: <ClipboardPaste size={13} strokeWidth={1.9} />,
              disabled: pasteValue == null,
              onClick: doPaste,
            },
            {
              label: t('det.resetToDefault'),
              icon: <RotateCcw size={13} strokeWidth={1.9} />,
              disabled: !modified,
              onClick: reset,
            },
          ]}
        />
      )}
    </div>
  );
}

// A collapsible sub-section inside a component (a property category, or Advanced).
// Children stay mounted so the grid-rows height transition animates both ways.
function Fold({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className={`subfold${open ? ' open' : ''}`} onClick={onToggle}>
        <ChevronRight size={9} strokeWidth={3} />
        {label}
      </div>
      <div className="subbody">
        <div>{children}</div>
      </div>
    </>
  );
}

const ADVANCED_FOLD = '__advanced__';

/** Give a boxless Text a UI layout box: ensure a Canvas (create one if the scene has
 *  none), then add a sized UINode + reparent under it so align/verticalAlign resolve
 *  within a box instead of anchoring to the origin. */

// One side of a box-model group: a lettered edge (L/R/T/B) + its Dimension well.
// It commits through `fieldWriter` — the same door as FieldRow — so undo, mixed,
// and reset behave identically; right-click keeps the per-field Copy/Paste/Reset.
function BoxSide({
  entities,
  comp,
  field,
  write,
  abbr,
}: {
  entities: EntityId[];
  comp: string;
  field: InspectorField;
  write?: FieldWrite;
  abbr: string;
}) {
  const mixed = field.mixed === true;
  const modified = !mixed && isModified(field);
  const { apply, begin, end } = fieldWriter(entities, comp, field, write);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const pasteValue = InspectorClipboard.fieldValue(field.type);
  const reset = () => {
    if (field.defaultValue === undefined) return;
    begin();
    apply(field.defaultValue);
    end();
  };
  return (
    <label
      className={`box-side${modified ? ' modified' : ''}${mixed ? ' mixed' : ''}`}
      title={field.tooltip ?? field.label}
      onContextMenu={
        write
          ? undefined
          : (e) => {
              e.preventDefault();
              e.stopPropagation();
              setCtx({ x: e.clientX, y: e.clientY });
            }
      }
    >
      <span className="box-side-k">{abbr}</span>
      <DimControl value={field.value as DimensionValue} mixed={mixed} onBegin={begin} onEnd={end} onChange={apply} />
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          onClose={() => setCtx(null)}
          items={[
            { label: t('det.copy'), icon: <Copy size={13} strokeWidth={1.9} />, disabled: mixed, onClick: () => InspectorClipboard.copyField(comp, field.key, field.type, field.value) },
            { label: t('det.paste'), icon: <ClipboardPaste size={13} strokeWidth={1.9} />, disabled: pasteValue == null, onClick: () => { if (pasteValue == null) return; begin(); apply(pasteValue as never); end(); } },
            { label: t('ui.reset'), icon: <RotateCcw size={13} strokeWidth={1.9} />, disabled: !modified, onClick: reset },
          ]}
        />
      )}
    </label>
  );
}

/** A four-edge box (margin / offsets) as one spatial card: L·R on the top row,
 *  T·B below, each a full Dimension well — a compact, scannable stand-in for four
 *  near-identical property rows. Every side still writes through the shared field
 *  door, so it stays part of the reflected inspector, not a fork of it. */
function BoxSidesControl({
  entities,
  comp,
  write,
  group,
  fields,
}: {
  entities: EntityId[];
  comp: string;
  write?: FieldWrite;
  group: BoxGroupDef;
  fields: InspectorField[];
}) {
  const byKey = (key: string) => fields.find((f) => f.key === key);
  const sides: [string, string][] = [
    ['L', group.left],
    ['R', group.right],
    ['T', group.top],
    ['B', group.bottom],
  ];
  return (
    <div className="box-sides">
      <span className="box-caption">{group.label}</span>
      <div className="box-grid">
        {sides.map(([abbr, key]) => {
          const field = byKey(key);
          return field ? <BoxSide key={key} entities={entities} comp={comp} field={field} write={write} abbr={abbr} /> : null;
        })}
      </div>
    </div>
  );
}

/**
 * Sections a plugin contributed for one component type (or one asset type), rendered
 * through the SAME ComponentSection as everything else — so a contributed section is
 * native by construction rather than by imitation.
 *
 * Single-entity only for the component case: multi-selection has real semantics here
 * (mixed values, fan-out writes) that a plugin's `build(entity)` cannot express, and
 * inventing an answer would be worse than not offering one.
 */
function ContributedSections({ target }: { target: { entity: EntityId } | { component: string; path: string } }) {
  // Re-render when the section set changes (plugin load/unload) — and on the host's
  // own revision, since a section's rows are rebuilt from live data each render.
  useSyncExternalStore(inspectorRegistry.subscribe, inspectorRegistry.getRevision);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const sections =
    'entity' in target
      ? SceneModel.entityBySource(target.entity)?.components.flatMap((c) => inspectorRegistry.forComponent(c.type)) ?? []
      : inspectorRegistry.forAssetType(target.component);

  return (
    <>
      {sections.map((section) => {
        const built =
          section.kind === 'component' && 'entity' in target
            ? buildContributedSection(section, (v) => localizePlugin(v), (ui) => section.build(target.entity, ui))
            : section.kind === 'asset' && 'path' in target
              ? buildContributedSection(section, (v) => localizePlugin(v), (ui) => section.build(target.path, ui))
              : null;
        if (!built) return null;
        const action = section.action
          ? {
              label: localizePlugin(section.action.label),
              title: localizePlugin(section.action.label),
              run: () =>
                'entity' in target
                  ? (section as ComponentInspectorContribution).action!.run(target.entity)
                  : (section as AssetInspectorContribution).action!.run(target.path),
            }
          : undefined;
        return (
          <ComponentSection
            key={section.id}
            entities={[]}
            comp={built}
            collapsed={collapsed[section.id] ?? false}
            onToggle={() => setCollapsed((s) => ({ ...s, [section.id]: !(s[section.id] ?? false) }))}
            action={action}
            write={
              section.write
                ? (key, _type, value) => {
                    if (isInfoRow(key)) return; // a read-only row was never writable
                    if ('entity' in target) (section as ComponentInspectorContribution).write!(target.entity, key, value as never);
                    else (section as AssetInspectorContribution).write!(target.path, key, value as never);
                  }
                : undefined
            }
          />
        );
      })}
    </>
  );
}

function ComponentSection({
  entities,
  comp,
  collapsed,
  onToggle,
  onMore,
  write,
  action,
  extra,
  hideFields,
}: {
  entities: EntityId[];
  comp: InspectorComponent;
  collapsed: boolean;
  onToggle: () => void;
  onMore?: (e: React.MouseEvent, name: string) => void;
  write?: FieldWrite;
  action?: { label: string; title: string; run: () => void };
  extra?: React.ReactNode;
  /** Field keys the `extra` block owns (e.g. UINode's Layout section), skipped by
   *  the generic field flow so they aren't edited in two places. */
  hideFields?: ReadonlySet<string>;
}) {
  const Icon = componentIcon(comp.name);
  const docUrl = componentDocUrl(comp.name, editorLocale);
  const overridden = comp.fields.some(isModified);
  // Categories default open, the Advanced fold defaults closed.
  const [openFolds, setOpenFolds] = useState<Record<string, boolean>>({});
  const isOpen = (name: string) => openFolds[name] ?? name !== ADVANCED_FOLD;
  const toggleFold = (name: string) => setOpenFolds((s) => ({ ...s, [name]: !isOpen(name) }));

  // Edge fields that fold into a spatial box (margin/offsets) are pulled out of the
  // normal flow and rendered as a compound card below the plain rows — but only
  // when all four sides are present in the reflection.
  const boxGroups = boxGroupsFor(comp.name).filter(
    (g) =>
      [g.left, g.right, g.top, g.bottom].every((k) => comp.fields.some((f) => f.key === k)) &&
      // A box card the extra block owns (all four sides hidden) drops out entirely.
      ![g.left, g.right, g.top, g.bottom].every((k) => hideFields?.has(k)),
  );
  const boxKeys = new Set(boxGroups.flatMap((g) => [g.left, g.right, g.top, g.bottom]));

  // Bucket fields: a box side is claimed by its card; else a category wins (grouped
  // under its header); else advanced (the Advanced fold); else ungrouped at the top.
  const ungrouped: InspectorField[] = [];
  const advancedFields: InspectorField[] = [];
  const groups = new Map<string, InspectorField[]>();
  for (const f of comp.fields) {
    if (hideFields?.has(f.key)) continue; // owned by the extra block (UINode Layout)
    if (boxKeys.has(f.key)) continue;
    if (f.category) (groups.get(f.category) ?? groups.set(f.category, []).get(f.category)!).push(f);
    else if (f.advanced) advancedFields.push(f);
    else ungrouped.push(f);
  }
  const row = (f: InspectorField) => <FieldRow key={f.key} entities={entities} comp={comp.name} field={f} write={write} />;
  const enable = comp.enable;
  // The promoted enable field is hidden from the body, so it gets its gear dot
  // here — page-driven show/hide is the most common boolean gear.
  const enableGear = useGearDot(entities, comp.name, enable?.key ?? 'enabled', write);
  const on = !enable || enable.value;
  // The header checkbox toggles the component's enable field across the whole
  // selection (one undo step), or is a static "always on" for components that
  // can't be disabled (e.g. Transform). From a mixed state, the first click enables all.
  const toggleEnable = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!enable) return;
    const next = enable.mixed ? true : !enable.value;
    if (write) {
      write(enable.key, 'bool', next);
      return;
    }
    SceneCommands.beginGesture(`Toggle ${comp.label}`);
    for (const id of entities) SceneCommands.setField(id, comp.name, enable.key, 'bool', next);
    SceneCommands.endGesture();
  };
  return (
    <section className={`comp${collapsed ? '' : ' open'}${overridden ? ' override' : ''}${enable && !on ? ' disabled' : ''}`}>
      <header className="comp-head" onClick={onToggle}>
        <span className="comp-arrow">
          <ChevronRight size={9} strokeWidth={3} />
        </span>
        {/* Only a section that CAN be turned off draws a box. Transform and the
            importer/asset sections cannot, and a permanently ticked checkbox
            promises a toggle that isn't there — they keep the slot for alignment
            and leave it empty. */}
        {enable ? (
          <span
            className={`comp-chk${on ? ' on' : ''}${enable.mixed ? ' mixed' : ''}`}
            role="checkbox"
            aria-checked={enable.mixed ? 'mixed' : enable.value}
            title={enable.value ? t('det.disableComponent') : t('det.enableComponent')}
            onClick={toggleEnable}
          >
            {on && <Check size={9} strokeWidth={3.2} />}
          </span>
        ) : (
          <span className="comp-chk-slot" aria-hidden="true" />
        )}
        {enable && enableGear}
        <span className="comp-icon">
          <Icon size={13} strokeWidth={1.9} />
        </span>
        <span className="comp-name">{comp.label}</span>
        {docUrl && (
          // A real link, not an IPC call: the window's open handler already
          // routes any http target to the browser and denies in-app navigation.
          <a
            className="comp-help"
            href={docUrl}
            target="_blank"
            rel="noreferrer"
            title={t('det.componentDocs')}
            onClick={(e) => e.stopPropagation()}
          >
            <HelpCircle size={13} strokeWidth={2} />
          </a>
        )}
        {onMore && (
          <button
            type="button"
            className="comp-menu"
            title={t('det.componentOptions')}
            onClick={(e) => {
              e.stopPropagation();
              onMore(e, comp.name);
            }}
          >
            <MoreHorizontal size={13} strokeWidth={2} />
          </button>
        )}
      </header>
      <div className="comp-body">
        <div className="cinner">
          {comp.notice && <div className="comp-notice">{comp.notice}</div>}
          {action && (
            <button type="button" className="comp-action" title={action.title} onClick={action.run}>
              {action.label}
            </button>
          )}
          {extra}
          <div className="comp-fields">
            {ungrouped.map(row)}
            {boxGroups.map((g) => (
              <BoxSidesControl key={g.label} entities={entities} comp={comp.name} write={write} group={g} fields={comp.fields} />
            ))}
            {[...groups].map(([cat, fields]) => (
              <Fold key={cat} label={cat} open={isOpen(cat)} onToggle={() => toggleFold(cat)}>
                {fields.map(row)}
              </Fold>
            ))}
            {advancedFields.length > 0 && (
              <Fold label={t('det.advanced')} open={isOpen(ADVANCED_FOLD)} onToggle={() => toggleFold(ADVANCED_FOLD)}>
                {advancedFields.map(row)}
              </Fold>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// The live "Game" inspector (UE5 PIE Details): reads the running realm snapshot +
// routes edits to the realm (live, reverts on Stop). Structure is read-only here
// (no add/remove/rename of the running game) — just live value debugging.
function GameDetails() {
  const { selectedEntity, selection } = useSyncExternalStore(PlayInspect.subscribe, PlayInspect.getSnapshot);
  // Persisted, shared collapse — a folded section stays folded across selections and
  // restarts (chrome components default folded via the store's policy).
  const collapseMap = useInspectorCollapse((s) => s.explicit);
  const toggle = useInspectorCollapse((s) => s.toggle);

  // The shallow tree snapshot strips component data; Details reads the selected
  // entity's FULL data, fetched alongside the tree. Wrap it as a one-entity
  // SceneData so the shared view-model builders apply unchanged.
  const selData = selectedEntity ? ({ entities: [selectedEntity] } as SceneData) : null;
  const info = selection != null ? buildEntityInfo(selData, selection) : null;
  const inspector = selection != null ? buildInspector(selData, selection) : [];
  const compData = (name: string): Record<string, unknown> =>
    (selectedEntity?.components.find((c) => c.type === name)?.data as Record<string, unknown>) ?? {};

  return (
    <div className="insp">
      <div className="game-live">{t('det.playingLive')}</div>
      {selection == null || !info ? (
        <div className="empty">
          <p>{t('det.gameSelectHint')}</p>
        </div>
      ) : (
        <>
          <div className="ent-head">
            <span className="ent-name">{info.name}</span>
            <span className="ent-meta">
              <span className="pill">{info.kind}</span>
              <span className="pill">#{selection}</span>
            </span>
          </div>
          <div className="insp-body">
            {inspector.map((comp) => {
              // `selection` is a REALM runtime id. Decorators declare the surfaces
              // they serve, and every built-in is edit-only — so this asks for
              // 'play' and correctly gets nothing, where it used to hand a runtime
              // id to an action that looks entities up in the edit model.
              const ctx = { entities: [selection], comp, surface: 'play' as const };
              return (
                <ComponentSection
                  key={comp.name}
                  entities={[selection]}
                  comp={comp}
                  collapsed={isSectionCollapsed(collapseMap, comp.name)}
                  onToggle={() => toggle(comp.name)}
                  action={decoratorAction(ctx)}
                  extra={decoratorExtra(ctx)}
                  hideFields={decoratorOwnedFields(ctx)}
                  write={(key, type, value) =>
                    PlayInspect.setField(selection, comp.name, key, toModelValue(compData(comp.name), type, key, value as never))
                  }
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// The bound shader, surfaced at the top of the material inspector so the material↔shader link is
// visible (it used to be an invisible convention) and switchable — pick another `.esshader` to
// change the effect, or point several materials at one shader to share it. A material instance
// inherits its shader from the parent, so it shows a notice instead of a picker. The stored ref
// stays a material-relative path (unchanged on-disk contract); this bridges it to the @uuid-based
// asset picker and reflects the new parameter surface via the shader-keyed effect in the inspector.
function MaterialShaderSection({
  asset,
  filePath,
  isInstance,
  collapsed,
  onToggle,
}: {
  asset: MaterialAssetData;
  filePath: string;
  isInstance: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const isBuiltin = asset.shader.startsWith(BUILTIN_SHADER_PREFIX);
  const shaderPath = isBuiltin ? '' : shaderProjectPathOf(filePath, asset.shader);
  const info = shaderPath ? AssetRegistry.assetInfo(shaderPath) : null;
  const missing = !isInstance && !isBuiltin && !!asset.shader && !info;

  // The picker offers built-in templates + every project `.esshader`. An option's value encodes
  // which kind it is, so onPick can spell the stored ref: a `builtin:<id>` share-by-reference, or a
  // path relative to the material. Pointing several materials at one file here = sharing a shader.
  const options: { value: string; label: string }[] = [
    ...BUILTIN_SHADER_TEMPLATES.map((tpl) => ({ value: BUILTIN_SHADER_PREFIX + tpl.id, label: t('mat.shaderBuiltin', { name: tpl.label }) })),
    ...AssetRegistry.listAssets('shader').map((a) => ({ value: `file:${a.path}`, label: a.name })),
  ];
  const current = isBuiltin ? asset.shader : `file:${shaderPath}`;
  // Keep the current selection visible even when it isn't a listed option (a renamed / missing file).
  if (asset.shader && !options.some((o) => o.value === current)) {
    options.unshift({ value: current, label: info?.name ?? baseName(asset.shader) });
  }

  const onPick = (v: string) => {
    const ref = v.startsWith(BUILTIN_SHADER_PREFIX)
      ? v
      : v.startsWith('file:')
        ? shaderRelRef(filePath, v.slice('file:'.length))
        : null;
    if (ref == null) return;
    MaterialDocument.edit('Set shader', (d) => {
      if (d.shader === ref) return;
      d.shader = ref;
      // Parameters and the switch permutation belong to the old shader — start the new one clean.
      d.properties = {};
      delete d.switches;
    });
  };

  return (
    <section className={`comp${collapsed ? '' : ' open'}`}>
      <header className="comp-head" onClick={onToggle}>
        <span className="comp-arrow">
          <ChevronRight size={9} strokeWidth={3} />
        </span>
        <span className="comp-chk on">
          <Check size={9} strokeWidth={3.2} />
        </span>
        <span className="comp-icon">
          <Sparkles size={13} strokeWidth={1.9} />
        </span>
        <span className="comp-name">{t('mat.shader')}</span>
      </header>
      <div className="comp-body">
        <div className="cinner">
          {isInstance ? (
            <div className="comp-notice">{t('mat.shaderInherited')}</div>
          ) : (
            <>
              {missing && <div className="comp-notice">{t('mat.shaderMissing', { ref: asset.shader })}</div>}
              <div className="comp-fields">
                <div className="prop">
                  <span className="prop-label" title={t('mat.shaderTip')}>
                    {t('mat.shader')}
                  </span>
                  <div className="prop-value">
                    <span className="field dropdown">
                      <Select variant="field" value={current} options={options} ariaLabel="shader" onChange={onPick} />
                    </span>
                  </div>
                </div>
              </div>
              {isBuiltin && (
                <button
                  type="button"
                  className="comp-action"
                  title={t('mat.convertToUniqueTip')}
                  onClick={() => void convertShaderToUnique(filePath, asset.shader.slice(BUILTIN_SHADER_PREFIX.length))}
                >
                  {t('mat.convertToUnique')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// Material view of the unified inspector — a `.esmaterial` selected in the content browser is
// edited right here, by the same ComponentSection/FieldRow machinery as an entity's components
// (Parameters + Render State), driven by the shader's reflection. There is no bespoke material
// panel: edits flow through the live MaterialDocument (one undo step each, viewport preview) and
// Save writes the JSON back. An instance edits only its overrides; Reset reverts to inherited.
function MaterialAssetInspector({ path }: { path: string }) {
  const revision = useSyncExternalStore(MaterialDocument.subscribe, MaterialDocument.getRevision);
  const [ctx, setCtx] = useState<MaterialContext | null>(null);
  const collapseMap = useInspectorCollapse((s) => s.explicit);
  const toggle = useInspectorCollapse((s) => s.toggle);

  // Load the selected material into the singleton document when the selection changes, and bind
  // the running handle the scene's sprites use (0 when it's not in the current scene).
  useEffect(() => {
    let alive = true;
    void (async () => {
      // Selection round-trip back to the file already open (possibly dirty —
      // the cleanup below kept it): rebind the handle, never reload from disk.
      if (MaterialDocument.isOpen && MaterialDocument.filePath === path) {
        MaterialDocument.setLiveHandle(ProjectStore.materialHandle(path));
        return;
      }
      if (!(await confirmDiscardDoc(MaterialDocument.dirty, t('discard.openAsset', { name: baseName(path) }))) || !alive) return;
      const text = await window.estella.fs.read(path);
      if (!alive) return;
      MaterialDocument.openJson(JSON.parse(text), path);
      MaterialDocument.setLiveHandle(ProjectStore.materialHandle(path));
    })().catch(() => {});
    return () => {
      alive = false;
      // A dirty document stays open on select-away so the DirtyRegistry guards
      // still see the unsaved edits (closing here would discard them silently).
      if (!MaterialDocument.dirty) MaterialDocument.close();
    };
  }, [path]);

  const asset = MaterialDocument.asset;
  const filePath = MaterialDocument.filePath;
  const loaded = !!asset && filePath === path;

  // Reflect the (root) shader + collect inherited params only when the shader binding changes.
  useEffect(() => {
    if (!loaded || !asset || !filePath) {
      setCtx(null);
      return;
    }
    let alive = true;
    void resolveMaterialContext(asset, filePath).then((c) => {
      if (alive) setCtx(c);
    });
    return () => {
      alive = false;
    };
  }, [loaded, asset?.shader, asset?.instanceOf, filePath]);

  const thumbRef = useRef<HTMLCanvasElement>(null);
  // Live preview: re-project the document onto the running handle on every edit/undo/redo, then
  // refresh the offscreen "material ball" thumbnail from that same handle (WYSIWYG).
  useEffect(() => {
    if (loaded && asset && ctx) {
      projectMaterialToHandle(asset, ctx, MaterialDocument.liveHandle);
      void renderMaterialThumbnail(MaterialDocument.liveHandle, thumbRef.current);
    }
  }, [revision, ctx, loaded]);

  if (!loaded || !asset) {
    return (
      <div className="insp">
        <div className="insp-empty" style={{ flex: 1 }}>
          <div className="et">{t('det.loadingMaterial')}</div>
        </div>
      </div>
    );
  }

  const isInstance = asset.instanceOf != null;
  const dirty = MaterialDocument.dirty;
  const components = ctx ? buildMaterialComponents(asset, ctx) : [];
  const write = ctx ? makeMaterialWrite(ctx) : undefined;

  const save = async () => {
    try {
      await window.estella.fs.write(path, JSON.stringify(asset, null, 2) + '\n');
      MaterialDocument.markSaved();
      Toasts.push(t('det.materialSaved'), 'info', 1400);
    } catch (e) {
      Toasts.push(t('det.materialSaveFailed', { error: String(e) }), 'error');
    }
  };

  return (
    <div className="insp">
      <div className="ent-head">
        <div className="ent-row1">
          <div className="ent-name">{baseName(path)}</div>
          <button type="button" className="primary" disabled={!dirty} onClick={() => void save()} title={t('det.saveMaterialTip')}>
            <Save size={13} strokeWidth={1.9} /> {t('det.save')}
          </button>
        </div>
        <div className="ent-meta">
          <span className="pill">
            <span className="pk">{t('det.material')}</span>
            {isInstance ? t('det.instance') : ctx?.reflection.domain ?? 'Unlit2D'}
          </span>
          {dirty && <span className="pill">{t('det.unsaved')}</span>}
        </div>
      </div>
      {MaterialDocument.liveHandle > 0 && (
        <div className="mat-preview">
          <canvas ref={thumbRef} className="mat-thumb" width={96} height={96} />
        </div>
      )}
      <div className="mat-sync">
        {MaterialDocument.liveHandle
          ? t('det.livePreview')
          : t('det.notInScene')}
      </div>
      <div className="insp-body">
        <MaterialShaderSection
          asset={asset}
          filePath={path}
          isInstance={isInstance}
          collapsed={isSectionCollapsed(collapseMap, 'Shader')}
          onToggle={() => toggle('Shader')}
        />
        {components.map((comp) => (
          <ComponentSection
            key={comp.name}
            entities={[]}
            comp={comp}
            collapsed={isSectionCollapsed(collapseMap, comp.name)}
            onToggle={() => toggle(comp.name)}
            write={write}
          />
        ))}
        {ctx && components.length === 1 && (
          <div className="mat-hint">{t('det.noShaderParams')}</div>
        )}
      </div>
    </div>
  );
}

// Asset view of the unified inspector — shown when an asset (not an entity) is
// selected (in the content browser). A material is edited inline (reflection-driven
const BINDING_KINDS: Array<{ kind: Binding['kind']; label: string }> = [
  { kind: 'key', label: t('det.bindKey') },
  { kind: 'keys1d', label: t('det.bindKeys1d') },
  { kind: 'keys2d', label: t('det.bindKeys2d') },
  { kind: 'mouse', label: t('det.bindMouse') },
  { kind: 'gpButton', label: t('det.bindGpButton') },
  { kind: 'gpAxis', label: t('det.bindGpAxis') },
  { kind: 'stick', label: t('det.bindStick') },
];

function defaultBinding(kind: Binding['kind']): Binding {
  switch (kind) {
    case 'keys1d': return { kind: 'keys1d', neg: 'KeyA', pos: 'KeyD' };
    case 'keys2d': return { kind: 'keys2d', up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
    case 'mouse': return { kind: 'mouse', button: 0 };
    case 'gpButton': return { kind: 'gpButton', button: 0 };
    case 'gpAxis': return { kind: 'gpAxis', axis: 0 };
    case 'stick': return { kind: 'stick', stick: 'left' };
    default: return { kind: 'key', code: 'Space' };
  }
}

function BindingRow({ binding, onChange, onRemove }: { binding: Binding; onChange: (b: Binding) => void; onRemove: () => void }) {
  const b = binding as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => onChange({ ...(b as object), ...patch } as unknown as Binding);
  const txt = (k: string, ph: string) => (
    <input className="im-in" value={String(b[k] ?? '')} placeholder={ph} onChange={(e) => set({ [k]: e.target.value })} />
  );
  const num = (k: string) => (
    <input className="im-in num" type="number" value={Number(b[k] ?? 0)} onChange={(e) => set({ [k]: Number(e.target.value) || 0 })} />
  );
  let fields: React.ReactNode = null;
  switch (binding.kind) {
    case 'key': fields = txt('code', t('det.bindCodePh')); break;
    case 'keys1d': fields = <>{txt('neg', '−')}{txt('pos', '+')}</>; break;
    case 'keys2d': fields = <>{txt('up', t('det.bindUp'))}{txt('down', t('det.bindDown'))}{txt('left', t('det.bindLeft'))}{txt('right', t('det.bindRight'))}</>; break;
    case 'mouse': case 'gpButton': fields = num('button'); break;
    case 'gpAxis': fields = num('axis'); break;
    case 'stick':
      fields = (
        <Select
          className="im-in"
          ariaLabel={t('det.stickAria')}
          value={b.stick === 'right' ? 'right' : 'left'}
          options={[
            { value: 'left', label: t('det.bindLeft') },
            { value: 'right', label: t('det.bindRight') },
          ]}
          onChange={(v) => set({ stick: v })}
        />
      );
      break;
  }
  return (
    <div className="im-binding">
      <Select
        className="im-in kind"
        ariaLabel={t('det.bindingKindAria')}
        value={binding.kind}
        options={BINDING_KINDS.map((k) => ({ value: k.kind, label: k.label }))}
        onChange={(v) => onChange(defaultBinding(v))}
      />
      {fields}
      <button type="button" className="im-x" onClick={onRemove} title={t('det.removeBinding')}>×</button>
    </div>
  );
}

// The .inputmap editor, embedded in the unified inspector (no separate panel): edits
// the SAME JSON the runtime's loadInputMapAsset reads. Saves on every edit.
function InputMapAssetInspector({ path }: { path: string }) {
  const [map, setMap] = useState<InputMapAsset | null>(null);
  useEffect(() => {
    let alive = true;
    void window.estella.fs
      .read(path)
      .then((t) => {
        if (!alive) return;
        try {
          setMap(JSON.parse(t) as InputMapAsset);
        } catch {
          setMap(imap.blankInputMap());
        }
      })
      .catch(() => alive && setMap(imap.blankInputMap()));
    return () => {
      alive = false;
    };
  }, [path]);

  if (!map) return <div className="insp"><div className="empty-line">{t('det.loading')}</div></div>;

  const commit = (next: InputMapAsset) => {
    setMap(next);
    void window.estella.fs.write(path, JSON.stringify(next, null, 2) + '\n');
  };
  const uniqueName = () => {
    let n = 'NewAction';
    for (let i = 2; map.actions[n]; i++) n = `NewAction${i}`;
    return n;
  };
  const actions = Object.entries(map.actions);

  return (
    <div className="insp input-map">
      <div className="im-head">
        <span>{t('det.inputActions')}</span>
        <button type="button" className="im-add" onClick={() => commit(imap.addAction(map, uniqueName()))}>{t('det.addAction')}</button>
      </div>
      {actions.length === 0 && <div className="empty-line">{t('det.noActions')}</div>}
      {actions.map(([name, def]) => (
        <div className="im-action" key={name}>
          <div className="im-action-head">
            <input
              className="im-name"
              key={name}
              defaultValue={name}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== name) commit(imap.renameAction(map, name, e.target.value));
              }}
            />
            <Select
              className="im-in"
              ariaLabel={t('det.actionTypeAria')}
              value={def.type}
              options={[
                { value: 'button', label: t('det.actButton') },
                { value: 'axis', label: t('det.actAxis') },
                { value: 'axis2d', label: t('det.actAxis2d') },
              ]}
              onChange={(v) => commit(imap.setActionType(map, name, v as ActionType))}
            />
            <button type="button" className="im-x" onClick={() => commit(imap.removeAction(map, name))} title={t('det.removeAction')}>×</button>
          </div>
          {def.bindings.map((bnd, i) => (
            <BindingRow
              key={i}
              binding={bnd}
              onChange={(nb) => commit(imap.setBinding(map, name, i, nb))}
              onRemove={() => commit(imap.removeBinding(map, name, i))}
            />
          ))}
          <button type="button" className="im-addb" onClick={() => commit(imap.addBinding(map, name, defaultBinding('key')))}>{t('det.addBinding')}</button>
        </div>
      ))}
    </div>
  );
}

// The .eslocale editor, embedded in the unified inspector (the input-map
// precedent): edits the SAME JSON the runtime's LocaleAssetLoader reads, saving
// on every edit. The project's OTHER tables provide a dimmed reference
// translation per key plus a missing-key backfill list — the translator's
// actual workflow. A syntax error shows read-only guidance instead of an
// editor whose first save would clobber the file.
function LocaleTableAssetInspector({ path }: { path: string }) {
  const [table, setTable] = useState<LocaleTableAsset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // key → (locale → text) across the project's other .eslocale tables.
  const [siblings, setSiblings] = useState<Map<string, Map<string, string>> | null>(null);

  useEffect(() => {
    let alive = true;
    setTable(null);
    setLoadError(null);
    void window.estella.fs
      .read(path)
      .then((text) => {
        if (!alive) return;
        try {
          setTable(parseLocaleTable(text, path));
        } catch (e) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      })
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [path]);

  useEffect(() => {
    let alive = true;
    setSiblings(null);
    void (async () => {
      const map = new Map<string, Map<string, string>>();
      for (const asset of AssetRegistry.listAssets('locale')) {
        if (asset.path === path) continue;
        try {
          const sib = parseLocaleTable(await window.estella.fs.read(asset.path), asset.path);
          for (const [key, entry] of Object.entries(sib.entries)) {
            let byLocale = map.get(key);
            if (!byLocale) {
              byLocale = new Map();
              map.set(key, byLocale);
            }
            byLocale.set(sib.locale, typeof entry === 'string' ? entry : entry.other);
          }
        } catch {
          /* malformed sibling — selecting IT surfaces the error */
        }
      }
      if (alive) setSiblings(map);
    })();
    return () => {
      alive = false;
    };
  }, [path]);

  if (loadError) {
    return (
      <div className="insp">
        <div className="comp-notice" style={{ margin: 8 }}>{t('det.localeParseError')}</div>
        <div className="lt-error" title={loadError}>{loadError}</div>
      </div>
    );
  }
  if (!table) return <div className="insp"><div className="empty-line">{t('det.loading')}</div></div>;

  const commit = (next: LocaleTableAsset) => {
    setTable(next);
    void window.estella.fs.write(path, ldoc.serializeLocaleTable(next));
  };
  const uniqueKey = () => {
    let n = 'new.key';
    for (let i = 2; table.entries[n] !== undefined; i++) n = `new.key${i}`;
    return n;
  };
  const blurOnEnter = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  };
  // Reference language for a key: 'en' when this table isn't en, else the
  // first other locale that carries it.
  const refFor = (key: string): { tag: string; text: string } | null => {
    const byLocale = siblings?.get(key);
    if (!byLocale || byLocale.size === 0) return null;
    const tag = table.locale !== 'en' && byLocale.has('en')
      ? 'en'
      : ([...byLocale.keys()].find((l) => l !== table.locale) ?? [...byLocale.keys()][0]);
    return { tag, text: byLocale.get(tag)! };
  };
  const missing = siblings ? [...siblings.keys()].filter((k) => table.entries[k] === undefined).sort() : [];
  const entries = Object.entries(table.entries);

  const textField = (fieldKey: string, value: string, write: (v: string) => void) => (
    <span className="field">
      <input
        key={fieldKey}
        defaultValue={value}
        spellCheck={false}
        onBlur={(e) => write(e.target.value)}
        onKeyDown={blurOnEnter}
      />
    </span>
  );

  return (
    <div className="insp">
      <div className="insp-body">
        <LocaleSection
          title={t('det.localeStrings')}
          badge={String(entries.length)}
          action={
            <button
              type="button"
              className="comp-menu lt-headbtn"
              title={t('det.addKey')}
              onClick={(e) => {
                e.stopPropagation();
                commit(ldoc.addEntry(table, uniqueKey()));
              }}
            >
              <Plus size={13} strokeWidth={2} />
            </button>
          }
        >
          <div className="prop">
            <span className="prop-label">{t('det.localeTag')}</span>
            <span className="prop-value">{textField(table.locale, table.locale, (v) => {
              if (v.trim() && v !== table.locale) commit(ldoc.setLocaleTag(table, v));
            })}</span>
            <span />
          </div>
          {entries.length === 0 && <div className="empty-line">{t('det.noStrings')}</div>}
          {entries.map(([key, entry]) => {
            const ref = refFor(key);
            const plural = typeof entry !== 'string';
            const keyInput = (
              <input
                className="lt-key"
                key={key}
                defaultValue={key}
                spellCheck={false}
                title={key}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== key) commit(ldoc.renameEntry(table, key, e.target.value));
                }}
                onKeyDown={blurOnEnter}
              />
            );
            const pluralToggle = (
              <button
                type="button"
                className="lt-act"
                title={plural ? t('det.toSingle') : t('det.toPlural')}
                onClick={() => commit(plural ? ldoc.toSingle(table, key) : ldoc.toPlural(table, key))}
              >
                {plural ? '1' : 'N'}
              </button>
            );
            const remove = (
              <button type="button" className="lt-x" title={t('det.removeEntry')} onClick={() => commit(ldoc.removeEntry(table, key))}>
                <X size={12} strokeWidth={2} />
              </button>
            );
            return (
              <div key={key}>
                {!plural ? (
                  <div className="prop">
                    {keyInput}
                    <span className="prop-value">
                      {textField(`${key}:s`, entry, (v) => commit(ldoc.setEntryText(table, key, v)))}
                      {pluralToggle}
                    </span>
                    {remove}
                  </div>
                ) : (
                  <>
                    <div className="prop">
                      {keyInput}
                      <span className="prop-value">
                        {ldoc.absentPluralForms(entry).length > 0 && (
                          <span className="field dropdown">
                            <Select
                              variant="field"
                              ariaLabel={t('det.pluralFormAria')}
                              value=""
                              options={[
                                { value: '', label: t('det.addForm') },
                                ...ldoc.absentPluralForms(entry).map((c) => ({ value: c, label: c })),
                              ]}
                              onChange={(v) => v && commit(ldoc.setPluralForm(table, key, v as PluralCategory, ''))}
                            />
                          </span>
                        )}
                        {pluralToggle}
                      </span>
                      {remove}
                    </div>
                    {ldoc.PLURAL_CATEGORIES.filter((c) => entry[c] !== undefined).map((c) => (
                      <div className="prop" key={c}>
                        <span className="prop-label lt-formlabel">{c}</span>
                        <span className="prop-value">
                          {textField(`${key}:${c}`, entry[c] ?? '', (v) => commit(ldoc.setPluralForm(table, key, c, v)))}
                        </span>
                        {c !== 'other' ? (
                          <button type="button" className="lt-x" title={t('det.removeForm')} onClick={() => commit(ldoc.removePluralForm(table, key, c))}>
                            <X size={12} strokeWidth={2} />
                          </button>
                        ) : (
                          <span />
                        )}
                      </div>
                    ))}
                  </>
                )}
                {ref && (
                  <div className="lt-refrow">
                    <span className="lt-ref" title={`${ref.tag} · ${ref.text}`}>{ref.tag} · {ref.text}</span>
                  </div>
                )}
              </div>
            );
          })}
        </LocaleSection>
        {missing.length > 0 && (
          <LocaleSection title={t('det.missingKeys')} badge={String(missing.length)}>
            {missing.map((k) => {
              const ref = refFor(k);
              return (
                <div className="prop" key={k}>
                  <span className="lt-miss-key" title={k}>{k}</span>
                  <span className="prop-value">
                    {ref && <span className="lt-miss-ref" title={ref.text}>{ref.tag} · {ref.text}</span>}
                  </span>
                  <button type="button" className="lt-addk" title={t('det.addMissingKey')} onClick={() => commit(ldoc.addEntry(table, k))}>
                    <Plus size={12} strokeWidth={2} />
                  </button>
                </div>
              );
            })}
          </LocaleSection>
        )}
      </div>
    </div>
  );
}

// A collapsible Details section speaking the component-header language — the
// locale editor's structural chrome (title + count badge + an always-visible
// header action), sharing .comp/.prop styling with the entity inspector.
function LocaleSection({ title, badge, action, children }: {
  title: string; badge: string; action?: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`comp${open ? ' open' : ''}`}>
      <div className="comp-head" onClick={() => setOpen((o) => !o)}>
        <span className="comp-arrow"><ChevronRight size={13} strokeWidth={2} /></span>
        <span className="comp-name">{title}</span>
        <span className="comp-badge">{badge}</span>
        {action}
      </div>
      <div className="comp-body">
        <div className="cinner">
          <div className="comp-fields">{children}</div>
        </div>
      </div>
    </div>
  );
}

// rows); other assets show their fs metadata + the image/type glyph preview.
function AssetInspector({ path }: { path: string }) {
  const type = AssetRegistry.assetTypeAt(path);
  if (isMaterialAsset(path)) {
    return <MaterialAssetInspector path={path} />;
  }
  if (type === 'animclip') {
    return <AnimClipAssetInspector path={path} />;
  }
  if (type === 'inputmap') {
    return <InputMapAssetInspector path={path} />;
  }
  if (type === 'locale') {
    return <LocaleTableAssetInspector path={path} />;
  }
  return <GenericAssetInspector path={path} />;
}

// The .esanim inspector: the open flipbook's fps/loop (+ sheet grid) rendered
// through the same ComponentSection engine as entities and materials. Passive —
// the Flipbook panel owns the AnimClipDocument lifecycle, so this only reflects it
// when the selected clip IS the open one, else falls back to import settings.
function AnimClipAssetInspector({ path }: { path: string }) {
  useSyncExternalStore(AnimClipDocument.subscribe, AnimClipDocument.getRevision);
  const collapseMap = useInspectorCollapse((s) => s.explicit);
  const toggle = useInspectorCollapse((s) => s.toggle);

  const asset = AnimClipDocument.asset;
  const loaded = !!asset && AnimClipDocument.filePath === path;
  if (!loaded || !asset) return <GenericAssetInspector path={path} />;

  const components = buildAnimClipComponents(asset);
  const write = makeAnimClipWrite();
  const dirty = AnimClipDocument.dirty;

  return (
    <div className="insp">
      <div className="ent-head">
        <div className="ent-row1">
          <div className="ent-name">{baseName(path)}</div>
        </div>
        <div className="ent-meta">
          <span className="pill">
            <span className="pk">{t('fb.animClip')}</span>
            {t('fb.frameCount', { count: asset.frames.length })}
          </span>
          {dirty && <span className="pill">{t('det.unsaved')}</span>}
        </div>
      </div>
      <div className="insp-body">
        {components.map((comp) => (
          <ComponentSection
            key={comp.name}
            entities={[]}
            comp={comp}
            collapsed={isSectionCollapsed(collapseMap, comp.name)}
            onToggle={() => toggle(comp.name)}
            write={write}
          />
        ))}
      </div>
    </div>
  );
}


function MetaRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="cb-mr">
      <span className="k">{k}</span>
      <span className="v" style={mono ? undefined : { fontFamily: 'inherit' }} title={v}>
        {v}
      </span>
    </div>
  );
}

// Per-platform texture Import Settings — Unity's Default + platform tabs. The
// DEFAULT lives in the Import Settings section above; here each target can override
// the axes that actually vary per platform for a Basis "encode once, transcode per
// GPU" pipeline: size cap + whether/how to compress (e.g. WeChat ships smaller /
// ETC1S). Edits write to `overrides.<platform>.*` through the same importer `write`
// seam, so save + dirty tracking are unchanged.
//
// The tabs are the BUILT-IN platform list itself, not a copy of it: this used to be
// a hand-written four and had already drifted — it never offered the mobile targets,
// which is where a texture budget bites hardest.
const PLATFORM_TAB_ICON: Record<BuiltinPlatform, ReactNode> = {
  web: <Globe size={13} />,
  desktop: <Monitor size={13} />,
  wechat: <MessageSquare size={13} />,
  playable: <Play size={13} />,
  android: <Smartphone size={13} />,
  ios: <Apple size={13} />,
};

/** Labels come from the build dialog's catalog — one name per platform, editor-wide. */
const PLATFORM_TAB_LABEL: Record<BuiltinPlatform, string> = {
  web: t('build.plat.web'), desktop: t('build.plat.desktop'),
  wechat: t('build.plat.wechat'), playable: t('build.plat.playable'),
  android: t('build.plat.android'), ios: t('build.plat.ios'),
};

function TexturePlatformOverrides({ importer, write }: { importer: Record<string, unknown>; write: FieldWrite }) {
  const [tab, setTab] = useState<BuiltinPlatform>('wechat');
  const overrides = (importer.overrides as Record<string, Record<string, unknown>> | undefined) ?? {};
  const ov = overrides[tab] ?? {};
  const enabled = !!ov.enabled;
  const def = readTextureCookSettings(importer); // true default (what an unset field inherits)
  const fields: InspectorField[] = [
    {
      key: `overrides.${tab}.maxSize`, label: 'Max Size', type: 'enum', category: '',
      options: [256, 512, 1024, 2048, 4096, 8192].map((n) => ({ label: String(n), value: n })),
      value: typeof ov.maxSize === 'number' ? ov.maxSize : def.maxSize, defaultValue: def.maxSize,
    },
    {
      key: `overrides.${tab}.compress`, label: 'Compress', type: 'bool', category: '',
      value: typeof ov.compress === 'boolean' ? ov.compress : def.compress, defaultValue: def.compress,
    },
    {
      key: `overrides.${tab}.compressFormat`, label: 'Format', type: 'select', category: '',
      selectOptions: ['uastc', 'etc1s'],
      value: ov.compressFormat === 'etc1s' || ov.compressFormat === 'uastc' ? ov.compressFormat : def.format,
      defaultValue: def.format,
    },
  ];
  return (
    <div className="tex-plat">
      <div className="tex-plat__hd">{t('det.platformOverrides')}</div>
      <Segmented
        ariaLabel={t('det.platformOverrides')}
        value={tab}
        onChange={setTab}
        options={BUILTIN_PLATFORMS.map((id) => ({
          value: id, icon: PLATFORM_TAB_ICON[id], title: PLATFORM_TAB_LABEL[id],
        }))}
      />
      <label className="tex-plat__en">
        <input type="checkbox" checked={enabled} onChange={(e) => write(`overrides.${tab}.enabled`, 'bool', e.target.checked)} />
        {t('det.overrideFor', { platform: PLATFORM_TAB_LABEL[tab] })}
      </label>
      {enabled ? (
        <div className="tex-plat__fields">
          {fields.map((f) => <FieldRow key={f.key} entities={[]} comp="importer" field={f} write={write} />)}
        </div>
      ) : (
        <div className="tex-plat__inherit">{t('det.followsDefault')}</div>
      )}
    </div>
  );
}

// The asset inspector for every type without a bespoke editor. Renders read-only
// metadata plus, for types with an importer schema, editable Import Settings
// (written to the `.meta` sidecar) through the shared ComponentSection engine.
function GenericAssetInspector({ path }: { path: string }) {
  const name = baseName(path);
  const type = AssetRegistry.assetTypeAt(path);
  const isImage = IMAGE_RE.test(name);

  const [importer, setImporter] = useState<Record<string, unknown> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [stat, setStat] = useState<{ size: number; mtimeMs: number } | null>(null);
  const [dims, setDims] = useState<string | null>(null);
  const [refCount, setRefCount] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [usagesOpen, setUsagesOpen] = useState(false);

  // Reset to the loading state when the SELECTION moves (not on a refresh).
  useEffect(() => {
    setImporter(null);
    setDirty(false);
  }, [path]);

  // Load the `.meta` importer block on (re)selection, and re-read whenever the
  // watcher reports a filesystem change: a `.meta` written outside this panel —
  // git, a build step, an automation client — otherwise leaves the inspector
  // showing values that no longer exist on disk. An unsaved edit always wins;
  // re-reading over it would silently discard the user's work.
  const fsVersion = useSyncExternalStore(fsRefresh.subscribe, fsRefresh.get);
  const dirtyNow = useRef(dirty);
  dirtyNow.current = dirty;
  useEffect(() => {
    if (dirtyNow.current) return;
    let alive = true;
    void window.estella.fs
      .read(path + '.meta')
      .then((t) => alive && setImporter(((JSON.parse(t).importer as Record<string, unknown>) ?? {})))
      .catch(() => alive && setImporter({}));
    return () => {
      alive = false;
    };
  }, [path, fsVersion]);

  // Metadata: disk stat, image dimensions, and how many assets reference this one.
  useEffect(() => {
    let alive = true;
    setStat(null);
    setDims(null);
    setRefCount(null);
    void window.estella?.fs?.stat(path).then((s) => alive && setStat(s)).catch(() => {});
    if (isImage) {
      const img = new Image();
      img.onload = () => alive && setDims(`${img.naturalWidth} × ${img.naturalHeight}`);
      img.src = `estella://project/${path}`;
    }
    // Same collector as Find Usages, but off the cached asset index (this fires
    // on every selection — a full disk walk per click just for a badge is waste);
    // fsWatch keeps the cache fresh, and the dialog itself stays authoritative.
    void findAssetUsages(path, { preferCache: true })
      .then((u) => alive && setRefCount(u.length))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path, isImage]);

  const assetRef = AssetRegistry.assetRef(path);
  const comp = importer ? buildImporterComponent(type, importer) : null;
  const write: FieldWrite = (key, _t, value) => {
    setImporter((cur) => (cur ? applyImporterEdit(cur, key, value as InspectorFieldValue) : cur));
    setDirty(true);
    DirtyRegistry.bump();
  };

  const save = async () => {
    try {
      const meta = JSON.parse(await window.estella.fs.read(path + '.meta'));
      meta.importer = importerRef.current;
      await window.estella.fs.write(path + '.meta', JSON.stringify(meta, null, 2) + '\n');
      setDirty(false);
      DirtyRegistry.bump();
      await ProjectStore.refreshAssets();
      // Push filter/wrap to the live gl handle so the edit viewport updates now
      // (no scene reload); a no-op for types/assets without a live texture.
      if (type === 'texture' || type === 'sprite') AssetRegistry.applyLiveTextureSettings(path);
      Toasts.push(t('det.importSaved'), 'info', 1400);
    } catch (e) {
      Toasts.push(t('det.importSaveFailed', { error: String(e) }), 'error');
    }
  };

  // Unsaved import-settings edits join the aggregate dirty state while this
  // inspector is mounted (quit-save writes them; deselecting still discards, as
  // before). Latest-refs so the registered closures never go stale.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const importerRef = useRef(importer);
  importerRef.current = importer;
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(
    () =>
      DirtyRegistry.register({
        id: `importer:${path}`,
        isDirty: () => dirtyRef.current,
        save: () => saveRef.current(),
      }),
    [path],
  );

  return (
    <div className="insp">
      <div className="ent-head">
        <div className="ent-row1">
          <div className="ent-name">{name}</div>
          {comp && (
            <button
              type="button"
              className="primary"
              disabled={!dirty}
              onClick={() => void save()}
              title={t('det.saveImportTip')}
            >
              <Save size={13} strokeWidth={1.9} /> {t('det.save')}
            </button>
          )}
        </div>
        <div className="ent-meta">
          <span className="pill">
            <span className="pk">{t('det.type')}</span>
            {type}
          </span>
          {dirty && <span className="pill">{t('det.unsaved')}</span>}
        </div>
      </div>

      <div className="insp-body">
        {/* A compact preview for a quick visual ID — kept short so the editable
            Import Settings sit above the fold (the reason to open an asset). */}
        {type === 'audio' ? (
          <AudioWavePreview path={path} />
        ) : isImage && importer && (type === 'texture' || type === 'sprite') ? (
          // A texture's preview IS its 9-slice editor: the border is the one
          // import setting you cannot sensibly type in, and it writes through
          // the same `write` door as the numbers below.
          <NineSliceEditor path={path} importer={importer} write={write} />
        ) : type === 'video' ? (
          <div className="cb-prev" style={{ height: 160 }}>
            <video
              src={`estella://project/${path}`}
              controls
              muted
              loop
              playsInline
              style={{ maxWidth: '100%', maxHeight: 160, display: 'block', margin: '0 auto' }}
            />
          </div>
        ) : (
          <div className="cb-prev" style={{ height: 108 }}>
            <div className="pv">
              {isImage ? (
                <img src={`estella://project/${path}`} alt="" draggable={false} />
              ) : (
                <AssetIcon type={type} size={44} />
              )}
            </div>
          </div>
        )}

        {/* Editable import settings first (the reason to select an asset), then
            read-only metadata. */}
        {comp ? (
          <ComponentSection
            entities={[]}
            comp={{ ...comp, label: t('det.importSettings') }}
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
            write={write}
          />
        ) : (
          <div className="insp-empty" style={{ padding: '14px 12px' }}>
            <div className="es">{t('det.noImportSettings')}</div>
          </div>
        )}

        {isImage && importer && !collapsed && (
          <TexturePlatformOverrides importer={importer} write={write} />
        )}

        <ContributedSections target={{ component: type, path }} />

        <div className="cb-meta" style={{ padding: '8px 10px 0' }}>
          <MetaRow k={t('det.metaPath')} v={path} mono />
          {dims && <MetaRow k={t('det.metaDimensions')} v={dims} />}
          {stat && <MetaRow k={t('det.metaSize')} v={formatBytes(stat.size)} />}
          {stat && <MetaRow k={t('det.metaModified')} v={new Date(stat.mtimeMs).toLocaleString()} />}
          {assetRef && <MetaRow k={t('det.metaUuid')} v={assetRef} mono />}
          {refCount != null && (
            // The count opens Find Usages — the number alone answers nothing.
            <button
              type="button"
              className="cb-mr cb-mr-link"
              title={t('det.findUsagesTip')}
              onClick={() => setUsagesOpen(true)}
            >
              <span className="k">{t('det.metaReferences')}</span>
              <span className="v" style={{ fontFamily: 'inherit' }}>{refCount}</span>
            </button>
          )}
        </div>
      </div>
      {usagesOpen && <FindUsagesDialog path={path} onClose={() => setUsagesOpen(false)} />}

      <div className="cb-act">
        {type === 'scene' && (
          <button
            type="button"
            className="primary"
            onClick={async () => {
              if (await confirmDiscard(t('discard.openScene', { name: baseName(path) }))) void ProjectStore.openScene(path);
            }}
          >
            <FolderOpen size={13} strokeWidth={1.85} /> {t('det.openScene')}
          </button>
        )}
        <button
          type="button"
          className="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(path);
            Toasts.push(t('det.copiedPath'), 'info', 1600);
          }}
        >
          <Copy size={13} strokeWidth={1.85} /> {t('det.copyPath')}
        </button>
      </div>
    </div>
  );
}

// A selected outliner folder (folders aren't entities — no components): just its
// name, path, and how many entities it organizes (recursive).
function FolderInspector({ path }: { path: string }) {
  useSyncExternalStore(SceneStore.subscribe, SceneStore.getStructureRevision);
  const entities = SceneModel.current?.entities ?? [];
  const count = entities.reduce((n, e) => (isFolderUnder(SceneModel.folderOf(e.id), path) ? n + 1 : n), 0);
  return (
    <div className="insp">
      <div className="ent-head">
        <div className="ent-row1">
          <div className="ent-name">{folderName(path)}</div>
        </div>
        <div className="ent-meta">
          <span className="pill">
            <span className="pk">{t('det.folder')}</span>
            {path}
          </span>
          <span className="pill">
            <span className="pk">{t('det.items')}</span>
            {count}
          </span>
        </div>
      </div>
      <div className="insp-empty" style={{ flex: 1 }}>
        <div className="ei">
          <FolderOpen size={22} strokeWidth={1.4} />
        </div>
        <div className="et">{count === 1 ? t('det.folderOneEntity') : t('det.folderEntities', { count })}</div>
        <div className="es">{t('det.folderHint')}</div>
      </div>
    </div>
  );
}

// A generic editor-pushed inspection source (an open timeline's clip settings,
// a track, a slice…) rendered through the same ComponentSection engine as
// entities and materials. Lives on the source's own subscribe/getRevision;
// edits route through source.write. The one shared inspector, no bespoke panel.
function SourceInspector({ source }: { source: InspectSource }) {
  useSyncExternalStore(source.subscribe, source.getRevision);
  const collapseMap = useInspectorCollapse((s) => s.explicit);
  const toggle = useInspectorCollapse((s) => s.toggle);
  const components = source.build();
  return (
    <div className="insp">
      <div className="ent-head">
        <div className="ent-row1">
          <div className="ent-name">{source.title}</div>
        </div>
      </div>
      <div className="insp-body">
        {components.map((comp) => (
          <ComponentSection
            key={comp.name}
            entities={[]}
            comp={comp}
            collapsed={isSectionCollapsed(collapseMap, comp.name)}
            onToggle={() => toggle(comp.name)}
            write={source.write}
          />
        ))}
      </div>
    </div>
  );
}

// Dispatcher: the live game inspector during PIE, the edit inspector otherwise.
// Both halves of "during PIE" matter — Stop takes the Outliner's world picker
// away, so a choice that outlived the realm would strand this panel on a world
// that no longer exists, with nothing on screen able to switch it back.
export function Details() {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const inspectWorld = useEditorStore((s) => s.inspectWorld);
  return isPlaying && inspectWorld === 'game' ? <GameDetails /> : <EditorDetails />;
}

function EditorDetails() {
  const engine = useSyncExternalStore(EngineHost.subscribe, EngineHost.getSnapshot);
  const revision = useSyncExternalStore(SceneStore.subscribe, SceneStore.getRevision);
  // Re-render when a project component's schema changes (live edit of its source).
  useSyncExternalStore(subscribeSchemas, getSchemaRevision);
  const selectedId = useSelection((s) => s.selectedId);
  const selectedIds = useSelection((s) => s.selectedIds);
  const selectedAsset = useSelection((s) => s.selectedAsset);
  const inspectSource = useSelection((s) => s.inspectSource);
  const selectedFolder = useOutliner((s) => s.selectedFolder);
  const conflictsByInstance = usePrefabConflicts((s) => s.byInstance);
  const ready = engine.status === 'ready' && selectedId != null;

  // Selection targets, primary (the active id) first. Edits fan out across all.
  const ids = useMemo(
    () => (selectedId == null ? [] : [selectedId, ...[...selectedIds].filter((i) => i !== selectedId)]),
    [selectedId, selectedIds],
  );
  const multi = ids.length > 1;

  const [query, setQuery] = useState('');
  const collapseMap = useInspectorCollapse((s) => s.explicit);
  const toggle = useInspectorCollapse((s) => s.toggle);
  const [compMenu, setCompMenu] = useState<{ x: number; y: number; comp: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [filtOn, setFiltOn] = useState(false);

  const entity = useMemo(
    () => (ready ? SceneQuery.readEntity(selectedId!) : null),
    [ready, selectedId, revision],
  );
  const components = useMemo(
    () => (ready ? SceneQuery.readMultiInspector(ids) : []),
    [ready, ids, revision],
  );

  // Inspector search + override filter. Search keeps components whose name matches
  // (all fields) or that have a matching field (only the matches); the Filter toggle
  // then narrows to overridden fields only — components with a value that differs
  // from its default, keeping just those fields (Unity's "show overridden" mode).
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = components;
    if (q) {
      out = [];
      for (const c of components) {
        if (c.label.toLowerCase().includes(q)) {
          out.push(c);
          continue;
        }
        const fields = c.fields.filter((f) => f.label.toLowerCase().includes(q));
        if (fields.length) out.push({ ...c, fields });
      }
    }
    if (filtOn) {
      out = out
        .map((c) => ({ ...c, fields: c.fields.filter(isModified) }))
        .filter((c) => c.fields.length > 0);
    }
    return out;
  }, [components, query, filtOn]);

  // An explicit sub-object inspection source (a keyframe, a track…) overrides the
  // entity/asset inspector; a non-override source is the fallback further below.
  if (inspectSource?.override) {
    return <SourceInspector source={inspectSource} />;
  }
  // Unified inspector: an asset selection (mutually exclusive with entities)
  // renders the asset view in this same panel.
  if (selectedAsset) {
    return <AssetInspector path={selectedAsset} />;
  }
  // A selected outliner folder (no entity/asset selected) shows the folder view.
  if (selectedFolder != null && selectedId == null) {
    return <FolderInspector path={selectedFolder} />;
  }

  // Editor-context inspection source (e.g. the open timeline's clip settings) is
  // the fallback — shown only when nothing else is selected, never overriding one.
  if (selectedId == null && inspectSource) {
    return <SourceInspector source={inspectSource} />;
  }

  if (!entity || selectedId == null) {
    return (
      <div className="insp">
        <EmptyState icon={Box} title={t('det.noSelection')} hint={t('det.noSelectionHint')} />
      </div>
    );
  }

  const modelEntity = SceneModel.entityBySource(selectedId);

  // Prefab-instance identity (real tag data): the `prefab` ref lives on the
  // instance root, so non-root members resolve it by walking up to their root.
  const prefabTag = SceneModel.prefabTag(selectedId);
  const prefabRef = prefabTag
    ? prefabTag.prefab ?? SceneModel.prefabTag(prefabTag.instanceRoot)?.prefab
    : undefined;
  const prefabName = prefabRef ? AssetRegistry.assetInfo(prefabRef)?.name ?? null : null;
  // Stale overrides the loader dropped from THIS instance on load (keyed by root).
  const staleOverrides = prefabTag
    ? conflictsByInstance.get(prefabTag.instanceRoot) ?? []
    : [];

  return (
    <div className="insp">
      <div className="phead insp-head">
        <SearchField placeholder={t('ui.search')} value={query} onChange={setQuery} />
        <IconButton
          size="lg"
          variant="outline"
          active={filtOn}
          title={t('det.filterProps')}
          onClick={() => setFiltOn((v) => !v)}
        >
          <Filter size={14} strokeWidth={1.9} />
        </IconButton>
      </div>

      <div className="ent-head">
        <div className="ent-row1">
          {multi ? (
            <div className="ent-name ent-multi">{t('det.entitiesSelected', { count: ids.length })}</div>
          ) : (
            <input
              key={selectedId}
              className="ent-name"
              defaultValue={entity.name}
              spellCheck={false}
              onKeyDown={(e) => {
                // Match the Outliner rename: Enter commits (blur → onBlur writes),
                // Escape reverts to the current name and blurs without committing.
                if (e.key === 'Enter') e.currentTarget.blur();
                else if (e.key === 'Escape') {
                  e.currentTarget.value = entity.name;
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => {
                // Trim, reject empty, and skip a no-op — clicking the name and
                // clicking away must not blank it or log an empty undo step
                // (matches the Outliner + Content Browser rename guards).
                const next = e.target.value.trim();
                if (!next || next === entity.name) {
                  e.target.value = entity.name;
                  return;
                }
                SceneCommands.renameEntity(selectedId, next);
              }}
            />
          )}
        </div>
        <div className="ent-meta">
          {multi ? (
            <span className="pill">
              <span className="pk">{t('det.editing')}</span>
              {t('det.editingShared', { count: ids.length })}
            </span>
          ) : (
            <>
              <span className="pill">
                <span className="pk">{t('det.type')}</span>
                {KIND_LABEL[entity.kind]}
              </span>
              <span className="pill">
                <span className="pk">{t('det.id')}</span>
                {selectedId}
              </span>
            </>
          )}
        </div>
        {prefabName && !multi && (
          <div className="prefab-bar" title={prefabRef}>
            <span className="pic">
              <Package size={13} strokeWidth={1.8} />
            </span>
            <span className="pn">{prefabName}</span>
            <span className="pacts">
              <button
                type="button"
                title={t('det.prefabEditTip')}
                onClick={() => void ProjectStore.editPrefabOfInstance(selectedId)}
              >
                <SquarePen size={12} strokeWidth={1.9} /> {t('det.prefabEdit')}
              </button>
              <button
                type="button"
                title={t('det.prefabSelectTip')}
                onClick={() => {
                  const info = prefabRef ? AssetRegistry.assetInfo(prefabRef) : null;
                  if (info) useSelection.getState().selectAsset(info.path);
                }}
              >
                <FolderOpen size={12} strokeWidth={1.9} /> {t('det.prefabSelect')}
              </button>
              <button
                type="button"
                title={t('det.prefabApplyTip')}
                onClick={() => void ProjectStore.applyPrefabInstance(selectedId)}
              >
                <Upload size={12} strokeWidth={1.9} /> {t('det.prefabApply')}
              </button>
              <button
                type="button"
                title={t('det.prefabRevertTip')}
                onClick={() => void ProjectStore.revertPrefabInstance(selectedId)}
              >
                <RotateCcw size={12} strokeWidth={1.9} /> {t('det.prefabRevert')}
              </button>
            </span>
          </div>
        )}
        {staleOverrides.length > 0 && !multi && (
          <div className="prefab-conflicts" title={staleOverrides.map((s) => s.reason).join('\n')}>
            <span className="pc-icon"><AlertTriangle size={13} strokeWidth={1.9} /></span>
            <span className="pc-text">{t('det.staleOverrides', { count: staleOverrides.length })}</span>
            <button type="button" className="pc-fix" title={t('det.staleRepairTip')} onClick={() => void ProjectStore.save()}>
              {t('det.staleRepair')}
            </button>
          </div>
        )}
      </div>

      <div className="insp-addrow">
        <button type="button" className="insp-add" title={t('det.addComponent')} onClick={() => setAddOpen(true)}>
          <Plus size={13} strokeWidth={2.4} />
          {t('det.addComponent')}
        </button>
      </div>

      <div className="insp-body">
        {ids.length === 1 &&
          entityDecorators(visible.map((c) => c.name), 'edit').map((d) => (
            <span key={d.id}>{d.render({ entity: ids[0]!, surface: 'edit' })}</span>
          ))}
        {ids.length === 1 && (
          <EventBindingSection entityId={ids[0]!} components={visible.map((c) => c.name)} />
        )}
        {visible.map((comp) => {
          const ctx = { entities: ids, comp, surface: 'edit' as const };
          return (
            <ComponentSection
              key={comp.name}
              entities={ids}
              comp={comp}
              collapsed={isSectionCollapsed(collapseMap, comp.name)}
              onToggle={() => toggle(comp.name)}
              onMore={(e, name) => setCompMenu({ x: e.clientX, y: e.clientY, comp: name })}
              action={decoratorAction(ctx)}
              extra={decoratorExtra(ctx)}
              hideFields={decoratorOwnedFields(ctx)}
            />
          );
        })}
        {/* Contributed sections come after the entity's own components — a plugin
            adds to the inspector, it doesn't push the real properties down. */}
        {ids.length === 1 && <ContributedSections target={{ entity: ids[0]! }} />}
        {query && visible.length === 0 && (
          <div className="empty-line">{t('det.noComponentsMatch', { query })}</div>
        )}
      </div>

      {compMenu && (
        <ContextMenu
          x={compMenu.x}
          y={compMenu.y}
          items={(() => {
            const comp = compMenu.comp;
            const data = SceneModel.entityBySource(ids[0])?.components.find((c) => c.type === comp)?.data as
              | Record<string, unknown>
              | undefined;
            const pasteData = InspectorClipboard.componentData(comp);
            return [
              {
                label: t('det.copyValues'),
                icon: <Copy size={13} strokeWidth={1.9} />,
                disabled: !data,
                onClick: () => {
                  if (data) InspectorClipboard.copyComponent(comp, data);
                },
              },
              {
                label: t('det.pasteValues'),
                icon: <ClipboardPaste size={13} strokeWidth={1.9} />,
                disabled: !pasteData,
                onClick: () => {
                  if (pasteData) SceneCommands.pasteComponentValuesMany(ids, comp, pasteData);
                },
              },
              {
                label: t('det.resetDefaults'),
                icon: <RotateCcw size={13} strokeWidth={1.9} />,
                onClick: () => SceneCommands.resetComponentMany(ids, comp),
              },
              { sep: true },
              {
                label: ids.length > 1 ? t('det.removeComponentN', { count: ids.length }) : t('det.removeComponent'),
                danger: true,
                icon: <Trash2 size={13} strokeWidth={1.9} />,
                onClick: () => SceneCommands.removeComponentMany(ids, comp),
              },
            ];
          })()}
          onClose={() => setCompMenu(null)}
        />
      )}
      {addOpen && modelEntity && (
        <AddComponentMenu
          // Multi-select: offer any component addable to AT LEAST ONE selected entity
          // (the union), since Add applies to every entity that lacks it. Using only
          // the primary's addable set hid components the primary already had.
          entries={multi ? unionAddableComponents(ids) : modelAddableComponentEntries(modelEntity)}
          onAdd={(name) => SceneCommands.addComponentMany(ids, name)}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}



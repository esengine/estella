// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Sequencer.tsx
 * @brief   The UE-Sequencer-style animation editor panel — bottom-dock tab.
 *          Open a clip, render the
 *          entity→component→channel track tree + a scrubbable frame timeline.
 *
 * Data flow mirrors the scene panels: subscribe to the TimelineDocument revision
 * (the asset is the source of truth) and the sequencerStore (playhead / transport
 * UI). Keyframe editing (P2), the add-track picker + curve view (P3), and live
 * viewport preview on scrub (the next P1 step) plug into the marked seams.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Circle, Magnet, Plus, ChevronDown, Eye, EyeOff, Diamond, Film, Link2, Trash2, Settings2,
} from 'lucide-react';
import { evaluateChannel, InterpType, WrapMode } from 'esengine';
import { t } from '@/i18n';
import { animatableFieldsFor } from '@/engine/schema';
import { TimelineDocument } from '@/timeline/TimelineDocument';
import { createAnimationClip } from '@/timeline/openClip';
import { TimelineCommands } from '@/timeline/TimelineCommands';
import { useSequencerStore } from '@/store/sequencerStore';
import { useSelection } from '@/store/selectionStore';
import { SceneModel } from '@/engine/SceneModel';
import { ContextMenu, type MenuItem } from '@/components/Menu';
import { eventWindow } from '@/components/PanelWindow';
import { IconButton } from '@/components/IconButton';
import { NumField } from '@/components/NumField';
import { Transport } from '@/components/Transport';
import { SaveButton } from '@/components/SaveButton';
import { SequencerCurve } from '@/panels/SequencerCurve';
import {
  buildTimelineRows, visibleRows, frameCount, timeToPct, pctToTime, findChannel, muteKey,
  type SeqRow, type ChannelRef,
} from '@/timeline/timelineView';

// Interpolation choices shown in the keyframe popover (subset of InterpType).
const INTERP_OPTIONS: [InterpType, string][] = [
  [InterpType.Hermite, t('seq.interp.auto')],
  [InterpType.Linear, t('seq.interp.linear')],
  [InterpType.Step, t('seq.interp.step')],
  [InterpType.EaseInOut, t('seq.interp.easeInOut')],
];

const WRAP_OPTIONS: [WrapMode, string][] = [
  [WrapMode.Once, t('seq.wrap.once')],
  [WrapMode.Loop, t('seq.wrap.loop')],
  [WrapMode.PingPong, t('seq.wrap.pingPong')],
];

function getNested(obj: unknown, path: string): number {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return 0;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'number' ? cur : 0;
}

interface AddTrackItem {
  ref: ChannelRef;
  component: string;
  property: string;
  value: number;
}

// The "add track" choices — engine-authoritative: each component the bound entity
// carries × that component's `animatableFields` (from the engine registry, the
// same source the inspector/serializer use), minus channels already tracked.
function buildAddTrackItems(asset: { tracks: unknown } | null, rootSourceId: number | null): AddTrackItem[] {
  if (!asset || rootSourceId == null) return [];
  const entity = SceneModel.entityBySource(rootSourceId);
  if (!entity) return [];
  const items: AddTrackItem[] = [];
  for (const comp of entity.components) {
    const fields = animatableFieldsFor(comp.type);
    for (const property of fields) {
      const ref: ChannelRef = { childPath: '', component: comp.type, property };
      if (findChannel(asset as never, ref)) continue;
      items.push({ ref, component: comp.type, property, value: getNested(comp.data, property) });
    }
  }
  return items;
}

function EmptyState() {
  return (
    <div className="seq-empty">
      <Film size={30} strokeWidth={1.3} />
      <div className="seq-empty__title">{t('seq.empty.title')}</div>
      <div className="seq-empty__hint">{t('seq.empty.hint')}</div>
      <button type="button" className="seq-btn seq-btn--text on" onClick={() => void createAnimationClip('')}>
        <Plus size={14} /><span>{t('seq.empty.new')}</span>
      </button>
      <ol className="seq-empty__steps">
        <li>{t('seq.empty.step1')}</li>
        <li>{t('seq.empty.step2')}</li>
        <li>{t('seq.empty.step3')}</li>
      </ol>
    </div>
  );
}

export function Sequencer() {
  // Re-read the document on every revision bump (open / edit / close).
  useSyncExternalStore(TimelineDocument.subscribe, TimelineDocument.getRevision);
  const asset = TimelineDocument.asset;

  if (!asset) return <div className="seq"><EmptyState /></div>;

  return <SequencerBody />;
}

function SequencerBody() {
  const asset = TimelineDocument.asset!;
  const { fps } = TimelineDocument.meta;
  const duration = asset.duration;

  const time = useSequencerStore((s) => s.time);
  const playing = useSequencerStore((s) => s.playing);
  const loop = useSequencerStore((s) => s.loop);
  const snap = useSequencerStore((s) => s.snap);
  const view = useSequencerStore((s) => s.view);
  const recording = useSequencerStore((s) => s.recording);
  const collapsed = useSequencerStore((s) => s.collapsedGroups);
  const mutedTracks = useSequencerStore((s) => s.mutedTracks);

  const root = TimelineDocument.rootEntity;
  const rootName = root != null ? (SceneModel.entityBySource(root)?.name || `#${root}`) : null;

  const tlRef = useRef<HTMLDivElement>(null);

  const totalFrames = frameCount(asset, fps);
  const frame = Math.round(time * fps);

  const rows = useMemo(() => buildTimelineRows(asset), [asset]);
  const shown = useMemo(() => visibleRows(rows, collapsed), [rows, collapsed]);
  const allKeyTimes = useMemo(() => {
    const set = new Set<number>();
    for (const r of rows) for (const t of r.keyframes) set.add(t);
    return [...set].sort((a, b) => a - b);
  }, [rows]);

  // ── time helpers ──
  const snapTime = (t: number) => {
    const clamped = Math.max(0, Math.min(duration, t));
    return snap && fps > 0 ? Math.round(clamped * fps) / fps : clamped;
  };
  const setTime = (t: number) => useSequencerStore.getState().setTime(snapTime(t));
  const timeFromClientX = (clientX: number): number => {
    const el = tlRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const pct = ((clientX - r.left) / r.width) * 100;
    return pctToTime(pct, duration);
  };

  // ── keyframe editing (P2) ──
  const selectedKey = useSequencerStore((s) => s.selectedKey);
  const [dragKey, setDragKey] = useState<{ rowId: string; ref: ChannelRef; fromTime: number; time: number } | null>(null);
  const [interp, setInterpPopover] = useState<{ ref: ChannelRef; time: number; x: number; y: number } | null>(null);

  // Click a key → select + interp popover; drag past a threshold → move in time.
  const onKeyPointerDown = (e: React.PointerEvent, ref: ChannelRef, rowId: string, time: number) => {
    e.stopPropagation();
    useSequencerStore.getState().setPlaying(false);
    const win = eventWindow(e);
    const startX = e.clientX;
    const anchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
    let moved = false;
    let liveTime = time;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      moved = true;
      liveTime = snapTime(timeFromClientX(ev.clientX));
      setDragKey({ rowId, ref, fromTime: time, time: liveTime });
    };
    const up = () => {
      win.removeEventListener('pointermove', move);
      win.removeEventListener('pointerup', up);
      setDragKey(null);
      if (moved) {
        TimelineCommands.moveKey(ref, time, liveTime);
        useSequencerStore.getState().selectKey(`${rowId}@${liveTime}`);
        setInterpPopover(null);
      } else {
        useSequencerStore.getState().selectKey(`${rowId}@${time}`);
        setInterpPopover({ ref, time, x: anchor.left, y: anchor.bottom + 6 });
      }
    };
    win.addEventListener('pointermove', move);
    win.addEventListener('pointerup', up);
  };

  // Channel "key" button: insert a key at the playhead holding the curve's
  // current value (a real curve split; in record mode auto-key uses the edit value).
  const addKeyAtPlayhead = (ref: ChannelRef) => {
    const ch = findChannel(asset, ref);
    TimelineCommands.addKey(ref, snapTime(time), ch ? evaluateChannel(ch, time) : 0);
  };

  const curInterp: InterpType | null = interp
    ? (findChannel(asset, interp.ref)?.keyframes.find((k) => Math.abs(k.time - interp.time) < 1e-4)?.interpolation
        ?? InterpType.Hermite)
    : null;

  // ── track authoring + clip settings (P3) ──
  const [pickerOpen, setPickerOpen] = useState<{ x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<{ x: number; y: number } | null>(null);
  const [rowCtx, setRowCtx] = useState<{ x: number; y: number; ref: ChannelRef } | null>(null);
  const addTrackItems = pickerOpen ? buildAddTrackItems(asset, root) : [];

  const popoverAt = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: Math.min(r.left, eventWindow(e).innerWidth - 240), y: r.bottom + 6 };
  };

  // ── playback (visual playhead; viewport preview is the next P1 step) ──
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const cur = useSequencerStore.getState().time + dt;
      if (cur >= duration) {
        if (loop) useSequencerStore.getState().setTime(cur % duration || 0);
        else { useSequencerStore.getState().setTime(duration); useSequencerStore.getState().setPlaying(false); return; }
      } else {
        useSequencerStore.getState().setTime(cur);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, duration]);

  const jumpKey = (dir: 1 | -1) => {
    useSequencerStore.getState().setPlaying(false);
    if (dir < 0) {
      const prev = [...allKeyTimes].reverse().find((t) => t < time - 1e-4);
      useSequencerStore.getState().setTime(prev ?? 0);
    } else {
      const next = allKeyTimes.find((t) => t > time + 1e-4);
      useSequencerStore.getState().setTime(next ?? duration);
    }
  };

  // The focused panel owns its editing keys (the root carries tabIndex, so any
  // click inside lands focus here). Delete is consumed even with no key selected —
  // it must never fall through to the global entity delete while the user is
  // working in the sequencer.
  const onPanelKey = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
    switch (e.key) {
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedKey) break;
        const at = selectedKey.lastIndexOf('@');
        const row = rows.find((r) => r.id === selectedKey.slice(0, at));
        if (row?.ref) {
          TimelineCommands.deleteKey(row.ref, parseFloat(selectedKey.slice(at + 1)));
          useSequencerStore.getState().selectKey(null);
          setInterpPopover(null);
        }
        break;
      }
      case ' ': {
        if (t.tagName === 'BUTTON') break; // Space on a focused button activates it
        e.preventDefault();
        e.stopPropagation();
        useSequencerStore.getState().togglePlay();
        break;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        e.stopPropagation(); // frame-step, not the viewport's selection nudge
        useSequencerStore.getState().setPlaying(false);
        setTime(time + (e.key === 'ArrowRight' ? 1 : -1) / fps);
        break;
      }
      case 'Home': {
        e.preventDefault();
        e.stopPropagation();
        setTime(0);
        break;
      }
      case 'End': {
        e.preventDefault();
        e.stopPropagation();
        setTime(duration);
        break;
      }
      case 'Escape': {
        if (interp || pickerOpen || settingsOpen) {
          e.stopPropagation();
          setInterpPopover(null);
          setPickerOpen(null);
          setSettingsOpen(null);
        } else if (selectedKey) {
          e.stopPropagation();
          useSequencerStore.getState().selectKey(null);
        }
        break;
      }
    }
  };

  const onScrubDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.seq-key')) return;
    useSequencerStore.getState().setPlaying(false);
    const win = eventWindow(e);
    setTime(timeFromClientX(e.clientX));
    const move = (ev: PointerEvent) => setTime(timeFromClientX(ev.clientX));
    const up = () => {
      win.removeEventListener('pointermove', move);
      win.removeEventListener('pointerup', up);
    };
    win.addEventListener('pointermove', move);
    win.addEventListener('pointerup', up);
  };

  // ── ruler ticks ──
  const majorStep = Math.max(1, Math.round(fps / 2));
  const showMinor = totalFrames <= 120;
  const ticks: { f: number; major: boolean }[] = [];
  for (let f = 0; f <= totalFrames; f++) {
    const major = f % majorStep === 0;
    if (major || showMinor) ticks.push({ f, major });
  }

  const keyCount = rows.reduce((n, r) => n + r.keyframes.length, 0);
  const trackCount = rows.filter((r) => r.kind === 'channel' || r.kind === 'track').length;

  return (
    <div
      className={`seq${recording ? ' is-rec' : ''}${view === 'curve' ? ' is-curve' : ''}`}
      tabIndex={0}
      onKeyDown={onPanelKey}
    >
      {/* transport */}
      <div className="phead seq-bar">
        <span className="seq-meta">
          <Film size={13} className="seq-meta__icon" />
          <b>{TimelineDocument.meta.filePath?.split('/').pop() ?? t('seq.unnamed')}</b>
          <span className="seq-meta__dim">{t('seq.metaSummary', { frames: totalFrames, fps, wrap: t(loop ? 'seq.wrap.loop' : 'seq.wrap.once') })}</span>
        </span>
        <button
          type="button"
          className={`seq-btn seq-btn--text${rootName ? ' on' : ''}`}
          title={t('seq.bindTitle')}
          onClick={() => TimelineDocument.setRootEntity(useSelection.getState().selectedId)}
        >
          <Link2 size={13} /><span>{rootName ?? t('seq.unbound')}</span>
        </button>
        <span className="seq-div" />
        <button
          type="button"
          className={`seq-btn seq-btn--rec${recording ? ' on' : ''}`}
          title={t('seq.recordTitle')}
          onClick={() => useSequencerStore.getState().toggleRecording()}
        >
          <Circle size={12} fill="currentColor" />
        </button>
        <span className="seq-div" />
        <Transport
          playing={playing}
          onPlayPause={() => useSequencerStore.getState().togglePlay()}
          onJumpStart={() => setTime(0)}
          onJumpEnd={() => setTime(duration)}
          onStepBack={() => jumpKey(-1)}
          onStepForward={() => jumpKey(1)}
          stepBackTitle={t('seq.prevKeyframe')}
          stepForwardTitle={t('seq.nextKeyframe')}
          loop={loop}
          onToggleLoop={() => useSequencerStore.getState().toggleLoop()}
          frame={frame}
          frameCount={totalFrames}
        />
        <span className="seq-spacer" />
        <div className="seq-tabs">
          <button type="button" className={`seq-tab${view === 'sheet' ? ' active' : ''}`} onClick={() => useSequencerStore.getState().setView('sheet')}>{t('seq.tabSheet')}</button>
          <button type="button" className={`seq-tab${view === 'curve' ? ' active' : ''}`} onClick={() => useSequencerStore.getState().setView('curve')}>{t('seq.tabCurves')}</button>
        </div>
        <IconButton
          size="md"
          active={snap}
          title={t('seq.snapTitle')}
          onClick={() => useSequencerStore.getState().toggleSnap()}
        >
          <Magnet size={14} />
        </IconButton>
        <IconButton
          size="md"
          title={t('seq.settingsTitle')}
          onClick={(e) => setSettingsOpen(popoverAt(e))}
        >
          <Settings2 size={14} />
        </IconButton>
        <button
          type="button"
          className="seq-btn seq-btn--text"
          title={t('seq.addTrack')}
          disabled={root == null}
          onClick={(e) => setPickerOpen(popoverAt(e))}
        >
          <Plus size={14} /><span>{t('seq.trackBtn')}</span>
        </button>
        <SaveButton dirty={TimelineDocument.meta.dirty} onSave={() => void TimelineCommands.save()} title={t('seq.saveTitle')} />
      </div>

      {/* body: track list + timeline */}
      <div className="seq-body">
        <div className="seq-tracks">
          <div className="seq-track-head">{t('seq.tracksHead')}</div>
          <div className="seq-rows">
            {shown.map((row) => (
              <TrackRow
                key={row.id}
                row={row}
                collapsed={collapsed.has(row.groupKey ?? '')}
                muted={!!row.ref && mutedTracks.has(muteKey(row.ref))}
                onAddKey={addKeyAtPlayhead}
                onContext={(e, ref) => setRowCtx({ x: e.clientX, y: e.clientY, ref })}
              />
            ))}
          </div>
        </div>

        <div className="seq-tl" ref={tlRef}>
          <div className="seq-ruler" onPointerDown={onScrubDown}>
            {ticks.map(({ f, major }) => (
              <div
                key={f}
                className={`seq-tick${major ? ' major' : ''}`}
                style={{ left: `${timeToPct(f / fps, duration)}%` }}
              >
                {major && <span className="seq-tick__label">{f}</span>}
              </div>
            ))}
          </div>
          <div className="seq-scroll" onPointerDown={onScrubDown}>
            <div className="seq-grid">
              {ticks.filter((t) => t.major).map(({ f }) => (
                <div key={f} className="seq-gl" style={{ left: `${timeToPct(f / fps, duration)}%` }} />
              ))}
            </div>
            {view === 'sheet' ? (
              <div className="seq-lanes">
                {shown.map((row) => (
                  <div
                    key={row.id}
                    className={`seq-lane seq-lane--${row.kind}${row.ref && mutedTracks.has(muteKey(row.ref)) ? ' muted' : ''}`}
                  >
                    {row.keyframes.map((kt) => {
                      const isDrag = dragKey?.rowId === row.id && Math.abs(dragKey.fromTime - kt) < 1e-4;
                      const at = isDrag ? dragKey!.time : kt;
                      const sel = selectedKey === `${row.id}@${kt}`;
                      return (
                        <div
                          key={kt}
                          className={`seq-key${sel ? ' sel' : ''}${isDrag ? ' drag' : ''}`}
                          style={{ left: `${timeToPct(at, duration)}%` }}
                          title={t('seq.frameTip', { frame: Math.round(at * fps) })}
                          onPointerDown={row.ref ? (e) => onKeyPointerDown(e, row.ref!, row.id, kt) : undefined}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <SequencerCurve
                asset={asset}
                rows={shown}
                duration={duration}
                selectedKey={selectedKey}
                timeFromClientX={timeFromClientX}
                snapTime={snapTime}
              />
            )}
          </div>
          <div className="seq-playhead" style={{ left: `${timeToPct(time, duration)}%` }}>
            <div className="seq-playhead__head" />
            <span className="seq-playhead__time">{frame}</span>
          </div>
        </div>
      </div>

      {/* add-track picker — engine-authoritative animatable fields */}
      {pickerOpen && (
        <>
          <div className="seq-pop-scrim" onPointerDown={() => setPickerOpen(null)} />
          <div className="seq-picker" style={{ left: pickerOpen.x, top: pickerOpen.y }}>
            <div className="seq-interp__title">{t('seq.addTrack')}</div>
            {addTrackItems.length === 0 ? (
              <div className="empty-line empty-line--sm">{t('seq.noAnimatable')}</div>
            ) : (
              addTrackItems.map((it) => (
                <button
                  key={`${it.component}.${it.property}`}
                  type="button"
                  className="seq-interp__item"
                  onClick={() => {
                    TimelineCommands.addTrack(it.ref, it.value, snapTime(time));
                    setPickerOpen(null);
                  }}
                >
                  <span className="seq-picker__comp">{it.component}</span>
                  <span className="seq-picker__prop">{it.property}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}

      {/* clip settings: duration / fps / wrap */}
      {settingsOpen && (
        <>
          <div className="seq-pop-scrim" onPointerDown={() => setSettingsOpen(null)} />
          <div className="seq-settings" style={{ left: settingsOpen.x, top: settingsOpen.y }}>
            <div className="seq-interp__title">{t('seq.clipSettings')}</div>
            <label className="seq-settings__row">
              <span>{t('seq.durationS')}</span>
              <NumField value={duration} onCommit={(n) => TimelineCommands.setDuration(Math.max(0, n))} />
            </label>
            <label className="seq-settings__row">
              <span>{t('seq.frameRateFps')}</span>
              <NumField value={fps} onCommit={(n) => TimelineDocument.setFps(Math.max(1, Math.round(n)))} />
            </label>
            <div className="seq-settings__row">
              <span>{t('seq.wrap.loop')}</span>
              <div className="seq-settings__wrap">
                {WRAP_OPTIONS.map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`seq-settings__wrapbtn${asset.wrapMode === mode ? ' on' : ''}`}
                    onClick={() => TimelineCommands.setWrapMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* channel row context menu */}
      {rowCtx && (
        <ContextMenu
          x={rowCtx.x}
          y={rowCtx.y}
          items={
            [
              {
                label: t('seq.deleteTrack'),
                onClick: () => {
                  TimelineCommands.removeChannel(rowCtx.ref);
                  useSequencerStore.getState().selectKey(null);
                },
              },
            ] as MenuItem[]
          }
          onClose={() => setRowCtx(null)}
        />
      )}

      {/* keyframe interpolation popover */}
      {interp && (
        <>
          <div className="seq-pop-scrim" onPointerDown={() => setInterpPopover(null)} />
          <div className="seq-interp" style={{ left: interp.x, top: interp.y }}>
            <div className="seq-interp__title">{t('seq.interpTitle')}</div>
            {INTERP_OPTIONS.map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`seq-interp__item${curInterp === mode ? ' on' : ''}`}
                onClick={() => {
                  TimelineCommands.setKeyInterp(interp.ref, interp.time, mode);
                  setInterpPopover(null);
                }}
              >
                {label}
              </button>
            ))}
            <div className="seq-interp__sep" />
            <button
              type="button"
              className="seq-interp__item seq-interp__del"
              onClick={() => {
                TimelineCommands.deleteKey(interp.ref, interp.time);
                useSequencerStore.getState().selectKey(null);
                setInterpPopover(null);
              }}
            >
              <Trash2 size={12} /> {t('seq.deleteKeyframe')}
            </button>
          </div>
        </>
      )}

      {/* status strip */}
      <div className="seq-foot">
        <span className="seq-foot__dot" />
        <span>{recording ? t('seq.footRecording') : t('seq.footIdle')}</span>
        <span className="seq-spacer" />
        <span><strong>{keyCount}</strong> {t('seq.keysUnit')} · {trackCount} {t('seq.tracksUnit')}</span>
      </div>
    </div>
  );
}

function TrackRow({
  row,
  collapsed,
  muted,
  onAddKey,
  onContext,
}: {
  row: SeqRow;
  collapsed: boolean;
  muted: boolean;
  onAddKey: (ref: ChannelRef) => void;
  onContext: (e: React.MouseEvent, ref: ChannelRef) => void;
}) {
  const isGroup = row.kind === 'entity' || row.kind === 'component';
  return (
    <div
      className={`seq-row seq-row--${row.kind}${muted ? ' muted' : ''}`}
      style={{ paddingLeft: 8 + row.depth * 14 }}
      onClick={() => {
        if (isGroup && row.groupKey) useSequencerStore.getState().toggleGroup(row.groupKey);
      }}
      onContextMenu={
        row.kind === 'channel' && row.ref
          ? (e) => {
              e.preventDefault();
              onContext(e, row.ref!);
            }
          : undefined
      }
    >
      {isGroup ? (
        <ChevronDown size={12} className={`seq-row__chev${collapsed ? ' is-collapsed' : ''}`} />
      ) : (
        <span className="seq-row__chev seq-row__chev--leaf" />
      )}
      <span className="seq-row__label">{row.label}</span>
      {row.kind === 'channel' && row.ref && (
        <span className="seq-row__act">
          <button
            type="button"
            className="seq-row__btn"
            title={t('seq.keyAtPlayhead')}
            onClick={(e) => {
              e.stopPropagation();
              onAddKey(row.ref!);
            }}
          >
            <Diamond size={11} fill="currentColor" />
          </button>
          <button
            type="button"
            className={`seq-row__btn${muted ? ' on' : ''}`}
            title={muted ? t('seq.unmuteTrack') : t('seq.muteTrack')}
            onClick={(e) => {
              e.stopPropagation();
              useSequencerStore.getState().toggleMute(muteKey(row.ref!));
            }}
          >
            {muted ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
        </span>
      )}
    </div>
  );
}

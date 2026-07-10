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
  Circle, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight,
  Play, Pause, Repeat, Magnet, Plus, ChevronDown, Eye, EyeOff, Diamond, Film, Link2, Save, Trash2, Settings2,
} from 'lucide-react';
import { evaluateChannel, InterpType, WrapMode } from 'esengine';
import { animatableFieldsFor } from '@/engine/schema';
import { TimelineDocument } from '@/timeline/TimelineDocument';
import { createAnimationClip } from '@/timeline/openClip';
import { TimelineCommands } from '@/timeline/TimelineCommands';
import { useSequencerStore } from '@/store/sequencerStore';
import { useSelection } from '@/store/selectionStore';
import { SceneModel } from '@/engine/SceneModel';
import { ContextMenu, type MenuItem } from '@/components/Menu';
import { SequencerCurve } from '@/panels/SequencerCurve';
import {
  buildTimelineRows, visibleRows, frameCount, timeToPct, pctToTime, findChannel, muteKey,
  type SeqRow, type ChannelRef,
} from '@/timeline/timelineView';

// Interpolation choices shown in the keyframe popover (subset of InterpType).
const INTERP_OPTIONS: [InterpType, string][] = [
  [InterpType.Hermite, 'Auto (smooth)'],
  [InterpType.Linear, 'Linear'],
  [InterpType.Step, 'Step (constant)'],
  [InterpType.EaseInOut, 'Ease in-out'],
];

const WRAP_OPTIONS: [WrapMode, string][] = [
  [WrapMode.Once, 'Once'],
  [WrapMode.Loop, 'Loop'],
  [WrapMode.PingPong, 'Ping-pong'],
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
      <div className="seq-empty__title">No animation open</div>
      <div className="seq-empty__hint">Create a new animation, or double-click an existing .esanim in the Content Browser.</div>
      <button type="button" className="seq-btn seq-btn--text on" onClick={() => void createAnimationClip('')}>
        <Plus size={14} /><span>New animation</span>
      </button>
      <ol className="seq-empty__steps">
        <li>Select an object in the scene, then click Bind in the toolbar to attach the preview to it</li>
        <li>Turn on Record, then move/rotate it or edit properties — keyframes are recorded automatically</li>
        <li>Drag the playhead to preview, then click Save to write back to the file</li>
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
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
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
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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
    return { x: Math.min(r.left, window.innerWidth - 240), y: r.bottom + 6 };
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

  const onScrubDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.seq-key')) return;
    useSequencerStore.getState().setPlaying(false);
    setTime(timeFromClientX(e.clientX));
    const move = (ev: PointerEvent) => setTime(timeFromClientX(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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
    <div className={`seq${recording ? ' is-rec' : ''}${view === 'curve' ? ' is-curve' : ''}`}>
      {/* transport */}
      <div className="seq-bar">
        <span className="seq-meta">
          <Film size={13} className="seq-meta__icon" />
          <b>{TimelineDocument.meta.filePath?.split('/').pop() ?? 'Unnamed'}</b>
          <span className="seq-meta__dim">· {totalFrames} frames · {fps}fps · {loop ? 'Loop' : 'Once'}</span>
        </span>
        <button
          type="button"
          className={`seq-btn seq-btn--text${rootName ? ' on' : ''}`}
          title="Bind preview to the selected entity"
          onClick={() => TimelineDocument.setRootEntity(useSelection.getState().selectedId)}
        >
          <Link2 size={13} /><span>{rootName ?? 'Unbound'}</span>
        </button>
        <span className="seq-div" />
        <button
          type="button"
          className={`seq-btn seq-btn--rec${recording ? ' on' : ''}`}
          title="Record: property edits auto-key"
          onClick={() => useSequencerStore.getState().toggleRecording()}
        >
          <Circle size={12} fill="currentColor" />
        </button>
        <span className="seq-div" />
        <button type="button" className="seq-btn" title="Jump to start" onClick={() => setTime(0)}><ChevronFirst size={15} /></button>
        <button type="button" className="seq-btn" title="Previous keyframe" onClick={() => jumpKey(-1)}><ChevronLeft size={15} /></button>
        <button
          type="button"
          className="seq-btn seq-btn--play"
          title="Play / pause (Space)"
          onClick={() => useSequencerStore.getState().togglePlay()}
        >
          {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>
        <button type="button" className="seq-btn" title="Next keyframe" onClick={() => jumpKey(1)}><ChevronRight size={15} /></button>
        <button type="button" className="seq-btn" title="Jump to end" onClick={() => setTime(duration)}><ChevronLast size={15} /></button>
        <button
          type="button"
          className={`seq-btn${loop ? ' on' : ''}`}
          title="Loop"
          onClick={() => useSequencerStore.getState().toggleLoop()}
        >
          <Repeat size={14} />
        </button>
        <span className="seq-div" />
        <span className="seq-frame">Frame <strong>{frame}</strong> / {totalFrames}</span>
        <span className="seq-spacer" />
        <div className="seq-tabs">
          <button type="button" className={`seq-tab${view === 'sheet' ? ' active' : ''}`} onClick={() => useSequencerStore.getState().setView('sheet')}>Sheet</button>
          <button type="button" className={`seq-tab${view === 'curve' ? ' active' : ''}`} onClick={() => useSequencerStore.getState().setView('curve')}>Curves</button>
        </div>
        <button
          type="button"
          className={`seq-btn${snap ? ' on' : ''}`}
          title="Snap to frame"
          onClick={() => useSequencerStore.getState().toggleSnap()}
        >
          <Magnet size={14} />
        </button>
        <button
          type="button"
          className="seq-btn"
          title="Clip settings (duration / fps / loop)"
          onClick={(e) => setSettingsOpen(popoverAt(e))}
        >
          <Settings2 size={14} />
        </button>
        <button
          type="button"
          className="seq-btn seq-btn--text"
          title="Add track"
          disabled={root == null}
          onClick={(e) => setPickerOpen(popoverAt(e))}
        >
          <Plus size={14} /><span>Track</span>
        </button>
        <button
          type="button"
          className={`seq-btn seq-btn--text${TimelineDocument.meta.dirty ? ' on' : ''}`}
          title="Save animation"
          onClick={() => void TimelineCommands.save()}
        >
          <Save size={14} /><span>{TimelineDocument.meta.dirty ? 'Save*' : 'Save'}</span>
        </button>
      </div>

      {/* body: track list + timeline */}
      <div className="seq-body">
        <div className="seq-tracks">
          <div className="seq-track-head">Tracks</div>
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
                    {row.keyframes.map((t) => {
                      const isDrag = dragKey?.rowId === row.id && Math.abs(dragKey.fromTime - t) < 1e-4;
                      const at = isDrag ? dragKey!.time : t;
                      const sel = selectedKey === `${row.id}@${t}`;
                      return (
                        <div
                          key={t}
                          className={`seq-key${sel ? ' sel' : ''}${isDrag ? ' drag' : ''}`}
                          style={{ left: `${timeToPct(at, duration)}%` }}
                          title={`Frame ${Math.round(at * fps)}`}
                          onPointerDown={row.ref ? (e) => onKeyPointerDown(e, row.ref!, row.id, t) : undefined}
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
            <div className="seq-interp__title">Add track</div>
            {addTrackItems.length === 0 ? (
              <div className="seq-picker__empty">No animatable properties to add</div>
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
            <div className="seq-interp__title">Clip settings</div>
            <label className="seq-settings__row">
              <span>Duration (s)</span>
              <input
                type="number" min={0} step={0.1} defaultValue={duration}
                onChange={(e) => TimelineCommands.setDuration(parseFloat(e.target.value) || 0)}
              />
            </label>
            <label className="seq-settings__row">
              <span>Frame rate (fps)</span>
              <input
                type="number" min={1} step={1} defaultValue={fps}
                onChange={(e) => TimelineDocument.setFps(parseInt(e.target.value, 10) || 1)}
              />
            </label>
            <div className="seq-settings__row">
              <span>Loop</span>
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
                label: 'Delete track',
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
            <div className="seq-interp__title">Interpolation</div>
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
              <Trash2 size={12} /> Delete keyframe
            </button>
          </div>
        </>
      )}

      {/* status strip */}
      <div className="seq-foot">
        <span className="seq-foot__dot" />
        <span>{recording ? '● Recording' : 'Animation edit'}</span>
        <span className="seq-spacer" />
        <span><strong>{keyCount}</strong> keys · {trackCount} tracks</span>
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
            title="Key at playhead"
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
            title={muted ? 'Unmute track' : 'Mute track'}
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

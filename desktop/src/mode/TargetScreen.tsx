// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  TargetScreen.tsx — "which screen am I looking at", for every view that
 *        shows the game.
 *
 * The device selection used to be a UI-mode authoring preview and nothing else:
 * the edit viewport drew a letterboxed design frame with it, while the running
 * game — in the viewport or in the Game panel — ignored it and simply filled
 * whatever the panel had been dragged to. So a project could be authored for a
 * phone and only ever be RUN at whatever aspect the dock happened to be, which
 * is the one thing the setting exists to prevent.
 *
 * One selection now drives both. Editing previews it; play is constrained to it.
 */
import { useSyncExternalStore } from 'react';
import { Smartphone } from 'lucide-react';
import { t } from '@/i18n';
import { OvDropdown, DdCheck, DdRadio } from '@/components/OverlayMenu';
import { useEditorMode } from '@/store/editorModeStore';
import { screenPresets, screenPresetById, deviceDims } from '@/mode/resolutionPresets';
import { ProjectStore } from '@/project/ProjectStore';
import type { ScreenPreset as ProjectScreenPreset } from '@/project/format';

/** The open project's declared screens, reactively. */
export function useProjectScreenPresets(): ProjectScreenPreset[] | undefined {
  return useSyncExternalStore(ProjectStore.subscribe, ProjectStore.getSnapshot)?.screenPresets;
}

/**
 * The dropdown: device presets, orientation, and (authoring only) the safe-area
 * overlay. `design` — the no-simulation sentinel — leaves play filling its host,
 * which is what someone authoring for desktop wants.
 *
 * `designAspect` is the authored resolution the orientation snaps to when a real
 * device is picked; pass it where a scene Canvas is in play, omit it elsewhere.
 */
export function TargetScreenDropdown({
  designAspect,
  showSafeAreaToggle = false,
}: {
  designAspect?: { w: number; h: number };
  showSafeAreaToggle?: boolean;
}) {
  const device = useEditorMode((s) => s.device);
  const orientation = useEditorMode((s) => s.orientation);
  const showSafeArea = useEditorMode((s) => s.showSafeArea);
  const presets = useProjectScreenPresets();
  // The `design` sentinel simulates no screen, so there is nothing for the
  // orientation to turn — deviceDims ignores it entirely for this case.
  const noDevice = !deviceDims(device, orientation, presets);

  return (
    <OvDropdown
      icon={Smartphone}
      label={<span className="val">{screenPresetById(device, presets).label}</span>}
      title={t('vp.deviceTitle')}
    >
      <div className="ovmenu-lbl">{t('vp.device')}</div>
      {screenPresets(presets).map((p) => (
        <DdRadio
          key={p.id}
          on={device === p.id}
          label={p.label}
          onClick={() => {
            const ms = useEditorMode.getState();
            ms.setDevice(p.id);
            // Picking a real device snaps the orientation to the design's own
            // (a landscape design previews on a landscape phone); the explicit
            // orientation radios below still override.
            if (p.w > 0 && designAspect) {
              const want = designAspect.w >= designAspect.h ? 'landscape' : 'portrait';
              if (ms.orientation !== want) ms.toggleOrientation();
            }
          }}
        />
      ))}
      {/* Orientation rotates a DEVICE. With no device simulated there is nothing to
          rotate — the design resolution is the authored shape, not a screen being
          held one way or the other — so the rows are disabled rather than being
          clickable no-ops. */}
      <div className="ovmenu-lbl">{t('vp.orientation')}</div>
      <DdRadio
        on={orientation === 'landscape'}
        label={t('vp.landscape')}
        disabled={noDevice}
        title={noDevice ? t('vp.orientationNeedsDevice') : undefined}
        onClick={() => orientation !== 'landscape' && useEditorMode.getState().toggleOrientation()}
      />
      <DdRadio
        on={orientation === 'portrait'}
        label={t('vp.portrait')}
        disabled={noDevice}
        title={noDevice ? t('vp.orientationNeedsDevice') : undefined}
        onClick={() => orientation !== 'portrait' && useEditorMode.getState().toggleOrientation()}
      />
      {noDevice && <div className="ovmenu-note">{t('vp.orientationNeedsDevice')}</div>}
      {showSafeAreaToggle && (
        <>
          <div className="ovmenu-lbl">{t('vp.overlay')}</div>
          <DdCheck on={showSafeArea} label={t('vp.safeArea')} onClick={() => useEditorMode.getState().toggleSafeArea()} />
        </>
      )}
    </OvDropdown>
  );
}

/**
 * How a play host should be sized for the current selection.
 *
 * The letterbox is done in CSS, on the ELEMENT hosting the realm, rather than
 * inside the engine: the realm then sees a canvas of the device's shape and its
 * own ScreenScaling adapts to it exactly as it would on the real hardware. Doing
 * it in the engine instead would mean two things fitting the same content and
 * disagreeing about the result.
 *
 * `null` (the `design` sentinel) means "fill the host" — no constraint.
 */
export function playHostAspectStyle(
  device: string,
  orientation: 'portrait' | 'landscape',
  presets?: readonly ProjectScreenPreset[],
): React.CSSProperties | null {
  const d = deviceDims(device, orientation, presets);
  if (!d) return null;
  return { aspectRatio: `${d.w} / ${d.h}`, maxWidth: '100%', maxHeight: '100%', width: 'auto', height: '100%' };
}

/** Label for the status readout: the simulated screen's pixel size, or null. */
export function targetScreenLabel(
  device: string,
  orientation: 'portrait' | 'landscape',
  presets?: readonly ProjectScreenPreset[],
): string | null {
  const d = deviceDims(device, orientation, presets);
  return d ? `${d.w} × ${d.h}` : null;
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Transport.tsx
 * @brief The shared playback-transport cluster — jump-start / step-back / play-
 *        pause / step-forward / jump-end / loop toggle / frame counter — reused
 *        by every animation editor so the transport reads and behaves identically
 *        across Clip, Sequencer, and Controller.
 *
 * Purely presentational: the host owns the playback state and decides what a
 * step means (a keyframe in the Sequencer, a frame in the Flipbook editor) by
 * wiring the handlers and overriding the step tooltips. Every affordance except
 * play/pause is optional, so a minimal preview can show just the play button.
 */
import type { ReactNode } from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Play, Pause, Repeat } from 'lucide-react';
import { IconButton } from './IconButton';
import { t } from '@/i18n';

export interface TransportProps {
  playing: boolean;
  onPlayPause: () => void;
  onJumpStart?: () => void;
  onJumpEnd?: () => void;
  onStepBack?: () => void;
  onStepForward?: () => void;
  /** Override the step tooltips (e.g. "Previous keyframe" vs the default "Previous"). */
  stepBackTitle?: string;
  stepForwardTitle?: string;
  loop?: boolean;
  onToggleLoop?: () => void;
  /** Current frame and total; when both are set, renders the frame counter. */
  frame?: number;
  frameCount?: number;
  /** Extra affordances rendered after the counter (kept host-specific). */
  extra?: ReactNode;
  className?: string;
}

export function Transport(props: TransportProps) {
  const {
    playing, onPlayPause, onJumpStart, onJumpEnd, onStepBack, onStepForward,
    stepBackTitle, stepForwardTitle, loop, onToggleLoop, frame, frameCount, extra, className,
  } = props;
  return (
    <div className={`transport${className ? ` ${className}` : ''}`}>
      {onJumpStart && (
        <IconButton size="md" title={t('transport.jumpStart')} onClick={onJumpStart}><ChevronFirst size={15} /></IconButton>
      )}
      {onStepBack && (
        <IconButton size="md" title={stepBackTitle ?? t('transport.stepBack')} onClick={onStepBack}><ChevronLeft size={15} /></IconButton>
      )}
      <button type="button" className="transport__play" title={t('transport.playPause')} onClick={onPlayPause}>
        {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </button>
      {onStepForward && (
        <IconButton size="md" title={stepForwardTitle ?? t('transport.stepForward')} onClick={onStepForward}><ChevronRight size={15} /></IconButton>
      )}
      {onJumpEnd && (
        <IconButton size="md" title={t('transport.jumpEnd')} onClick={onJumpEnd}><ChevronLast size={15} /></IconButton>
      )}
      {onToggleLoop && (
        <IconButton size="md" active={loop} title={t('transport.loop')} onClick={onToggleLoop}><Repeat size={14} /></IconButton>
      )}
      {frame != null && frameCount != null && (
        <>
          <span className="transport__div" />
          <span className="transport__frame">{t('transport.frameWord')} <strong>{frame}</strong> / {frameCount}</span>
        </>
      )}
      {extra}
    </div>
  );
}

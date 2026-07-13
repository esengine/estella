// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AudioWavePreview.tsx
 * @brief   Waveform + transport for the audio asset inspector: fetches the
 *          clip over estella://, decodes it once (a module-level AudioContext,
 *          decode-only), draws min/max peak columns on a canvas, and drives a
 *          plain <audio> element for play/pause/click-seek with a playhead.
 */
import { useEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { t } from '@/i18n';

let decodeCtx: AudioContext | null = null;
const decoder = (): AudioContext => (decodeCtx ??= new AudioContext());

interface WaveInfo {
  peaks: Float32Array; // interleaved min,max per column
  duration: number;
  channels: number;
  sampleRate: number;
}

const COLUMNS = 400;

async function loadWave(path: string): Promise<WaveInfo> {
  const bytes = await (await fetch(`estella://project/${path}`)).arrayBuffer();
  const buffer = await decoder().decodeAudioData(bytes);
  const peaks = new Float32Array(COLUMNS * 2);
  const data = buffer.getChannelData(0);
  const second = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const step = data.length / COLUMNS;
  for (let c = 0; c < COLUMNS; c++) {
    let min = 0;
    let max = 0;
    const start = Math.floor(c * step);
    const end = Math.min(data.length, Math.ceil((c + 1) * step));
    for (let i = start; i < end; i++) {
      const v = second ? (data[i] + second[i]) * 0.5 : data[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks[c * 2] = min;
    peaks[c * 2 + 1] = max;
  }
  return { peaks, duration: buffer.duration, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate };
}

function drawWave(canvas: HTMLCanvasElement, wave: WaveInfo | null, progress: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!wave) return;
  const styles = getComputedStyle(canvas);
  const base = styles.getPropertyValue('--star').trim() || '#6ea8ff';
  const dim = styles.getPropertyValue('--text-faint').trim() || '#666';
  const mid = h / 2;
  const colW = w / COLUMNS;
  const playedCols = Math.floor(progress * COLUMNS);
  for (let c = 0; c < COLUMNS; c++) {
    const min = wave.peaks[c * 2];
    const max = wave.peaks[c * 2 + 1];
    ctx.fillStyle = c <= playedCols && progress > 0 ? base : dim;
    const top = mid + min * (mid - 2);
    const bottom = mid + max * (mid - 2);
    ctx.fillRect(c * colW, Math.min(top, bottom), Math.max(1, colW - 0.5), Math.max(1, Math.abs(bottom - top)));
  }
  if (progress > 0) {
    ctx.fillStyle = base;
    ctx.fillRect(progress * w - 0.5, 0, 1, h);
  }
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function AudioWavePreview({ path }: { path: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [wave, setWave] = useState<WaveInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let alive = true;
    setWave(null);
    setFailed(false);
    setPlaying(false);
    setProgress(0);
    void loadWave(path)
      .then((v) => alive && setWave(v))
      .catch(() => alive && setFailed(true));
    const audio = new Audio(`estella://project/${path}`);
    audioRef.current = audio;
    const onTime = () => setProgress(audio.duration > 0 ? audio.currentTime / audio.duration : 0);
    const onEnd = () => { setPlaying(false); setProgress(0); };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    return () => {
      alive = false;
      audio.pause();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
      audioRef.current = null;
    };
  }, [path]);

  useEffect(() => {
    if (canvasRef.current) drawWave(canvasRef.current, wave, progress);
  }, [wave, progress]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      void audio.play();
      setPlaying(true);
    }
  };

  const seek = (e: React.MouseEvent) => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas || !Number.isFinite(audio.duration)) return;
    const r = canvas.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    audio.currentTime = p * audio.duration;
    setProgress(p);
  };

  return (
    <div className="awp">
      <canvas ref={canvasRef} className="awp-wave" onClick={seek} title={t('det.audioSeekTip')} />
      <div className="awp-bar">
        <button type="button" className="awp-play" onClick={toggle} title={t('det.audioPlayTip')}>
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <span className="awp-meta">
          {failed
            ? t('det.audioDecodeFailed')
            : wave
              ? `${fmtTime(wave.duration)} · ${wave.channels} ch · ${(wave.sampleRate / 1000).toFixed(1)} kHz`
              : '…'}
        </span>
      </div>
    </div>
  );
}

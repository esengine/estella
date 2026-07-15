// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  videoCook.ts — cook-time video transcode for the wasm decode path.
 *        WeChat's only video backend is the engine-owned MPEG-1 decoder
 *        (videodec side module), so the cook turns each authored video into a
 *        codec-tagged `.esv` (MPEG-1 Program Stream) plus an `.m4a` audio-track
 *        sibling played through the audio pipeline. Transcoding shells out to
 *        the bundled ffmpeg binary (ffmpeg-static) — a separate process, loaded
 *        lazily and only when a cook actually ships video.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Resolve the ffmpeg binary: env override first, then the bundled static
 *  build. Inside a packaged app the binary must run from the unpacked twin of
 *  the asar (executables cannot spawn from an archive). Null if unavailable. */
export async function resolveFfmpeg(): Promise<string | null> {
  if (process.env.ESTELLA_FFMPEG) return process.env.ESTELLA_FFMPEG;
  try {
    const mod = await import('ffmpeg-static');
    const p = (mod.default ?? mod) as unknown as string | null;
    return p ? p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`) : null;
  } catch {
    return null;
  }
}

function run(bin: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stderr }));
  });
}

export interface VideoImportSettings {
  /** mpeg1video quantizer (2 = near-lossless, larger = smaller file). */
  quality: number;
  audioBitrateKbps: number;
}

/** Per-asset video import settings from the `.meta` importer block (tolerant). */
export function videoImportSettings(importer: Record<string, unknown> | undefined): VideoImportSettings {
  const q = importer?.quality;
  const kbps = importer?.audioBitrateKbps;
  return {
    quality: typeof q === 'number' && q >= 2 && q <= 31 ? Math.round(q) : 4,
    audioBitrateKbps: kbps === 96 || kbps === 128 || kbps === 192 ? (kbps as number) : 128,
  };
}

export interface VideoCookResult {
  /** MPEG-1 PS bytes, or null when the transcode failed. */
  esv: Uint8Array | null;
  /** AAC (m4a) audio track, or null when the source has none. */
  audio: Uint8Array | null;
  warnings: string[];
}

// MPEG-1 dimensions must be even (macroblock chroma), and its frame rate is a
// fixed table — sources with a rate outside it are resampled on retry.
const EVEN_SCALE = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

/**
 * Transcode `srcAbs` into the wasm decode path's artifacts. Video failures are
 * reported (esv null); a missing audio track is normal and silent.
 */
export async function transcodeVideoForWasm(
  srcAbs: string,
  settings: VideoImportSettings,
): Promise<VideoCookResult> {
  const warnings: string[] = [];
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) {
    return { esv: null, audio: null, warnings: ['ffmpeg unavailable — cannot transcode video for the wasm decoder'] };
  }
  const tmp = await mkdtemp(path.join(tmpdir(), 'estella-video-'));
  try {
    const esvPath = path.join(tmp, 'out.esv');
    const videoArgs = (extraFilter: string) => [
      '-y', '-i', srcAbs, '-an',
      '-c:v', 'mpeg1video', '-q:v', String(settings.quality),
      '-vf', extraFilter ? `${EVEN_SCALE},${extraFilter}` : EVEN_SCALE,
      '-f', 'mpeg', esvPath,
    ];
    let res = await run(ffmpeg, videoArgs(''));
    if (res.code !== 0 && /fps|frame ?rate/i.test(res.stderr)) {
      // Source frame rate is outside MPEG-1's table (or variable) — resample.
      res = await run(ffmpeg, videoArgs('fps=30'));
    }
    let esv: Uint8Array | null = null;
    if (res.code === 0) {
      esv = new Uint8Array(await readFile(esvPath));
    } else {
      warnings.push(`video transcode failed: ${lastLine(res.stderr)}`);
    }

    const m4aPath = path.join(tmp, 'out.m4a');
    const audioRes = await run(ffmpeg, [
      '-y', '-i', srcAbs, '-vn',
      '-c:a', 'aac', '-b:a', `${settings.audioBitrateKbps}k`,
      '-f', 'ipod', m4aPath,
    ]);
    let audio: Uint8Array | null = null;
    if (audioRes.code === 0) {
      audio = new Uint8Array(await readFile(m4aPath));
    } else if (!/does not contain any stream|Stream map .* matches no streams|no audio/i.test(audioRes.stderr)) {
      warnings.push(`audio track extract failed: ${lastLine(audioRes.stderr)}`);
    }
    return { esv, audio, warnings };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

function lastLine(stderr: string): string {
  const lines = stderr.trim().split('\n');
  return lines[lines.length - 1] ?? 'unknown ffmpeg error';
}

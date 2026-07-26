// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  orientationHtml.ts — the WEB export's orientation pin, for the ONE
 *        project-wide orientation (format.ts resolveOrientation): in the wrong device
 *        orientation the canvas is hidden and a "rotate your device" overlay shows;
 *        screen.orientation.lock() is attempted best-effort (it only takes in
 *        fullscreen / on some browsers, so the CSS overlay is the universal fallback).
 *
 *        Web only, on purpose. A page a player opened in their own browser CAN be
 *        rotated, and there the media query reports the device. A playable lives in an
 *        SDK-sized container whose aspect the phone does not govern, so the same
 *        overlay would hide the game for good — it stays responsive instead
 *        (exportPlayable). WeChat pins orientation via game.json deviceOrientation,
 *        and desktop sizes its own window.
 */
import { createHash } from 'node:crypto';

export type ScreenOrientation = 'portrait' | 'landscape';

/** CSS pinning the canvas to `orientation`: the `#rotate-hint` overlay replaces the
 *  canvas whenever the device is turned the wrong way. */
export function orientationCss(orientation: ScreenOrientation): string {
  const wrong = orientation === 'landscape' ? 'portrait' : 'landscape';
  return (
    '#rotate-hint{display:none;position:fixed;inset:0;z-index:10;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:16px;background:#0e121b;color:#c7d0e0;' +
    "font:600 15px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center;padding:24px;}" +
    '#rotate-hint .rotate-glyph{font-size:44px;animation:rotate-nudge 1.8s ease-in-out infinite;}' +
    '@keyframes rotate-nudge{0%,55%{transform:rotate(0)}75%,100%{transform:rotate(-90deg)}}' +
    `@media (orientation:${wrong}){#canvas{display:none!important;}#rotate-hint{display:flex;}}`
  );
}

/** The overlay markup shown in the wrong orientation — sits alongside the canvas. */
export function orientationOverlayHtml(orientation: ScreenOrientation): string {
  return `<div id="rotate-hint" role="alert"><div class="rotate-glyph">📱</div><p>Rotate your device to ${orientation}</p></div>`;
}

function orientationLockJs(orientation: ScreenOrientation): string {
  return `try{var o=screen.orientation;o&&o.lock&&o.lock(${JSON.stringify(orientation)}).catch(function(){});}catch(e){}`;
}

/** Best-effort orientation lock. Silently ignored where unsupported (the CSS overlay
 *  covers those cases); a raw <script> so both the web and inlined-playable pages use it. */
export function orientationLockScript(orientation: ScreenOrientation): string {
  return `<script>${orientationLockJs(orientation)}</script>`;
}

/** The lock script's CSP hash. A page that pins `script-src` MUST list it, or the
 *  browser blocks the inline script and the lock silently never runs. */
export function orientationLockCspHash(orientation: ScreenOrientation): string {
  return `sha256-${createHash('sha256').update(orientationLockJs(orientation)).digest('base64')}`;
}

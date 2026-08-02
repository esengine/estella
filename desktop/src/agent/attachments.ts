// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    attachments.ts
 * @brief   Turning an image the person dropped, pasted or picked into something
 *          worth sending.
 *
 * The reduction happens HERE, in the window, because this is the side with a
 * canvas and because everything downstream pays for the original otherwise: it
 * crosses the IPC bridge, sits in the model's memory for the rest of the
 * conversation, and is written to disk with it every turn. A 12-megapixel photo
 * and a legible 1568px one cost the model the same to look at.
 */

/** The formats a model will look at. Anything else is refused by name. */
const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * The long edge an image is reduced to.
 *
 * Above roughly this, providers scale the image down themselves before reading
 * it — so the extra pixels buy nothing and are paid for at every step on the way.
 */
const MAX_EDGE = 1568;

/** Below this there is nothing to gain: re-encoding would only lose detail. */
const REENCODE_ABOVE_BYTES = 256 * 1024;

export interface Attachment {
  /** Stable for the life of the draft, so a list can key on it. */
  id: string;
  name: string;
  mediaType: string;
  /** Base64, no `data:` prefix — what crosses the bridge. */
  data: string;
  /** For the thumbnail beside the composer. */
  url: string;
  bytes: number;
}

export class UnsupportedImage extends Error {}

let nextId = 0;

/**
 * Read a file into an attachment, reduced if it is worth reducing.
 *
 * An animated GIF is passed through untouched: drawing one to a canvas keeps
 * the first frame and silently throws the animation away, and a model shown one
 * still frame of something the person sent as a sequence has been misled about
 * what it is looking at.
 */
export async function readAttachment(file: File | Blob, name = ''): Promise<Attachment> {
  const type = file.type || 'image/png';
  if (!ACCEPTED.has(type)) throw new UnsupportedImage(type);

  const label = name || (file instanceof File ? file.name : 'image');
  // Only a GIF is passed through unseen. Byte size alone cannot decide: a flat
  // 2400px screenshot compresses to well under any threshold you would pick,
  // and would then be sent at a resolution the model scales down anyway.
  const { blob, mediaType } = type === 'image/gif'
    ? { blob: file, mediaType: type }
    : await reduce(file, type);

  const dataUrl = await asDataUrl(blob);
  const comma = dataUrl.indexOf(',');
  return {
    id: `att-${++nextId}`,
    name: label,
    mediaType,
    data: dataUrl.slice(comma + 1),
    url: dataUrl,
    bytes: blob.size,
  };
}

/** Every image among some dropped/pasted items, in order; non-images ignored. */
export async function readImageItems(
  items: readonly DataTransferItem[] | DataTransferItemList,
): Promise<Attachment[]> {
  const files: File[] = [];
  for (const item of Array.from(items as ArrayLike<DataTransferItem>)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && file.type.startsWith('image/')) files.push(file);
  }
  const out: Attachment[] = [];
  for (const file of files) {
    try { out.push(await readAttachment(file)); } catch { /* not one a model reads */ }
  }
  return out;
}

/** Draw it down to {@link MAX_EDGE} on its long side. Transparency survives:
 *  a PNG stays a PNG, because a UI mock flattened onto black is a different
 *  picture from the one that was sent. */
async function reduce(file: Blob, type: string): Promise<{ blob: Blob; mediaType: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    // Small enough to send and light enough not to bother: re-encoding here
    // could only lose detail.
    if (scale === 1 && file.size <= REENCODE_ABOVE_BYTES) return { blob: file, mediaType: type };
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob: file, mediaType: type };
    ctx.drawImage(bitmap, 0, 0, w, h);

    const out = type === 'image/png' ? 'image/png' : 'image/jpeg';
    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, out, out === 'image/jpeg' ? 0.85 : undefined);
    });
    // Re-encoding can come out LARGER than the original (a small photo saved as
    // PNG, say). Keeping the bigger one would be paying for the conversion.
    if (!encoded || encoded.size >= file.size) return { blob: file, mediaType: type };
    return { blob: encoded, mediaType: out };
  } finally {
    bitmap.close();
  }
}

const asDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

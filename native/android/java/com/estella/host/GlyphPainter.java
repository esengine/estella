// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
package com.estella.host;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;

import java.io.File;
import java.nio.ByteBuffer;
import java.util.HashMap;

/**
 * The platform's own rasterizer, for a face the shared one cannot read.
 *
 * Android's system CJK font (NotoSansCJK-Regular.ttc on Android 16) is a variable
 * font with CFF2 outlines, which stb_truetype does not parse, so the native glyph
 * path drew no CJK text from the system font at all. This draws the SAME face the
 * font matcher chose (the file and the collection index it answered), as Core Text
 * does on Apple, and hands back coverage in the shape Platform::GlyphCoverage
 * holds; the distance field and the atlas tile are made by the shared code. Called
 * only from the frame loop's thread, so the paint and the caches need no lock.
 */
final class GlyphPainter {
    private GlyphPainter() {}

    /** Typefaces by "path#index": built once, as the shared path parses a face once. */
    private static final HashMap<String, Typeface> FACES = new HashMap<>();
    private static final Paint PAINT = new Paint(Paint.ANTI_ALIAS_FLAG);
    private static final Path PATH = new Path();
    private static final RectF BOX = new RectF();
    private static final Rect BOUNDS = new Rect();
    /** The oblique shear the shared rasterizer synthesizes italic with (FreeType's 12 degrees). */
    private static final float OBLIQUE_SHEAR = 0.2126f;

    private static Typeface face(String path, int index) {
        final String key = path + '#' + index;
        if (FACES.containsKey(key)) return FACES.get(key);
        Typeface face = null;
        try {
            face = new Typeface.Builder(new File(path)).setTtcIndex(index).build();
        } catch (RuntimeException e) {
            face = null;
        }
        FACES.put(key, face);   // a failure too, so it is not retried for every glyph
        return face;
    }

    /**
     * Draws @p codepoint from face @p index of @p path at @p pixelSize times @p supersample.
     *
     * @param metrics out: width, height (supersampled px, padding included), advance, bearingX, bearingY (the tile's
     *                top-left in pen space, y up, at the asked size), blank (1 for whitespace).
     * @return the coverage, width * height bytes, top row first; an empty array for a blank glyph; null when the face
     *         cannot be built or has no glyph for the codepoint.
     */
    static byte[] draw(String path, int index, int codepoint, float pixelSize, int supersample, int padding,
                       boolean syntheticBold, boolean syntheticItalic, float[] metrics) {
        final Typeface face = face(path, index);
        if (face == null || pixelSize <= 0 || metrics == null || metrics.length < 6) return null;
        final int ss = Math.max(supersample, 1);
        final String text = new String(Character.toChars(codepoint));

        final Paint p = PAINT;
        p.setTypeface(face);
        p.setTextSize(pixelSize * ss);
        p.setFakeBoldText(syntheticBold);
        p.setTextSkewX(syntheticItalic ? -OBLIQUE_SHEAR : 0f);
        p.setColor(0xFFFFFFFF);
        if (!p.hasGlyph(text)) return null;

        metrics[2] = p.measureText(text) / ss;
        // The ink box, y down from the baseline. Sheared, it has to come from the outline, since a text-bounds query reports
        // the upright glyph; upright, that query is the cheap way. Fake bold strokes past both, so it is widened by that.
        if (syntheticItalic) {
            p.getTextPath(text, 0, text.length(), 0f, 0f, PATH);
            PATH.computeBounds(BOX, true);
        } else {
            p.getTextBounds(text, 0, text.length(), BOUNDS);
            BOX.set(BOUNDS);
        }
        if (BOX.isEmpty()) {
            metrics[0] = 0; metrics[1] = 0; metrics[3] = 0; metrics[4] = 0; metrics[5] = 1;
            return new byte[0];
        }
        final float grow = syntheticBold ? pixelSize * ss / 24f : 0f;
        final int x0 = (int) Math.floor(BOX.left - grow);
        final int top = (int) Math.floor(BOX.top - grow);
        final int inkW = (int) Math.ceil(BOX.right + grow) - x0;
        final int inkH = (int) Math.ceil(BOX.bottom + grow) - top;

        // Padding is in stored px, so the tile is sized there and multiplied up: the grid stays an exact multiple of
        // the supersample, as the shared path's does.
        final int w = (inkW + ss - 1) / ss + padding * 2;
        final int h = (inkH + ss - 1) / ss + padding * 2;
        final int wss = w * ss;
        final int hss = h * ss;

        final Bitmap bitmap = Bitmap.createBitmap(wss, hss, Bitmap.Config.ALPHA_8);
        // The ink's top-left `padding` stored px in from the tile's.
        new Canvas(bitmap).drawText(text, padding * ss - x0, padding * ss - top, p);
        final int stride = bitmap.getRowBytes();
        final byte[] rows = new byte[stride * hss];
        bitmap.copyPixelsToBuffer(ByteBuffer.wrap(rows));
        bitmap.recycle();
        byte[] alpha = rows;
        if (stride != wss) {
            alpha = new byte[wss * hss];
            for (int y = 0; y < hss; y++) System.arraycopy(rows, y * stride, alpha, y * wss, wss);
        }

        metrics[0] = wss;
        metrics[1] = hss;
        metrics[3] = (float) x0 / ss - padding;
        metrics[4] = (float) -top / ss + padding;
        metrics[5] = 0;
        return alpha;
    }
}

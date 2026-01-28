#!/usr/bin/env python3
"""
Bitmap Font Packer for ESEngine

Generates a font atlas (PNG) and metrics file (JSON) from a TTF font.
Only includes specified characters to minimize file size.

Usage:
    python pack_bitmap_font.py --font font.ttf --size 32 --chars chars.txt --output output_prefix

Requirements:
    pip install Pillow freetype-py
"""

import argparse
import json
import math
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
    import freetype
except ImportError:
    print("Error: Required packages not installed.")
    print("Run: pip install Pillow freetype-py")
    sys.exit(1)


# Common Chinese characters (most frequently used ~500)
COMMON_CHINESE = """
的一是不了在人有我他这为之大来以个中上们到说国和地也子时道出而要于就下得可你年生自会那后能对着事其里所去行过家十用发天如然作方成者多日都三小军二无同主经长儿母开看起五当已从心进动战么定现并系由问表所向间位与变使关十化法务高外政美全何济体建各明记力史样合接治电办点代新期活式特程通等门应反今共因解运第五外科员直象利文气军程取九原平代美安名回做基任入名至结党声各调组展空求路务员级教海完带象体月明便处象界权表电加即反
"""

# ASCII printable characters
ASCII_CHARS = ''.join(chr(i) for i in range(32, 127))


def get_default_chars():
    """Get default character set: ASCII + common Chinese"""
    return ASCII_CHARS + COMMON_CHINESE.replace('\n', '').replace(' ', '')


def load_chars_from_file(filepath):
    """Load characters from a text file"""
    with open(filepath, 'r', encoding='utf-8') as f:
        chars = f.read()
    # Remove whitespace and duplicates while preserving order
    seen = set()
    result = []
    for c in chars:
        if c not in seen and c.strip():
            seen.add(c)
            result.append(c)
    return ''.join(result)


def pack_font(font_path, font_size, chars, output_prefix, padding=2, atlas_size=1024):
    """
    Pack font glyphs into an atlas

    Args:
        font_path: Path to TTF font
        font_size: Font size in pixels
        chars: String of characters to include
        output_prefix: Output path prefix (will create .png and .json)
        padding: Padding between glyphs
        atlas_size: Maximum atlas size
    """
    # Load font
    face = freetype.Face(font_path)
    face.set_pixel_sizes(0, font_size)

    # Calculate metrics
    ascent = face.size.ascender >> 6
    descent = -(face.size.descender >> 6)
    line_height = (face.size.height >> 6)

    # First pass: measure all glyphs
    glyph_data = []
    for char in chars:
        try:
            face.load_char(char, freetype.FT_LOAD_RENDER)
            glyph = face.glyph
            bitmap = glyph.bitmap

            glyph_data.append({
                'char': char,
                'codepoint': ord(char),
                'width': bitmap.width,
                'height': bitmap.rows,
                'bearingX': glyph.bitmap_left,
                'bearingY': glyph.bitmap_top,
                'advance': glyph.advance.x >> 6,
                'buffer': bytes(bitmap.buffer) if bitmap.buffer else b'',
                'pitch': bitmap.pitch
            })
        except Exception as e:
            print(f"Warning: Failed to load glyph '{char}' (U+{ord(char):04X}): {e}")

    if not glyph_data:
        print("Error: No glyphs loaded")
        return False

    # Sort by height for better packing
    glyph_data.sort(key=lambda g: -g['height'])

    # Calculate atlas size needed
    total_area = sum((g['width'] + padding) * (g['height'] + padding) for g in glyph_data)
    min_size = int(math.sqrt(total_area) * 1.2)
    atlas_width = min(atlas_size, max(256, 2 ** math.ceil(math.log2(min_size))))
    atlas_height = atlas_width

    # Pack glyphs (simple row-based packing)
    atlas = Image.new('RGBA', (atlas_width, atlas_height), (0, 0, 0, 0))

    x, y = padding, padding
    row_height = 0

    metrics = {
        'fontSize': font_size,
        'lineHeight': line_height,
        'ascent': ascent,
        'descent': descent,
        'atlasWidth': atlas_width,
        'atlasHeight': atlas_height,
        'glyphs': []
    }

    for glyph in glyph_data:
        w, h = glyph['width'], glyph['height']

        # Check if we need to move to next row
        if x + w + padding > atlas_width:
            x = padding
            y += row_height + padding
            row_height = 0

        # Check if atlas is full
        if y + h + padding > atlas_height:
            # Try larger atlas
            if atlas_width < atlas_size:
                print(f"Warning: Atlas full, increasing size from {atlas_width} to {atlas_width * 2}")
                return pack_font(font_path, font_size, chars, output_prefix,
                               padding, min(atlas_size, atlas_width * 2))
            else:
                print(f"Error: Atlas full, couldn't fit all glyphs")
                break

        # Draw glyph
        if w > 0 and h > 0 and glyph['buffer']:
            glyph_img = Image.new('L', (w, h))
            # Copy bitmap data row by row
            for row in range(h):
                for col in range(w):
                    idx = row * glyph['pitch'] + col
                    if idx < len(glyph['buffer']):
                        glyph_img.putpixel((col, row), glyph['buffer'][idx])

            # Convert to RGBA (white text with alpha)
            rgba_img = Image.new('RGBA', (w, h))
            for py in range(h):
                for px in range(w):
                    alpha = glyph_img.getpixel((px, py))
                    rgba_img.putpixel((px, py), (255, 255, 255, alpha))

            atlas.paste(rgba_img, (x, y))

        # Store metrics
        metrics['glyphs'].append({
            'char': glyph['char'],
            'codepoint': glyph['codepoint'],
            'width': float(w),
            'height': float(h),
            'bearingX': float(glyph['bearingX']),
            'bearingY': float(glyph['bearingY']),
            'advance': float(glyph['advance']),
            'u0': x / atlas_width,
            'v0': y / atlas_height,
            'u1': (x + w) / atlas_width,
            'v1': (y + h) / atlas_height
        })

        # Move position
        x += w + padding
        row_height = max(row_height, h)

    # Save outputs
    atlas_path = f"{output_prefix}.png"
    metrics_path = f"{output_prefix}.json"

    atlas.save(atlas_path, 'PNG', optimize=True)

    with open(metrics_path, 'w', encoding='utf-8') as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)

    print(f"Generated: {atlas_path} ({atlas_width}x{atlas_height})")
    print(f"Generated: {metrics_path} ({len(metrics['glyphs'])} glyphs)")
    print(f"Atlas size: {Path(atlas_path).stat().st_size / 1024:.1f} KB")

    return True


def main():
    parser = argparse.ArgumentParser(description='Pack bitmap font for ESEngine')
    parser.add_argument('--font', '-f', required=True, help='Input TTF font path')
    parser.add_argument('--size', '-s', type=int, default=32, help='Font size in pixels')
    parser.add_argument('--chars', '-c', help='File containing characters to include')
    parser.add_argument('--output', '-o', required=True, help='Output path prefix')
    parser.add_argument('--padding', '-p', type=int, default=2, help='Padding between glyphs')
    parser.add_argument('--atlas-size', type=int, default=2048, help='Maximum atlas size')
    parser.add_argument('--ascii-only', action='store_true', help='Only include ASCII characters')

    args = parser.parse_args()

    # Determine character set
    if args.ascii_only:
        chars = ASCII_CHARS
    elif args.chars:
        chars = load_chars_from_file(args.chars)
    else:
        chars = get_default_chars()

    print(f"Font: {args.font}")
    print(f"Size: {args.size}px")
    print(f"Characters: {len(chars)}")

    success = pack_font(
        args.font,
        args.size,
        chars,
        args.output,
        args.padding,
        args.atlas_size
    )

    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()

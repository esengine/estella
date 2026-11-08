"""Editable HUD borders and pictograms, measured against the 1672 x 940 design.

These shapes stay independent of the inventory atlas and map artwork, so
rebuilding a border never overwrites art. Text and live values are native UI.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parents[1] / 'assets/textures'
S = 4
CYAN = (47, 204, 231, 255)
PINK = (239, 34, 159, 255)


def panel(name, w, h, accents, fill=(3, 15, 23, 215)):
    im = Image.new('RGBA', (w*S, h*S))
    d = ImageDraw.Draw(im)
    def line(points, color, width=1):
        d.line([(round(x*S), round(y*S)) for x, y in points], fill=color, width=round(width*S), joint='curve')
    polygon = [(10, 1), (w-10, 1), (w-1, 10), (w-1, h-10), (w-10, h-1), (10, h-1), (1, h-10), (1, 10)]
    d.polygon([(x*S, y*S) for x, y in polygon], fill=fill)
    line(polygon+[polygon[0]], (71, 122, 142, 230), .9)
    paths = {
        'tl': [(1, 36), (1, 11), (11, 1), (51, 1)],
        'tr': [(w-24, 1), (w-11, 1), (w-1, 11), (w-1, 24)],
        'br': [(w-1, h-25), (w-1, h-11), (w-11, h-1), (w-47, h-1)],
        'bl': [(1, h-27), (1, h-11), (11, h-1), (37, h-1)],
    }
    for corner, color in accents.items(): line(paths[corner], color, 1.8)
    im.resize((w, h), Image.Resampling.LANCZOS).save(OUT/f'{name}.png')


panel('hud-location', 260, 98, {'tl': CYAN})
panel('hud-objectives', 260, 110, {'tl': PINK, 'br': CYAN})
panel('hud-vitals', 260, 174, {'tl': CYAN, 'tr': PINK, 'bl': CYAN})
panel('hud-build', 260, 188, {'tl': PINK, 'br': PINK, 'bl': CYAN}, (2, 15, 23, 238))
panel('hud-minimap-frame', 240, 198, {'tl': PINK, 'tr': PINK, 'bl': CYAN}, (0, 0, 0, 0))
panel('hud-hint', 378, 42, {'tl': (105, 167, 184, 240)}, (4, 16, 24, 215))

im = Image.new('RGBA', (94*S, 96*S))
d = ImageDraw.Draw(im)
d.rounded_rectangle((S, S, 93*S, 95*S), 4*S, fill=(2, 14, 21, 230), outline=(110, 147, 156, 245), width=S)
d.rounded_rectangle((4*S, 4*S, 90*S, 92*S), 3*S, outline=(28, 55, 64, 210), width=S)
im.resize((94, 96), Image.Resampling.LANCZOS).save(OUT/'hud-slot.png')

im = Image.new('RGBA', (108*S, 110*S))
d = ImageDraw.Draw(im)
d.rounded_rectangle((7*S, 7*S, 101*S, 103*S), 5*S, outline=(0, 227, 255, 210), width=6*S)
im = im.filter(ImageFilter.GaussianBlur(3*S))
d = ImageDraw.Draw(im)
d.rounded_rectangle((7*S, 7*S, 101*S, 103*S), 4*S, outline=(100, 244, 255, 255), width=2*S)
d.line([(7*S, 26*S), (7*S, 13*S), (13*S, 7*S), (48*S, 7*S)], fill=(205, 255, 255), width=2*S)
im.resize((108, 110), Image.Resampling.LANCZOS).save(OUT/'hud-selected.png')

for checked in [False, True]:
    im = Image.new('RGBA', (24*S, 24*S)); d = ImageDraw.Draw(im)
    color = (58, 255, 129, 255) if checked else (195, 220, 229, 255)
    d.rectangle((3*S, 3*S, 21*S, 21*S), outline=color, width=S)
    if checked: d.line([(6*S, 12*S), (10*S, 17*S), (18*S, 7*S)], fill=color, width=2*S)
    im.resize((24, 24), Image.Resampling.LANCZOS).save(OUT/('hud-check-on.png' if checked else 'hud-check-off.png'))

im = Image.new('RGBA', (28*S, 28*S)); d = ImageDraw.Draw(im)
d.ellipse((2*S, 2*S, 26*S, 26*S), fill=(54, 255, 129, 255))
d.line([(8*S, 14*S), (12*S, 18*S), (21*S, 9*S)], fill=(0, 41, 23, 255), width=3*S)
im.resize((28, 28), Image.Resampling.LANCZOS).save(OUT/'hud-build-valid.png')
im = Image.new('RGBA', (32*S, 32*S)); d = ImageDraw.Draw(im)
d.rounded_rectangle((S, S, 31*S, 31*S), 4*S, fill=(6, 22, 30, 180), outline=(183, 207, 214, 255), width=S)
im.resize((32, 32), Image.Resampling.LANCZOS).save(OUT/'hud-keycap.png')
print('HUD panels and status symbols rebuilt.')

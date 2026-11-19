"""Build the scene's texture sizes from the imported full-resolution artwork."""
from pathlib import Path

import numpy as np
from PIL import Image


assets = Path(__file__).resolve().parents[1] / "assets"
for source, target, size in (
    ("shrine/anemo-statue_0.jpg", "shrine/windrise-stone.jpg", 1024),
    ("character/lumine-final_2.jpg", "character/lumine-field.jpg", 2048),
):
    with Image.open(assets / source) as image:
        image.thumbnail((size, size), Image.Resampling.LANCZOS)
        image.convert("RGB").save(assets / target, quality=95, subsampling=0, optimize=True)

# Average the tangent-space normals as vectors and restore their unit length.
with Image.open(assets / "shrine/anemo-statue_2.png") as image:
    image = image.convert("RGB").resize((1024, 1024), Image.Resampling.BOX)
    normals = np.asarray(image).astype(np.float32) / 127.5 - 1
    normals /= np.maximum(np.linalg.norm(normals, axis=2, keepdims=True), 1e-6)
    pixels = np.rint(np.clip(normals * 127.5 + 127.5, 0, 255)).astype(np.uint8)
    Image.fromarray(pixels).save(assets / "shrine/windrise-normal.png", optimize=True)

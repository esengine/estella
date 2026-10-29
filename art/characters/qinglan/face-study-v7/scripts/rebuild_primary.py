"""Refine the mouth field as a rigid oral band, preserving the lip structure."""
import bpy,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT/'scripts'))
import identity_cage as I
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-identity-cage.blend'))
I.rebuild(jaw_strength=.65)
I.secondary_volume(cheek_fill=.006)
I.fit_globes();I.fit_irises()
I.save_main()
print('PRIMARY_FIELD_REBUILT',flush=True)

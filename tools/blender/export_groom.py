# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
"""
Exports Blender hair curves as an Estella groom: a `.escurves` file of the geometry and a `.esgroom` beside it.

Each Curves object is a group, in the order given (or by name). Within an object, an integer curve attribute `groom_group_id`
(or `group_id`) splits it into several groups, and a boolean curve attribute `groom_guide` marks the curves that are guides rather
than rendered strands. What else the curves carry is kept: the `radius` per point (a `--radius` stands in where there is none), the
root's `surface_uv_coordinate` per curve, a `color` per point, a `clump_id` per curve.

Positions are written in metres, Y up, with the object's transform applied. Re-exporting over an existing `.esgroom` keeps the settings
authored in the engine for each group (by index) and replaces only the curves.

Run without a window:

    blender --background scene.blend --python tools/blender/export_groom.py -- --out assets/fur/meerkat.esgroom [--objects Body,Whiskers] [--radius 0.0001]

or from Blender's own Python: `export_groom([obj, ...], "/path/meerkat.esgroom")`. The format is sdk/src/groom/groomFormat.ts.
"""
import json
import os
import struct
import sys

import bpy
import numpy as np

CURVES_MAGIC = 0x56435345
CURVES_VERSION = 1
GROOM_FORMAT_VERSION = 1
ROOT_UV, COLOR, CLUMP_ID = 1, 2, 4


def _attr(data, name, domain):
    a = data.attributes.get(name)
    return a if a is not None and a.domain == domain else None


def _read(attr, count, width, field):
    out = np.empty(count * width, dtype=np.float32)
    attr.data.foreach_get(field, out)
    return out


def _curve_set(positions, radii, offsets, picked, root_uv, colors, clumps):
    """The curves `picked` (indices into the object's curves) as the arrays one set of the file holds."""
    counts, pos, rad, uv, col, clump = [], [], [], [], [], []
    for c in picked:
        a, b = int(offsets[c]), int(offsets[c + 1])
        if b - a < 2:
            continue
        counts.append(b - a)
        pos.append(positions[a:b])
        rad.append(radii[a:b])
        if root_uv is not None:
            uv.append(root_uv[c])
        if colors is not None:
            col.append(colors[a:b])
        if clumps is not None:
            clump.append(clumps[c])
    s = {
        'counts': np.array(counts, dtype=np.uint16),
        'positions': np.concatenate(pos).astype(np.float32) if pos else np.zeros((0, 3), np.float32),
        'radii': np.concatenate(rad).astype(np.float32) if rad else np.zeros(0, np.float32),
    }
    if root_uv is not None and counts:
        s['rootUV'] = np.array(uv, dtype=np.float32)
    if colors is not None and counts:
        s['colors'] = np.concatenate(col).astype(np.uint8)
    if clumps is not None and counts:
        s['clumpIds'] = np.array(clump, dtype=np.uint32)
    return s


def groups_of(obj, default_radius=0.0):
    """The groups one Curves object makes: [(name, strands, guides)]."""
    data = obj.data
    n_points, n_curves = len(data.points), len(data.curves)
    offsets = np.empty(n_curves + 1, dtype=np.int32)
    data.curve_offset_data.foreach_get('value', offsets)
    local = np.empty(n_points * 3, dtype=np.float32)
    data.position_data.foreach_get('vector', local)
    local = local.reshape(-1, 3)
    m = np.array(obj.matrix_world, dtype=np.float64)
    world = local @ m[:3, :3].T + m[:3, 3]
    # Blender is Z up; the engine is Y up, -Z forward.
    positions = np.stack([world[:, 0], world[:, 2], -world[:, 1]], axis=1).astype(np.float32)
    scale = float(np.cbrt(abs(np.linalg.det(m[:3, :3])))) or 1.0
    r = _attr(data, 'radius', 'POINT')
    radii = (_read(r, n_points, 1, 'value') if r else np.full(n_points, default_radius, np.float32)) * scale
    uv_attr = _attr(data, 'surface_uv_coordinate', 'CURVE')
    root_uv = _read(uv_attr, n_curves, 2, 'vector').reshape(-1, 2) if uv_attr else None
    col_attr = _attr(data, 'color', 'POINT')
    colors = None
    if col_attr:
        field = 'color' if col_attr.data_type in ('FLOAT_COLOR', 'BYTE_COLOR') else 'vector'
        width = 4 if field == 'color' else 3
        raw = _read(col_attr, n_points, width, field).reshape(-1, width)
        if width == 3:
            raw = np.concatenate([raw, np.ones((n_points, 1), np.float32)], axis=1)
        colors = np.clip(np.round(raw * 255.0), 0, 255).astype(np.uint8)
    clump_attr = _attr(data, 'clump_id', 'CURVE')
    clumps = _read(clump_attr, n_curves, 1, 'value').astype(np.uint32) if clump_attr else None
    group_attr = _attr(data, 'groom_group_id', 'CURVE') or _attr(data, 'group_id', 'CURVE')
    ids = _read(group_attr, n_curves, 1, 'value').astype(np.int64) if group_attr else np.zeros(n_curves, np.int64)
    guide_attr = _attr(data, 'groom_guide', 'CURVE')
    guide = np.zeros(n_curves, dtype=bool)
    if guide_attr:
        g = np.empty(n_curves, dtype=bool)
        guide_attr.data.foreach_get('value', g)
        guide = g
    out = []
    unique = sorted(set(ids.tolist()))
    for gid in unique:
        mine = ids == gid
        name = obj.name if len(unique) == 1 else f'{obj.name}_{gid}'
        strands = _curve_set(positions, radii, offsets, np.nonzero(mine & ~guide)[0], root_uv, colors, clumps)
        guides = _curve_set(positions, radii, offsets, np.nonzero(mine & guide)[0], None, None, None)
        out.append((name, strands, guides))
    return out


def _pad4(buf):
    buf.extend(b'\0' * ((4 - len(buf) % 4) % 4))


def _write_set(buf, s):
    flags = (ROOT_UV if 'rootUV' in s else 0) | (COLOR if 'colors' in s else 0) | (CLUMP_ID if 'clumpIds' in s else 0)
    buf.extend(struct.pack('<III', len(s['counts']), len(s['radii']), flags))
    buf.extend(s['counts'].astype('<u2').tobytes())
    _pad4(buf)
    buf.extend(s['positions'].astype('<f4').tobytes())
    buf.extend(s['radii'].astype('<f4').tobytes())
    for key, dtype in (('rootUV', '<f4'), ('colors', 'u1'), ('clumpIds', '<u4')):
        if key in s:
            buf.extend(s[key].astype(dtype).tobytes())


def encode_curves(groups):
    buf = bytearray(struct.pack('<III', CURVES_MAGIC, CURVES_VERSION, len(groups)))
    for name, strands, guides in groups:
        raw = name.encode('utf-8')
        buf.extend(struct.pack('<H', len(raw)))
        buf.extend(raw)
        _pad4(buf)
        _write_set(buf, strands)
        _write_set(buf, guides)
    return bytes(buf)


def export_groom(objects, out_path, default_radius=0.0):
    """Writes `out_path` (.esgroom) and its .escurves beside it. Returns the groups' names and curve counts."""
    groups = []
    for obj in objects:
        if obj.type != 'CURVES':
            raise ValueError(f'{obj.name} is a {obj.type}, not hair curves')
        groups.extend(groups_of(obj, default_radius))
    if not groups:
        raise ValueError('nothing to export: no hair curves')
    base, _ = os.path.splitext(out_path)
    curves_path = base + '.escurves'
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(curves_path, 'wb') as f:
        f.write(encode_curves(groups))
    settings = []
    if os.path.exists(out_path):
        with open(out_path, encoding='utf-8') as f:
            try:
                settings = json.load(f).get('groups', [])
            except ValueError:
                settings = []
    doc = {
        'version': GROOM_FORMAT_VERSION,
        'type': 'groom',
        'curves': os.path.basename(curves_path),
        'groups': [settings[i] if i < len(settings) else {} for i in range(len(groups))],
    }
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=2)
        f.write('\n')
    return [(name, len(s['counts']), len(g['counts'])) for name, s, g in groups]


def _main(argv):
    import argparse
    p = argparse.ArgumentParser(prog='export_groom.py')
    p.add_argument('--out', required=True, help='the .esgroom to write; the .escurves goes beside it')
    p.add_argument('--objects', default='', help='comma-separated Curves objects, in group order (default: every one, by name)')
    p.add_argument('--radius', type=float, default=0.0, help='the radius, in metres, of curves that carry none')
    a = p.parse_args(argv)
    if a.objects:
        objects = [bpy.data.objects[n] for n in a.objects.split(',')]
    else:
        objects = sorted((o for o in bpy.data.objects if o.type == 'CURVES'), key=lambda o: o.name)
    for name, strands, guides in export_groom(objects, a.out, a.radius):
        print(f'groom: {name}: {strands} strands, {guides} guides')


if __name__ == '__main__':
    _main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

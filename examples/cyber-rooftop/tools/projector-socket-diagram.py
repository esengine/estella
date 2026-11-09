"""Render the actual socketed GLB with measured callouts. No replacement geometry.

All temporary lines, circles and text belong to this technical diagram only.
They are never exported to the game prefab.
"""
import bpy
import json
import math
from pathlib import Path
from mathutils import Matrix, Vector

PROJECT = Path(__file__).resolve().parents[1]
REF = PROJECT / 'references/construction-projector-v02'
MODEL = PROJECT / 'assets/models/equipment/construction-projector-v02/UC_EQ_ConstructionProjector_v02.glb'
OUT = PROJECT.parents[1] / 'output/cyber-rooftop/projector-sockets'
C = Matrix.Rotation(math.pi / 2, 4, 'X')
FRONT = -.33


def material(name, color):
    m = bpy.data.materials.new(name)
    emission = m.node_tree.nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = (*color, 1)
    emission.inputs['Strength'].default_value = 1
    m.node_tree.links.new(emission.outputs[0], m.node_tree.nodes.get('Material Output').inputs['Surface'])
    return m


def line(points, mat, radius=.00045, name='Diagram line'):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    s = curve.splines.new('POLY')
    s.points.add(len(points) - 1)
    for p, q in zip(s.points, points):
        p.co = (q[0], FRONT, q[1], 1)
    ob = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(ob)
    curve.materials.append(mat)
    return ob


def text(body, x, y, size, mat, align='LEFT'):
    curve = bpy.data.curves.new(body, 'FONT')
    curve.body = body
    curve.size = size
    curve.align_x = align
    curve.font = bpy.data.fonts.load('C:/Windows/Fonts/arial.ttf', check_existing=True)
    ob = bpy.data.objects.new(body, curve)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = (x, FRONT - .003, y)
    ob.rotation_euler.x = math.pi / 2
    curve.materials.append(mat)
    return ob


def ring(x, y, r, mat, thickness=.0005):
    line([(x + r * math.cos(a * math.tau / 48), y + r * math.sin(a * math.tau / 48))
          for a in range(49)], mat, thickness)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 40
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 2400
    scene.render.resolution_y = 1700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    scene.world.color = (.09, .09, .09)
    # A flat diagram backing plane, entirely separate from asset geometry.
    bg = material('Diagram background', (.009, .017, .027))
    mesh = bpy.data.meshes.new('Diagram backing')
    mesh.from_pydata([(-1, .4, -.1), (1, .4, -.1), (1, .4, 1), (-1, .4, 1)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new('Diagram backing', mesh)
    scene.collection.objects.link(ob)
    mesh.materials.append(bg)
    white = material('Labels', (.83, .9, 1))
    dim = material('Secondary labels', (.39, .51, .65))
    colors = {
        'grip-frame': material('Grip frame', (1, .72, .16)),
        'palm-surface': material('Palm contact', (.15, 1, .68)),
        'finger-pad-surface': material('Finger contact', (.25, .7, 1)),
        'wrap-surface': material('Wrap guide', (1, .49, .13)),
        'action-surface': material('Trigger contact', (1, .25, .48)),
        'emission-frame': material('Emission frame', (.53, 1, 1)),
    }
    profile = json.loads((REF / 'grasp-profile.json').read_text())
    sockets = profile['sockets']
    positions = {s['name']: Vector(s['positionMetres']) for s in sockets}
    views = []
    for angle, x in [(math.pi / 2, -.29), (-math.pi / 2, .29)]:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(MODEL))
        objects = set(bpy.data.objects) - before
        root = next(o for o in objects if o.parent not in objects)
        transform = Matrix.Translation((x, 0, .395)) @ Matrix.Rotation(angle, 4, 'Z')
        root.matrix_world = transform @ root.matrix_world
        views.append(transform @ C)
    bpy.context.view_layer.update()
    text('CONSTRUCTION PROJECTOR / SOCKET MAP', -.55, .79, .027, white)
    text('UC_EQ_ConstructionProjector_v02   |   Actual Tripo mesh   |   Equipment authoring v1', -.55, .757, .013, dim)
    line([(-.55, .735), (.55, .735)], dim)
    text('01 / PALM SIDE  (-X)', -.55, .695, .018, white)
    text('02 / FINGER SIDE  (+X)', .04, .695, .018, white)
    text('Muzzle +Z  >', -.19, .666, .012, dim)
    text('<  Muzzle +Z', .08, .666, .012, dim)

    # Numbered, surface-projected callouts; the exact transforms live in the GLB.
    labels = [
        (0, 0, (-.50, .422)), (0, 1, (-.51, .503)),
        (0, 3, (-.30, .405)), (0, 10, (-.23, .43)),
        (0, 11, (-.20, .477)), (0, 12, (-.087, .61)),
        (1, 2, (.51, .578)), (1, 4, (.51, .53)),
        (1, 5, (.51, .485)), (1, 6, (.51, .44)),
        (1, 7, (.315, .455)), (1, 8, (.28, .42)), (1, 9, (.27, .385)),
    ]
    for view, index, target in labels:
        socket = sockets[index]
        point = views[view] @ positions[socket['name']]
        start = (point.x, point.z)
        mat = colors[socket['role']]
        # Thin ring is the true projected position; larger numbered ring is a label.
        ring(*start, .0028, mat, .00055)
        ring(*target, .0085, mat)
        delta = Vector((target[0] - start[0], target[1] - start[1])).normalized()
        stop = (target[0] - delta.x * .009, target[1] - delta.y * .009)
        line([start, stop], mat, .0004)
        text(f'{index + 1:02}', target[0], target[1] - .0035, .0095, mat, 'CENTER')
    text('01 is inside the grip; contact markers are projected through the mesh.', -.55, .356, .012, dim)
    line([(-.55, .34), (.55, .34)], dim)
    notes = [
        'Registration frame (inside handle)', 'Palm surface / right hand',
        'Thumb pad / opposite side', 'Index rest / outside guard',
        'Middle fingertip', 'Ring fingertip', 'Pinky fingertip',
        'Middle front-wrap guide', 'Ring front-wrap guide', 'Pinky front-wrap guide',
        'Trigger press / optional', 'Left support palm / optional', 'Emission +Z / 5 mm clear of housing',
    ]
    for i, (socket, note) in enumerate(zip(sockets, notes)):
        col, row = (0, i) if i < 7 else (1, i - 7)
        x, y = (-.55 if col == 0 else .045), .309 - row * .024
        mat = colors[socket['role']]
        text(f'{i + 1:02}', x, y, .012, mat)
        text(socket['name'], x + .033, y, .012, white)
        text(note, x + .25, y, .0105, dim)
    line([(-.55, .132), (.55, .132)], dim)
    text('METRES  /  root scale 1  /  +Y up  /  +Z muzzle forward  /  length 314.85 mm', -.55, .107, .013, white)
    text('Surface sockets: local +Z = outward normal. They are contact points, not bone centres.', -.55, .081, .012, dim)
    text('Character hand profile supplies wrist registration, joint limits and pad thickness. Grasp solve is pending.', -.55, .056, .012, dim)

    camera = bpy.data.objects.new('Diagram camera', bpy.data.cameras.new('Diagram camera'))
    scene.collection.objects.link(camera)
    camera.location = (0, -3, .425)
    camera.rotation_euler = (math.pi / 2, 0, 0)
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 1.2
    scene.camera = camera
    for name, location, energy, size in [
        ('Key', (-.5, -1, 1.8), 65, 1.3),
        ('Fill', (.7, -.6, .9), 25, 1),
        ('Rim', (0, .3, 1.3), 45, .8),
    ]:
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'AREA'))
        scene.collection.objects.link(light)
        light.location = location
        light.rotation_euler = (Vector((0, 0, .5)) - light.location).to_track_quat('-Z', 'Y').to_euler()
        light.data.energy = energy
        light.data.shape = 'DISK'
        light.data.size = size
    scene.render.filepath = str(REF / 'socket-map.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'socket-diagram.blend'))
    bpy.ops.render.render(write_still=True)
    print('RESULT ' + json.dumps(dict(diagram=scene.render.filepath, sockets=len(sockets))))


if __name__ == '__main__':
    main()

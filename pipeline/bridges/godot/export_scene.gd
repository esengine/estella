# Headless Godot 4 scene bridge. Scripts are stripped before the scene enters the tree.
# ESTELLA_SOURCE_SCENE=res://game.tscn ESTELLA_SCENE_OUT=absolute.glb
extends SceneTree
var issues: Array = []
var particle_rows: Array = []
var animation_rows: Array = []
var texture_cache = {}
var packed_textures = {}
var texture_images = {}
func _initialize():
	call_deferred("run")
func strip(n: Node):
	n.set_script(null)
	for c in n.get_children(): strip(c)
func vector(v: Vector3): return {"x":v.x,"y":v.y,"z":v.z}
func color(c: Color): return {"r":c.r,"g":c.g,"b":c.b,"a":c.a}
func bake_gradient(tex: GradientTexture2D):
	var image = Image.create_empty(tex.width,tex.height,false,Image.FORMAT_RGBA8)
	var delta = tex.fill_to-tex.fill_from
	var length = max(delta.length(),0.000001)
	for y in tex.height:
		for x in tex.width:
			var uv = Vector2(float(x)/max(tex.width-1,1),float(y)/max(tex.height-1,1))-tex.fill_from
			var t = uv.dot(delta)/(length*length) if tex.fill == 0 else uv.length()/length
			if tex.repeat == 1: t = fposmod(t,1.0)
			elif tex.repeat == 2: t = 1.0-abs(fposmod(t,2.0)-1.0)
			image.set_pixel(x,y,tex.gradient.sample(clamp(t,0.0,1.0)))
	return image
func portable_material(m):
	if not m is BaseMaterial3D or m.albedo_texture == null: return
	var tex = m.albedo_texture
	if tex is GradientTexture2D or tex is GradientTexture1D:
		var id = tex.get_instance_id()
		if not texture_cache.has(id):
			var source_image = bake_gradient(tex) if tex is GradientTexture2D else tex.get_image()
			texture_cache[id] = ImageTexture.create_from_image(source_image)
			texture_images[texture_cache[id].get_instance_id()] = source_image
		m.albedo_texture = texture_cache[id]
func prepare_materials(n: Node):
	if n is MeshInstance3D and n.mesh:
		for i in n.mesh.get_surface_count(): portable_material(n.get_active_material(i))
	for c in n.get_children(): prepare_materials(c)
func pack_texture(tex, doc):
	var id = tex.get_instance_id()
	if packed_textures.has(id): return packed_textures[id]
	var image = texture_images.get(id) if texture_images.has(id) else tex.get_image()
	if image == null: return -1
	if image.is_compressed(): image.decompress()
	if not doc.has("images"): doc.images = []
	if not doc.has("textures"): doc.textures = []
	if not doc.has("samplers"): doc.samplers = []
	var sampler = doc.samplers.size()
	doc.samplers.append({"wrapS":33071,"wrapT":33071,"magFilter":9729,"minFilter":9729})
	var image_index = doc.images.size()
	doc.images.append({"mimeType":"image/png","uri":"data:image/png;base64,"+Marshalls.raw_to_base64(image.save_png_to_buffer())})
	var index = doc.textures.size()
	doc.textures.append({"source":image_index,"sampler":sampler})
	packed_textures[id] = index
	return index
func expand(n: Node):
	for c in n.get_children(): expand(c)
	if not n is GridMap: return
	var holder = StaticBody3D.new()
	holder.name = str(n.name) + "_Expanded"
	holder.transform = n.transform
	n.get_parent().add_child(holder)
	# get_meshes retains Godot's centering and per-item mesh transforms exactly.
	var meshes = n.get_meshes()
	for i in range(0, meshes.size(), 2):
		var item = MeshInstance3D.new()
		item.name = "Cell_%d" % (i / 2)
		item.transform = meshes[i]
		item.mesh = meshes[i+1]
		holder.add_child(item)
	for cell in n.get_used_cells():
		var id = n.get_cell_item(cell)
		var at = Transform3D(n.get_cell_item_basis(cell), n.map_to_local(cell))
		var shapes = n.mesh_library.get_item_shapes(id)
		for i in range(0, shapes.size(), 2):
			var shape = CollisionShape3D.new()
			shape.name = "Collision_%d" % holder.get_child_count()
			shape.shape = shapes[i]
			shape.transform = at * shapes[i+1]
			holder.add_child(shape)
	n.get_parent().remove_child(n)
	n.free()
func primitive(shape):
	if shape is SphereShape3D: return {"type":"sphere","sphere":{"radius":shape.radius}}
	if shape is BoxShape3D: return {"type":"box","box":{"size":[shape.size.x,shape.size.y,shape.size.z]}}
	if shape is CapsuleShape3D: return {"type":"capsule","capsule":{"radius":shape.radius,"height":shape.height}}
	return null
func particles(n: CPUParticles3D, doc):
	if not n.mesh is PlaneMesh and not n.mesh is QuadMesh:
		issues.append(str(n.get_path()) + ": mesh particles need a mesh renderer bridge")
		return null
	if n.local_coords: issues.append(str(n.get_path()) + ": local particle motion mapped to world simulation")
	if n.emission_shape not in [0,1,2,3]:
		issues.append(str(n.get_path()) + ": unsupported emission shape")
		return null
	var size = max(n.mesh.size.x,n.mesh.size.y)
	var tint = n.color
	var material = n.mesh.material
	if material is BaseMaterial3D: tint *= material.albedo_color.srgb_to_linear()
	var start = color(tint)
	var emitter = {"maxParticles":n.amount,"rate":0.0 if n.one_shot and n.explosiveness == 1 else n.amount/n.lifetime,
		"duration":n.lifetime,"lifetimeMin":n.lifetime*(1.0-n.lifetime_randomness),"lifetimeMax":n.lifetime,
		"looping":not n.one_shot,"playOnStart":n.emitting,"simulationSpace":0,"renderMode":0,
		"shape":4 if n.emission_shape in [1,2] else 2 if n.emission_shape == 3 else 0,
		"shapeRadius":n.emission_sphere_radius,"shapeSize":vector(n.emission_box_extents*2),
		"startColor":start,"endColor":start,"enabled":true,"blendMode":1 if material is BaseMaterial3D and material.blend_mode == 1 else 0}
	if n.one_shot and n.explosiveness == 1: emitter.bursts = [{"time":0,"count":n.amount}]
	if n.color_ramp:
		var stops = []
		for i in n.color_ramp.get_point_count(): stops.append({"t":n.color_ramp.get_offset(i),"color":color(n.color_ramp.get_color(i)*tint)})
		emitter.colorGradient = {"stops":stops}
	if n.scale_amount_curve:
		var keys = []
		for i in range(17): keys.append({"time":i/16.0,"value":n.scale_amount_curve.sample(i/16.0),"interpolation":"linear"})
		emitter.sizeCurve = {"keys":keys}
	var units = {"startSizeMin":size*n.scale_amount_min,"startSizeMax":size*n.scale_amount_max,
		"endSizeMin":size*n.scale_amount_min,"endSizeMax":size*n.scale_amount_max,
		"speedMin":n.initial_velocity_min,"speedMax":n.initial_velocity_max,"gravity":vector(n.gravity)}
	if n.emission_shape in [1,2] and n.spread < 180:
		issues.append(str(n.get_path()) + ": sphere emission uses native radial velocity; authored direction/spread differs")
	var result = {"emitter":emitter,"units":units}
	if material is BaseMaterial3D and material.albedo_texture: result.texture = pack_texture(material.albedo_texture,doc)
	return result
func patch_nodes(scene, state, doc):
	var shapes = doc.get("extensions",{}).get("OMI_physics_shape",{}).get("shapes",[])
	for i in doc.nodes.size():
		var n = state.get_scene_node(i)
		if not is_instance_valid(n): continue
		var row = doc.nodes[i]
		if n is Node3D and not n.visible:
			if not row.has("extensions"): row.extensions = {}
			row.extensions.KHR_node_visibility = {"visible":false}
		if n is RigidBody3D:
			if not row.has("extras"): row.extras = {}
			row.extras["estella"] = {"rigidBody":{"fixedRotation":n.axis_lock_angular_x and n.axis_lock_angular_y and n.axis_lock_angular_z,
				"gravityScale":n.gravity_scale,"linearDamping":n.linear_damp,"angularDamping":n.angular_damp,"continuousCollision":n.continuous_cd}}
			if (n.axis_lock_angular_x or n.axis_lock_angular_y or n.axis_lock_angular_z) and not row.extras.estella.rigidBody.fixedRotation:
				issues.append(str(n.get_path())+": partial angular locks are not represented by fixedRotation")
		if n is StaticBody3D:
			if not row.has("extensions"): row.extensions = {}
			if not row.extensions.has("OMI_physics_body"): row.extensions.OMI_physics_body = {}
			row.extensions.OMI_physics_body.motion = {"type":"static"}
		if n is CollisionShape3D and n.get_parent() is Area3D:
			var shape = primitive(n.shape)
			if shape != null:
				if not row.has("extensions"): row.extensions = {}
				row.extensions.OMI_physics_body = {"trigger":{"shape":shapes.size()}}
				shapes.append(shape)
			else: issues.append(str(n.get_path())+": unsupported area shape")
		if n is MeshInstance3D and row.has("mesh") and n.mesh:
			for j in min(n.mesh.get_surface_count(),doc.meshes[row.mesh].primitives.size()):
				var mat = n.get_active_material(j)
				var prim = doc.meshes[row.mesh].primitives[j]
				if mat is BaseMaterial3D and prim.has("material"):
					var exported_mat = doc.materials[prim.material]
					if mat.albedo_texture and not exported_mat.pbrMetallicRoughness.has("baseColorTexture"):
						var tex_index = pack_texture(mat.albedo_texture,doc)
						if tex_index >= 0: exported_mat.pbrMetallicRoughness.baseColorTexture = {"index":tex_index}
					if mat.blend_mode == 1: exported_mat["extras"] = {"estella":{"blendMode":1}}
					if mat.billboard_mode in [1,2]: row["extras"] = {"estella":{"billboard":0 if mat.billboard_mode == 1 else 1}}
		if n is CPUParticles3D:
			var data = particles(n,doc)
			if data != null:
				row["extras"] = {"estella":{"particle":data}}
				particle_rows.append(i)
		if n is WorldEnvironment: issues.append("WorldEnvironment requires native lighting/postprocess setup")
	# Godot's GLTFAnimation retains its source AnimationPlayer path/name in additional data.
	for animation in doc.get("animations",[]):
		var tracks = []
		var targets = {}
		for channel in animation.get("channels",[]):
			var target = channel.get("target",{})
			var pointer = target.get("extensions",{}).get("KHR_animation_pointer",{}).get("pointer","")
			if pointer.begins_with("/nodes/"): targets[int(pointer.split("/")[2])] = true
			elif target.has("node"): targets[int(target.node)] = true
		for index in targets:
			var target_node = state.get_scene_node(index)
			if not is_instance_valid(target_node): continue
			var owner_node = target_node.get_parent()
			if not is_instance_valid(owner_node): continue
			for player in owner_node.get_children():
				if not player is AnimationPlayer: continue
				for clip in player.get_animation_list():
					# Exported clip names are uniquified (take, take2, ...); match via target visibility track.
					if not str(animation.name).begins_with(str(clip)): continue
					var a = player.get_animation(clip)
					var matches = false
					for t in a.get_track_count():
						var path = str(a.track_get_path(t))
						if path.ends_with(":visible") and player.get_node(player.root_node).get_node_or_null(NodePath(path.get_slice(":",0))) == target_node: matches = true
					if not matches: continue
					for t in a.get_track_count():
						var path = str(a.track_get_path(t))
						if not path.ends_with(":emitting"): continue
						var particle_node = player.get_node(player.root_node).get_node_or_null(NodePath(path.get_slice(":",0)))
						var node_index = state.get_node_index(particle_node)
						if node_index < 0: continue
						var events = []
						for k in a.track_get_key_count(t): events.append({"time":a.track_get_key_time(t,k),"action":"play" if a.track_get_key_value(t,k) else "stop"})
						var row_track = {"node":node_index,"events":events}
						if row_track not in tracks: tracks.append(row_track)
		if not tracks.is_empty():
			animation["extras"] = {"estella":{"particles":tracks}}
			animation_rows.append(animation.name)
	if not doc.has("extensions"): doc.extensions = {}
	doc.extensions.OMI_physics_shape = {"shapes":shapes}
	for ext in ["KHR_node_visibility","OMI_physics_shape","OMI_physics_body"]:
		if ext not in doc.extensionsUsed: doc.extensionsUsed.append(ext)
func run():
	var source = OS.get_environment("ESTELLA_SOURCE_SCENE")
	if source.is_empty(): source = "res://game.tscn"
	var output = OS.get_environment("ESTELLA_SCENE_OUT")
	if output.is_empty(): push_error("ESTELLA_SCENE_OUT is required"); quit(1); return
	var scene = load(source).instantiate()
	strip(scene)
	scene.process_mode = Node.PROCESS_MODE_DISABLED
	root.add_child(scene)
	expand(scene)
	prepare_materials(scene)
	var exporter = GLTFDocument.new()
	var state = GLTFState.new()
	var err = exporter.append_from_scene(scene,state)
	if err != OK: quit(err); return
	var glb = exporter.generate_buffer(state)
	var json_length = glb.decode_u32(12)
	var doc = JSON.parse_string(glb.slice(20,20+json_length).get_string_from_utf8())
	patch_nodes(scene,state,doc)
	doc["extras"] = {"estella":{"warnings":issues}}
	var json = JSON.stringify(doc).to_utf8_buffer()
	while json.size()%4: json.append(32)
	var tail = glb.slice(20+json_length)
	var result = PackedByteArray()
	result.resize(20)
	result.encode_u32(0,0x46546C67); result.encode_u32(4,2); result.encode_u32(8,20+json.size()+tail.size())
	result.encode_u32(12,json.size()); result.encode_u32(16,0x4E4F534A)
	result.append_array(json); result.append_array(tail)
	DirAccess.make_dir_recursive_absolute(output.get_base_dir())
	FileAccess.open(output,FileAccess.WRITE).store_buffer(result)
	var report = {"source":source,"nodes":doc.nodes.size(),"particle_emitters":particle_rows.size(),"particle_animations":animation_rows.size(),"warnings":issues}
	FileAccess.open(output+".bridge.json",FileAccess.WRITE).store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report))
	scene.free()
	quit()

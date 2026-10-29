// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "TilemapRenderPlugin.hpp"
#include "../draw/BatchBuilder.hpp"

#include "../../tilemap/TilemapSystem.hpp"
#include "../../tilemap/TileFlip.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/TilemapLayer.hpp"
#include "../../ecs/GroupOpacityLookup.hpp"
#include "../frame/RenderFrame.hpp"

#include <cmath>

namespace esengine {

void TilemapRenderPlugin::init(RenderFrameContext& ctx) {
    batch_shader_id_ = ctx.batch_shader_id;
}

void TilemapRenderPlugin::rebuildChunk(
    const tilemap::TilemapSystem::LayerData& layer,
    const tilemap::ChunkData& chunk, tilemap::ChunkCoord coord,
    const std::vector<tilemap::TilesetSlot>& slots,
    const std::vector<ResolvedSlot>& resolved,
    Entity entity, ChunkCache& cache
) {
    cache.slots.resize(slots.size());
    for (auto& mesh : cache.slots) { mesh.vertices.clear(); mesh.indices.clear(); }
    cache.has_animated_tiles = false;

    i32 baseX = coord.x * static_cast<i32>(tilemap::CHUNK_SIZE);
    i32 baseY = coord.y * static_cast<i32>(tilemap::CHUNK_SIZE);

    bool hasAnimations = !layer.tile_animations.empty();
    f32 hw = layer.tile_width * 0.5f;
    f32 hh = layer.tile_height * 0.5f;
    const auto grid = layer.grid();

    for (u32 ly = 0; ly < tilemap::CHUNK_SIZE; ++ly) {
        i32 ty = baseY + static_cast<i32>(ly);
        if (!layer.infinite && static_cast<u32>(ty) >= layer.height) break;

        for (u32 lx = 0; lx < tilemap::CHUNK_SIZE; ++lx) {
            i32 tx = baseX + static_cast<i32>(lx);
            if (!layer.infinite && static_cast<u32>(tx) >= layer.width) break;

            u16 rawTile = chunk.tiles[ly * tilemap::CHUNK_SIZE + lx];
            u16 tileId = rawTile & tilemap::TILE_ID_MASK;
            if (tileId == tilemap::EMPTY_TILE) continue;

            if (hasAnimations &&
                layer.tile_animations.find(tileId) != layer.tile_animations.end()) {
                cache.has_animated_tiles = true;
                tileId = tilemap_system_->resolveAnimatedTile(entity, tileId);
            }

            // Resolve which tileset (slot) this tile belongs to, then its local
            // index within that tileset. A tile whose tileset texture is missing
            // is skipped.
            int slotIndex = tilemap::resolveTilesetSlot(slots, tileId);
            if (slotIndex < 0 || !resolved[slotIndex].valid) continue;
            const ResolvedSlot& rs = resolved[slotIndex];
            u32 tilesetColumns = slots[slotIndex].columns;
            if (tilesetColumns == 0) continue;
            f32 uvTileW = rs.uvW;
            f32 uvTileH = rs.uvH;

            bool flipH = (rawTile & tilemap::TILE_FLIP_H) != 0;
            bool flipV = (rawTile & tilemap::TILE_FLIP_V) != 0;
            bool flipD = (rawTile & tilemap::TILE_FLIP_D) != 0;

            u32 tileIndex = tileId - slots[slotIndex].first_id;
            u32 tileCol = tileIndex % tilesetColumns;
            u32 tileRow = tileIndex / tilesetColumns;
            // A cell the atlas does not hold — an id past the tileset, or a
            // column count wider than the texture. Its UV rect falls outside,
            // where the sampler hands back a tile that does exist.
            if (tileCol >= rs.atlasCols || tileRow >= rs.atlasRows) continue;

            const auto center = grid.center(tx, ty);
            const f32 worldX = center.x, worldY = center.y;

            // Base tile UV rect (GL v increases upward, so vBottom < vTop), with
            // the atlas margin + spacing folded into offset/step so a Tiled tileset
            // with gaps samples the right cell. `inset` is zero on an extruded
            // atlas and half a texel on a packed one — see where it is resolved.
            f32 uMin = rs.uvOffsetX + static_cast<f32>(tileCol) * rs.uvStepX + rs.insetU;
            f32 uMax = uMin + uvTileW - 2.0f * rs.insetU;
            f32 vBottom = 1.0f - rs.uvOffsetY - static_cast<f32>(tileRow) * rs.uvStepY - uvTileH + rs.insetV;
            f32 vTop = vBottom + uvTileH - 2.0f * rs.insetV;

            // Map a corner's normalized (s,t) in {0,1}^2 to its texture UV, applying
            // the tile flip flags. Tiled order — diagonal (transpose) first, then H,
            // then V — so the standard 90°/270° combos (H|D, V|D) come out as true
            // rotations. H/V-only reduce to the previous behavior exactly.
            auto cornerUV = [&](f32 s, f32 t) -> glm::vec2 {
                tilemap::applyTileFlip(s, t, flipH, flipV, flipD);
                return glm::vec2{ uMin + s * (uMax - uMin), vBottom + t * (vTop - vBottom) };
            };

            glm::vec2 bl = cornerUV(0.0f, 0.0f);
            glm::vec2 br = cornerUV(1.0f, 0.0f);
            glm::vec2 tr = cornerUV(1.0f, 1.0f);
            glm::vec2 tl = cornerUV(0.0f, 1.0f);

            SlotMesh& mesh = cache.slots[slotIndex];
            u32 baseVertex = static_cast<u32>(mesh.vertices.size());
            mesh.vertices.push_back({ {worldX - hw, worldY - hh, 0.0f}, 0, {bl.x, bl.y} });
            mesh.vertices.push_back({ {worldX + hw, worldY - hh, 0.0f}, 0, {br.x, br.y} });
            mesh.vertices.push_back({ {worldX + hw, worldY + hh, 0.0f}, 0, {tr.x, tr.y} });
            mesh.vertices.push_back({ {worldX - hw, worldY + hh, 0.0f}, 0, {tl.x, tl.y} });

            for (u32 i = 0; i < 6; ++i) {
                mesh.indices.push_back(baseVertex + BATCH_QUAD_INDICES[i]);
            }
        }
    }
}

TilemapRenderPlugin::ChunkCache& TilemapRenderPlugin::ensureChunk(
    const tilemap::TilemapSystem::LayerData& layer, const tilemap::ChunkData& chunkData, tilemap::ChunkCoord coord,
    const std::vector<tilemap::TilesetSlot>& slots, const std::vector<ResolvedSlot>& resolved, Entity entity, ChunkMap& chunkCaches
) {
    auto& cache = chunkCaches[coord];
    if (chunkData.revision != cache.built_revision
        || layer.anim_table_revision != cache.built_anim_table_revision
        || (cache.has_animated_tiles && layer.anim_revision != cache.built_anim_revision)
        || cache.slots.size() != slots.size()) {
        rebuildChunk(layer, chunkData, coord, slots, resolved, entity, cache);
        cache.built_revision = chunkData.revision;
        cache.built_anim_revision = layer.anim_revision;
        cache.built_anim_table_revision = layer.anim_table_revision;
        cache.mesh_serial = ++mesh_serial_;
    }
    return cache;
}

void TilemapRenderPlugin::releaseStrip(GfxDevice& device, Strip& strip) {
    // Deleted whatever device generation they were made on: a device that was lost keeps its buffers' records (it rebuilds them with their
    // contents gone), so the handles still name them, and leaving them would grow the device's table by a strip's buffers every recovery.
    for (StripSlot& slot : strip.slots) {
        const u64 bytes = static_cast<u64>(slot.vboBytes) + slot.iboBytes;
        strip_bytes_ = strip_bytes_ >= bytes ? strip_bytes_ - bytes : 0;
        if (slot.vbo != BufferHandle::Invalid) device.deleteBuffer(slot.vbo);
        if (slot.ibo != BufferHandle::Invalid) device.deleteBuffer(slot.ibo);
        slot = StripSlot{};
    }
    strip.built = false;
}

void TilemapRenderPlugin::releaseLayer(LayerCache& layer) {
    if (device_) {
        for (auto& [key, strip] : layer.strips) releaseStrip(*device_, strip);
    }
    layer.strips.clear();
}

void TilemapRenderPlugin::evictStrips(GfxDevice& device) {
    if (strip_bytes_ <= STRIP_BYTES_BUDGET) return;
    // Not drawn by the last two collects: a frame with several cameras collects once for each, and what an earlier one queued has not drawn yet.
    for (auto& [entity, layer] : layer_caches_) {
        for (auto it = layer.strips.begin(); it != layer.strips.end() && strip_bytes_ > STRIP_BYTES_BUDGET;) {
            if (it->second.lastUsed + 2 <= collect_serial_) {
                releaseStrip(device, it->second);
                it = layer.strips.erase(it);
            } else {
                ++it;
            }
        }
    }
}

void TilemapRenderPlugin::shutdown() {
    for (auto& [entity, layer] : layer_caches_) releaseLayer(layer);
    layer_caches_.clear();
}

void TilemapRenderPlugin::collect(RenderCollectContext& collect_ctx) {
    auto& registry = collect_ctx.registry;
    auto& clips = collect_ctx.clip_state;
    auto& buffers = collect_ctx.buffer_pool;
    auto& draw_list = collect_ctx.draw_list;
    auto& ctx = collect_ctx.frame_context;
    if (!tilemap_system_) return;
    const ecs::GroupOpacityLookup groupOpacity(registry);

    const auto& layers = tilemap_system_->allLayers();
    if (layers.empty()) return;

    const CameraView& cam = collect_ctx.camera;
    ++collect_serial_;

    for (const auto& [entity, layer] : layers) {
        auto cachedLayer = layer_caches_.find(entity);
        if (cachedLayer != layer_caches_.end() && cachedLayer->second.generation != layer.generation) {
            releaseLayer(cachedLayer->second);
            layer_caches_.erase(cachedLayer);
            cachedLayer = layer_caches_.end();
        }
        if (registry.valid(entity) && !registry.isEntityActive(entity)) continue;
        // The TilemapLayer component is the single source of a layer's visual
        // metadata — the renderer reads it live each frame (so animated
        // tint/opacity need no sync). Every scene-driven layer has one (Tiled
        // imports project REAL child entities); only a code-driven TilemapAPI
        // layer without a component entity still reads LayerData metadata.
        const ecs::TilemapLayer* comp = registry.tryGet<ecs::TilemapLayer>(entity);

        bool visible;
        i32 sortLayer;
        f32 depth;
        glm::vec4 tint;
        f32 opacity;
        glm::vec2 parallax;
        resource::TextureHandle singleTileset;  // single-tileset fallback source
        u32 singleColumns;
        // Where this layer's grid starts. A layer whose tiles are drawn from a
        // LayerData has no component to author it on, so it starts at the origin.
        glm::vec2 originOffset{0.0f, 0.0f};
        if (comp) {
            visible = comp->visible;
            sortLayer = comp->renderLayer;
            depth = 0.0f;
            tint = comp->tintColor;
            opacity = comp->opacity;
            parallax = comp->parallaxFactor;
            singleTileset = comp->tileset;
            singleColumns = static_cast<u32>(comp->tilesetColumns);
            originOffset = comp->originOffset;
        } else {
            visible = layer.visible;
            sortLayer = layer.sort_layer;
            depth = layer.depth;
            tint = layer.tint;
            opacity = layer.opacity;
            parallax = layer.parallax_factor;
            singleTileset = resource::TextureHandle(layer.texture_handle);
            singleColumns = layer.tileset_columns;
        }

        if (registry.valid(entity)) opacity *= groupOpacity.of(entity);
        if (!visible) continue;

        // The layer's tileset slot list: the multi-tileset table when present
        // (Tiled imports), else a single slot from the painted/synthetic tileset.
        const std::vector<tilemap::TilesetSlot>* slotsPtr;
        if (!layer.tilesets.empty()) {
            slotsPtr = &layer.tilesets;
        } else {
            if (!singleTileset.isValid() || singleColumns == 0) continue;
            single_slot_scratch_.clear();
            single_slot_scratch_.push_back(tilemap::TilesetSlot{ 1, singleTileset.id(), singleColumns });
            slotsPtr = &single_slot_scratch_;
        }
        const std::vector<tilemap::TilesetSlot>& slots = *slotsPtr;

        // Resolve each slot's texture + UV scale (tile size / texture size). Kept
        // parallel to `slots`; a slot whose texture is missing renders nothing.
        resolved_scratch_.assign(slots.size(), ResolvedSlot{});
        std::vector<ResolvedSlot>& resolved = resolved_scratch_;
        bool anySlotValid = false;
        for (usize i = 0; i < slots.size(); ++i) {
            auto* tex = ctx.resources.getTexture(resource::TextureHandle(slots[i].texture_handle));
            if (!tex) continue;
            f32 tw = static_cast<f32>(tex->getWidth());
            f32 th = static_cast<f32>(tex->getHeight());
            if (tw <= 0.0f || th <= 0.0f) continue;
            resolved[i].valid = true;
            resolved[i].glTexId = tex->getId();
            resolved[i].uvW = layer.tile_width / tw;
            resolved[i].uvH = layer.tile_height / th;
            f32 margin = static_cast<f32>(slots[i].margin);
            f32 spacing = static_cast<f32>(slots[i].spacing);
            resolved[i].uvOffsetX = margin / tw;
            resolved[i].uvOffsetY = margin / th;
            resolved[i].uvStepX = (layer.tile_width + spacing) / tw;
            resolved[i].uvStepY = (layer.tile_height + spacing) / th;
            // An extruded atlas guarantees a stray sample reads the cell's own
            // edge, so the exact rect is safe — and it is the only rect that does
            // not stretch the tile. A packed atlas must still inset.
            const bool extruded = slots[i].extrude > 0;
            resolved[i].insetU = extruded ? 0.0f : 0.5f / tw;
            resolved[i].insetV = extruded ? 0.0f : 0.5f / th;
            resolved[i].atlasCols = tilemap::atlasCells(tw, margin, layer.tile_width, spacing);
            resolved[i].atlasRows = tilemap::atlasCells(th, margin, layer.tile_height, spacing);
            anySlotValid = true;
        }
        if (!anySlotValid) continue;

        f32 originX = 0, originY = 0, angle = 0;
        Entity transformEntity = (layer.origin_entity != INVALID_ENTITY)
            ? layer.origin_entity : entity;
        if (auto* transform = registry.tryGet<ecs::Transform>(transformEntity)) {
            transform->ensureDecomposed();   // lazily derived; see Transform.hpp
            originX = rebased(transform->worldPosition).x;
            originY = rebased(transform->worldPosition).y;
            const auto& q = transform->worldRotation;
            angle = std::atan2(2.0f * (q.w * q.z + q.x * q.y),
                               1.0f - 2.0f * (q.y * q.y + q.z * q.z));
        }
        const f32 cosAngle = std::cos(angle), sinAngle = std::sin(angle);

        glm::vec4 finalColor(tint.r, tint.g, tint.b, tint.a * opacity);
        u32 packedColor = packColor(finalColor);

        f32 parallaxOffsetX = cam.center.x * (1.0f - parallax.x);
        f32 parallaxOffsetY = cam.center.y * (1.0f - parallax.y);
        // The layer's own offset rides here rather than in the chunk vertices:
        // those are cached, and this is read every frame, so moving the grid is
        // live in the editor and costs no rebuild.
        f32 adjOriginX = originX + parallaxOffsetX + originOffset.x;
        f32 adjOriginY = originY + parallaxOffsetY + originOffset.y;

        // Visible chunk window. A chunk's screen position is only cx*CHUNK*tw /
        // cy*CHUNK*th for an orthogonal grid; iso couples cx and cy, and
        // staggered/hex advance by half a tile — so the orthogonal linear formula
        // dropped on-screen chunks when an iso/hex map was scrolled. Invert the
        // real tile placement instead: map the camera rect's four corners to tile
        // coords with the orientation-aware worldToTile, take their bounding box,
        // and grow it to whole chunks. worldToTile is affine for iso (a rect maps
        // to a parallelogram, whose corner bbox contains it) and box-approximate
        // for stagger/hex — a one-tile margin absorbs the half-tile shift and any
        // tile whose center is off-screen while its body still overlaps.
        i32 chunkSize = static_cast<i32>(tilemap::CHUNK_SIZE);
        i32 cornerTx[4], cornerTy[4];
        const auto cornerToTile = [&](f32 x, f32 y, i32& tx, i32& ty) {
            if (angle == 0) {
                tilemap_system_->worldToTile(entity, x, y, adjOriginX, adjOriginY, tx, ty);
            } else {
                const f32 dx = x - originX - parallaxOffsetX, dy = y - originY - parallaxOffsetY;
                tilemap_system_->worldToTile(entity, dx * cosAngle + dy * sinAngle,
                    -dx * sinAngle + dy * cosAngle, originOffset.x, originOffset.y, tx, ty);
            }
        };
        cornerToTile(cam.left, cam.top, cornerTx[0], cornerTy[0]);
        cornerToTile(cam.right, cam.top, cornerTx[1], cornerTy[1]);
        cornerToTile(cam.left, cam.bottom, cornerTx[2], cornerTy[2]);
        cornerToTile(cam.right, cam.bottom, cornerTx[3], cornerTy[3]);
        i32 minTx = cornerTx[0], maxTx = cornerTx[0];
        i32 minTy = cornerTy[0], maxTy = cornerTy[0];
        for (int i = 1; i < 4; ++i) {
            minTx = std::min(minTx, cornerTx[i]); maxTx = std::max(maxTx, cornerTx[i]);
            minTy = std::min(minTy, cornerTy[i]); maxTy = std::max(maxTy, cornerTy[i]);
        }
        minTx -= 1; minTy -= 1; maxTx += 1; maxTy += 1;

        i32 minCX = static_cast<i32>(std::floor(static_cast<f32>(minTx) / static_cast<f32>(chunkSize)));
        i32 minCY = static_cast<i32>(std::floor(static_cast<f32>(minTy) / static_cast<f32>(chunkSize)));
        i32 maxCX = static_cast<i32>(std::floor(static_cast<f32>(maxTx) / static_cast<f32>(chunkSize))) + 1;
        i32 maxCY = static_cast<i32>(std::floor(static_cast<f32>(maxTy) / static_cast<f32>(chunkSize))) + 1;

        if (!layer.infinite) {
            i32 chunksX = static_cast<i32>((layer.width + tilemap::CHUNK_SIZE - 1) / tilemap::CHUNK_SIZE);
            i32 chunksY = static_cast<i32>((layer.height + tilemap::CHUNK_SIZE - 1) / tilemap::CHUNK_SIZE);
            minCX = std::max(minCX, 0);
            minCY = std::max(minCY, 0);
            maxCX = std::min(maxCX, chunksX);
            maxCY = std::min(maxCY, chunksY);
        }

        if (minCX >= maxCX || minCY >= maxCY) continue;

        auto& layerCache = cachedLayer != layer_caches_.end() ? cachedLayer->second : layer_caches_[entity];
        layerCache.generation = layer.generation;
        const LayoutInputs layout{layer.tile_width, layer.tile_height, layer.grid_type,
            layer.hex_side_length, layer.hex_stagger_axis_x, layer.hex_stagger_index_even};
        if (layerCache.layout != layout || layerCache.tilesets != slots || layerCache.resolved != resolved) {
            releaseLayer(layerCache);
            layerCache.chunks.clear();
            layerCache.layout = layout;
            layerCache.tilesets = slots;
            layerCache.resolved = resolved;
        }
        auto& chunkCaches = layerCache.chunks;
        // A chunk taken out of the layer leaves its mesh here; let those go, or a layer walked over for ever grows by every chunk it held.
        if (layerCache.chunksErasedSeen != layer.chunks_erased) {
            for (auto it = chunkCaches.begin(); it != chunkCaches.end();) {
                it = layer.chunks.find(it->first) == layer.chunks.end() ? chunkCaches.erase(it) : std::next(it);
            }
            layerCache.chunksErasedSeen = layer.chunks_erased;
        }

        // A layer that has not moved draws from strips the GPU holds. A parallax layer places its tiles by where the camera is, which changes
        // every frame it moves, so it keeps the path that builds the vertices each frame; so does a layer being faded, tinted or carried, until
        // it has stood still for a while.
        const Placement place{adjOriginX, adjOriginY, originX, originY, originOffset.x, originOffset.y, angle, depth, packedColor};
        constexpr u64 SETTLE_COLLECTS = 30;
        if (layerCache.lastPlacementKnown && !(layerCache.lastPlacement == place)) {
            if (layerCache.movingUntil <= collect_serial_) releaseLayer(layerCache);
            layerCache.movingUntil = collect_serial_ + SETTLE_COLLECTS;
        }
        layerCache.lastPlacement = place;
        layerCache.lastPlacementKnown = true;
        if (parallax.x == 1.0f && parallax.y == 1.0f && layerCache.movingUntil <= collect_serial_ && buffers.device().isDeviceUsable()) {
            GfxDevice& device = buffers.device();
            device_ = &device;
            const u64 generation = device.deviceGeneration();
            const i32 firstStrip = static_cast<i32>(std::floor(static_cast<f32>(minCX) / static_cast<f32>(STRIP_CHUNKS)));
            const i32 lastStrip = static_cast<i32>(std::floor(static_cast<f32>(maxCX - 1) / static_cast<f32>(STRIP_CHUNKS)));
            const VertexLayoutHandle batchLayout = buffers.layoutHandle(LayoutId::Batch);

            visible_strips_scratch_.clear();
            for (i32 cy = minCY; cy < maxCY; ++cy) {
                for (i32 sx = firstStrip; sx <= lastStrip; ++sx) {
                    Strip& strip = layerCache.strips[StripKey{sx, cy}];
                    strip.lastUsed = collect_serial_;
                    // The chunks the strip is made of, brought up to date: the newest build among them and how many there are say whether the
                    // strip still describes them.
                    u64 stamp = 0;
                    u32 chunkCount = 0;
                    const i32 cxBegin = sx * STRIP_CHUNKS;
                    for (i32 cx = cxBegin; cx < cxBegin + STRIP_CHUNKS; ++cx) {
                        const tilemap::ChunkCoord coord{cx, cy};
                        const auto chunkIt = layer.chunks.find(coord);
                        if (chunkIt == layer.chunks.end()) continue;
                        stamp = std::max(stamp, ensureChunk(layer, chunkIt->second, coord, slots, resolved, entity, chunkCaches).mesh_serial);
                        ++chunkCount;
                    }
                    if (chunkCount == 0 && !strip.built) continue;
                    const bool current = strip.built && strip.stamp == stamp && strip.chunkCount == chunkCount
                        && strip.placement == place && strip.deviceGeneration == generation && strip.slots.size() == slots.size();
                    if (!current) {
                        releaseStrip(device, strip);
                        strip.slots.assign(slots.size(), StripSlot{});
                        for (usize si = 0; si < slots.size(); ++si) {
                            if (!resolved[si].valid) continue;
                            strip_vertices_scratch_.clear();
                            strip_indices_scratch_.clear();
                            // Chunks in ascending x: the order the merged draw laid a row of them out in.
                            for (i32 cx = cxBegin; cx < cxBegin + STRIP_CHUNKS; ++cx) {
                                const auto chunkIt = chunkCaches.find(tilemap::ChunkCoord{cx, cy});
                                if (chunkIt == chunkCaches.end() || si >= chunkIt->second.slots.size()) continue;
                                if (layer.chunks.find(tilemap::ChunkCoord{cx, cy}) == layer.chunks.end()) continue;
                                const SlotMesh& mesh = chunkIt->second.slots[si];
                                if (mesh.indices.empty()) continue;
                                const u32 baseVertex = static_cast<u32>(strip_vertices_scratch_.size());
                                for (const BatchVertex& v : mesh.vertices) {
                                    const f32 lx = v.position.x + originOffset.x, ly = v.position.y + originOffset.y;
                                    strip_vertices_scratch_.push_back({
                                        angle == 0
                                            ? glm::vec3{v.position.x + adjOriginX, v.position.y + adjOriginY, depth}
                                            : glm::vec3{originX + parallaxOffsetX + lx * cosAngle - ly * sinAngle,
                                                        originY + parallaxOffsetY + lx * sinAngle + ly * cosAngle, depth},
                                        packedColor, v.texCoord });
                                }
                                for (u32 idx : mesh.indices) strip_indices_scratch_.push_back(baseVertex + idx);
                            }
                            if (strip_indices_scratch_.empty()) continue;
                            StripSlot& out = strip.slots[si];
                            out.vertexCount = static_cast<u32>(strip_vertices_scratch_.size());
                            out.indexCount = static_cast<u32>(strip_indices_scratch_.size());
                            out.vboBytes = out.vertexCount * static_cast<u32>(sizeof(BatchVertex));
                            out.iboBytes = out.indexCount * static_cast<u32>(sizeof(u32));
                            out.vbo = device.createBuffer({GfxBufferUsage::Vertex, out.vboBytes, /*dynamic=*/false}, GfxContent::transient(),
                                                          strip_vertices_scratch_.data());
                            out.ibo = device.createBuffer({GfxBufferUsage::Index, out.iboBytes, /*dynamic=*/false}, GfxContent::transient(),
                                                          strip_indices_scratch_.data());
                            if (out.vbo == BufferHandle::Invalid || out.ibo == BufferHandle::Invalid) {
                                if (out.vbo != BufferHandle::Invalid) device.deleteBuffer(out.vbo);
                                if (out.ibo != BufferHandle::Invalid) device.deleteBuffer(out.ibo);
                                out = StripSlot{};
                                continue;
                            }
                            strip_bytes_ += out.vboBytes + out.iboBytes;
                        }
                        strip.placement = place;
                        strip.stamp = stamp;
                        strip.chunkCount = chunkCount;
                        strip.deviceGeneration = generation;
                        strip.built = true;
                    }
                    visible_strips_scratch_.push_back(&strip);
                }
            }

            // Slot by slot, then row by row: the order the merged draws were emitted in, so tiles that overlap overlap the same way.
            for (usize si = 0; si < slots.size(); ++si) {
                if (!resolved[si].valid) continue;
                for (const Strip* strip : visible_strips_scratch_) {
                    if (si >= strip->slots.size() || strip->slots[si].indexCount == 0) continue;
                    const StripSlot& slot = strip->slots[si];
                    BatchDrawKey key{
                        .stage = ctx.current_stage,
                        .layer = sortLayer,
                        .shaderId = batch_shader_id_,
                        .blend = BlendMode::Normal,
                        .textureId = resolved[si].glTexId,
                        .depth = depth,
                        .entity = entity,
                        .type = RenderType::Sprite,
                    };
                    key.vertexBuffer = slot.vbo;
                    key.indexBuffer = slot.ibo;
                    key.vertexLayout = batchLayout;
                    if (!batchEntityVisible(draw_list, clips, key.entity, key.layer, key.cullBit)) continue;
                    pushBatchDraw(draw_list, clips, 0, slot.vertexCount, 0, slot.indexCount, key);
                }
            }
            continue;
        }

        // Per-slot merged geometry for this layer (one draw call per slot/texture).
        if (slot_vertices_scratch_.size() < slots.size()) {
            slot_vertices_scratch_.resize(slots.size());
            slot_indices_scratch_.resize(slots.size());
        }
        for (usize si = 0; si < slots.size(); ++si) {
            slot_vertices_scratch_[si].clear();
            slot_indices_scratch_[si].clear();
        }
        std::vector<std::vector<BatchVertex>>& slotVertices = slot_vertices_scratch_;
        std::vector<std::vector<u32>>& slotIndices = slot_indices_scratch_;

        for (i32 cy = minCY; cy < maxCY; ++cy) {
            for (i32 cx = minCX; cx < maxCX; ++cx) {
                tilemap::ChunkCoord coord{cx, cy};
                auto chunkIt = layer.chunks.find(coord);
                if (chunkIt == layer.chunks.end()) continue;

                const auto& chunkData = chunkIt->second;
                auto& cache = ensureChunk(layer, chunkData, coord, slots, resolved, entity, chunkCaches);

                for (usize si = 0; si < slots.size() && si < cache.slots.size(); ++si) {
                    const SlotMesh& mesh = cache.slots[si];
                    if (mesh.indices.empty()) continue;
                    u32 baseVertex = static_cast<u32>(slotVertices[si].size());
                    for (const BatchVertex& v : mesh.vertices) {
                        const f32 lx = v.position.x + originOffset.x, ly = v.position.y + originOffset.y;
                        slotVertices[si].push_back({
                            angle == 0
                                ? glm::vec3{v.position.x + adjOriginX, v.position.y + adjOriginY, depth}
                                : glm::vec3{originX + parallaxOffsetX + lx * cosAngle - ly * sinAngle,
                                            originY + parallaxOffsetY + lx * sinAngle + ly * cosAngle, depth},
                            packedColor, v.texCoord });
                    }
                    for (u32 idx : mesh.indices) {
                        slotIndices[si].push_back(baseVertex + idx);
                    }
                }
            }
        }

        // Emit one batch per tileset slot that produced geometry. Indices are
        // 0-based within each slot's merged vertices; appendIndexedBatch rebases them.
        for (usize si = 0; si < slots.size(); ++si) {
            if (!resolved[si].valid || slotIndices[si].empty()) continue;
            appendIndexedBatch(buffers, draw_list, clips,
                slotVertices[si].data(), static_cast<u32>(slotVertices[si].size()),
                slotIndices[si].data(), static_cast<u32>(slotIndices[si].size()),
                BatchDrawKey{
                    .stage = ctx.current_stage,
                    .layer = sortLayer,
                    .shaderId = batch_shader_id_,
                    .blend = BlendMode::Normal,
                    .textureId = resolved[si].glTexId,
                    // Authored, not measured: a tilemap layer is flat content stacked
                    // by a number the layer carries, so there is no world point to ask
                    // the camera how near it is. It stays a plain sort value.
                    .depth = depth,
                    .entity = entity,
                    .type = RenderType::Sprite,
                });
        }
    }

    for (auto it = layer_caches_.begin(); it != layer_caches_.end(); ) {
        if (layers.find(it->first) == layers.end()) {
            releaseLayer(it->second);
            it = layer_caches_.erase(it);
        } else {
            ++it;
        }
    }
    if (device_) evictStrips(*device_);
}

}  // namespace esengine

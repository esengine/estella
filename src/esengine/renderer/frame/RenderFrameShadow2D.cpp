// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The 2D shadow mask: what each occluder edge hides from each light.
 *
 *        The shadow is drawn rather than solved per pixel: one screen-sized
 *        mask, a channel per casting light, and the geometry each edge hides
 *        rasterised into it. So the occluder count is a vertex count rather than
 *        a shader constant, and a Lit fragment pays one read whatever it is.
 */
#include "./RenderFrame.hpp"
#include "../../core/Log.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/ShadowCaster2D.hpp"
#include "../../ecs/components/Light.hpp"
#include "../RenderTypePlugin.hpp"
#include "../../resource/ShaderParser.hpp"
#include "../rhi/ShaderEmbeds.generated.hpp"
#include "../../core/FrameProfiler.hpp"

#include <algorithm>
#include <cmath>

namespace esengine {

namespace {

/// Floats one mask vertex carries: position, how much light survives, and the
/// one-hot channel of the light it was cast from.
constexpr u32 kShadow2DFloats = 7;

/// Floats one shape-mask vertex carries: position, the cookie's uv, and the one-hot
/// channel of the light it belongs to.
constexpr u32 kShape2DFloats = 8;

/// Samples across a source that has width. A penumbra made of samples IS banded,
/// and sixteen is where the bands stop reading as rays from the corner that threw
/// them — one silhouette each, over a scene with tens of occluders.
constexpr u32 kSoftSamples = 16;

/// How far past a light's own reach a shadow is extruded. A shadow that stopped
/// exactly at the reach would end in a visible edge where the light already
/// contributes nothing, so it is carried past the point of being looked at.
constexpr f32 kShadow2DOvershoot = 1.25f;

}  // namespace

void RenderFrame::collectShadow2D(ecs::Registry& registry) {
    shadow_points_2d_.clear();
    shadow_rings_2d_.clear();
    shadow_2d_lights_.clear();
    shadow_2d_resource_ = rg::kNoResource;
    shadow_2d_texture_id_ = 0;
    context_.lights().setMask2DRect(glm::vec4(0.0f));

    auto casters = registry.view<ecs::Transform, ecs::ShadowCaster2D>();
    for (auto entity : casters) {
        const auto& caster = casters.get<ecs::ShadowCaster2D>(entity);
        if (!caster.enabled) continue;
        auto& transform = casters.get<ecs::Transform>(entity);
        transform.ensureDecomposed();
        const glm::vec3 p = transform.worldPosition;
        // The shape turns with the entity, the way a collider on it does — a wall laid
        // at an angle casts the shadow of a wall at that angle. Its SIZE is its own,
        // also like a collider's: scaling the entity does not resize the occluder.
        const glm::vec2 turn = flatTurnZ(transform.worldRotation);
        const auto place = [&](f32 lx, f32 ly) {
            return glm::vec2{p.x + lx * turn.x - ly * turn.y, p.y + lx * turn.y + ly * turn.x};
        };
        // An outline of its own, or the box. Two points enclose nothing, so a path
        // short of a triangle is not a shape and the box stands.
        if (caster.path.size() >= 3) {
            shadow_rings_2d_.push_back({static_cast<u32>(shadow_points_2d_.size()),
                                        static_cast<u32>(caster.path.size())});
            for (const glm::vec2& local : caster.path) {
                shadow_points_2d_.push_back(place(local.x, local.y));
            }
            continue;
        }
        const f32 hx = caster.size.x * 0.5f;
        const f32 hy = caster.size.y * 0.5f;
        if (hx <= 0.0f || hy <= 0.0f) continue;
        shadow_rings_2d_.push_back({static_cast<u32>(shadow_points_2d_.size()), 4});
        shadow_points_2d_.push_back(place(-hx, -hy));
        shadow_points_2d_.push_back(place(hx, -hy));
        shadow_points_2d_.push_back(place(hx, hy));
        shadow_points_2d_.push_back(place(-hx, hy));
    }
    if (shadow_rings_2d_.empty()) return;

    // Which lights the mask can carry. The collect already ordered the light array by
    // what the cap sorted on, so taking them in slot order takes the brightest first.
    const LightConstants& lights = context_.lights().data();
    for (u32 slot = 0; slot < context_.lights().count(); ++slot) {
        if (shadow_2d_lights_.size() >= MAX_SHADOW_2D_LIGHTS) break;
        const GpuLight& light = lights.lights[slot];
        if (light.color.a <= 0.0f) continue;
        const f32 type = light.posDir.z;
        Shadow2DLight entry;
        entry.slot = slot;
        entry.softness = light.shadow.x;
        if (type < 0.5f || type > 1.5f) {
            entry.pos = glm::vec2(light.posDir.x, light.posDir.y);
            entry.reach = light.posDir.w;
        } else {
            // A sun: its rays are parallel, so what a shadow needs is the direction they
            // travel and how far the author let one march. Zero distance is a sun that
            // casts none, which is the default.
            const glm::vec2 aim(light.posDir.x, light.posDir.y);
            if (light.shadow.y <= 0.0f || glm::dot(aim, aim) < 1e-8f) continue;
            entry.directional = true;
            entry.dir = glm::normalize(aim);
            entry.reach = light.shadow.y;
        }
        if (entry.reach <= 0.0f) continue;
        shadow_2d_lights_.push_back(entry);
    }
    if (shadow_2d_lights_.empty()) {
        shadow_rings_2d_.clear();
        shadow_points_2d_.clear();
        return;
    }

    for (u32 i = 0; i < shadow_2d_lights_.size(); ++i) {
        context_.lights().setLightShadow2DChannel(shadow_2d_lights_[i].slot, i);
    }

    rg::TargetDesc desc;
    desc.scale = 1.0f;
    desc.format = GfxPixelFormat::RGBA8;
    // Nearest: a fragment reads the texel it was drawn into, and a filtered read would
    // blend in the neighbouring light's shadow at a silhouette.
    desc.linearFilter = false;
    shadow_2d_resource_ = graph_.createTarget(desc);
}

void RenderFrame::releaseShadow2DResources() {
    if (shadow_2d_vbo_ != BufferHandle::Invalid) device_.deleteBuffer(shadow_2d_vbo_);
    if (shadow_2d_layout_ != VertexLayoutHandle::Invalid) device_.deleteVertexLayout(shadow_2d_layout_);
    shadow_2d_vbo_ = BufferHandle::Invalid;
    shadow_2d_vbo_bytes_ = 0;
    shadow_2d_layout_ = VertexLayoutHandle::Invalid;
}

bool RenderFrame::ensureShadow2DShader() {
    if (shadow_2d_shader_.isValid()) return true;
    if (shadow_2d_shader_tried_) return false;
    shadow_2d_shader_tried_ = true;

    auto& resources = resource_manager_;
    const auto target = resources.preferredShaderTarget();
    auto parsed = resource::ShaderParser::parse(ShaderEmbeds::SHADOW2D);
    shadow_2d_shader_ = resources.createShader(
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex, "", {}, target),
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment, "", {}, target),
        /*rewriteLoose=*/false, resources.preferredShaderLanguage());
    if (!shadow_2d_shader_.isValid()) {
        ES_LOG_ERROR("RenderFrame: no 2D shadow shader; 2D shadows are off this run");
        return false;
    }

    VertexLayoutDesc layout;
    layout.attributeCount = 3;
    layout.strides[0] = kShadow2DFloats * sizeof(f32);
    layout.attributes[0] = {0, 2, GfxDataType::Float, false, 0, 0};
    layout.attributes[1] = {1, 1, GfxDataType::Float, false, 2 * sizeof(f32), 0};
    layout.attributes[2] = {2, 4, GfxDataType::Float, false, 3 * sizeof(f32), 0};
    shadow_2d_layout_ = device_.createVertexLayout(layout);
    return shadow_2d_layout_ != VertexLayoutHandle::Invalid;
}

namespace {

/// The z of the cross product of two plane vectors — which side one turns to.
inline f32 cross2(const glm::vec2& a, const glm::vec2& b) {
    return a.x * b.y - a.y * b.x;
}

/// A unit vector at right angles to @p v; (1,0) where there is no direction to turn.
inline glm::vec2 perpendicularTo(const glm::vec2& v) {
    const f32 len = std::sqrt(v.x * v.x + v.y * v.y);
    if (len < 1e-6f) return {1.0f, 0.0f};
    return {-v.y / len, v.x / len};
}

/// Where a point lands once it is pushed away from @p from as far as @p reach.
inline glm::vec2 extrude(const glm::vec2& p, const glm::vec2& from, f32 reach) {
    const glm::vec2 d = p - from;
    const f32 len = std::sqrt(d.x * d.x + d.y * d.y);
    if (len < 1e-6f) return p;
    return p + d * (reach * kShadow2DOvershoot / len);
}

}  // namespace

void RenderFrame::buildShadow2DGeometry() {
    ES_PROFILE_SCOPE("render.shadow2d.geometry");
    shadow_2d_vertices_.clear();
    // One silhouette is two triangles, and the worst case is every ring seen by every
    // sample of every light. Reserved once so the frame's growth is not a re-alloc.
    shadow_2d_vertices_.reserve(shadow_rings_2d_.size() * shadow_2d_lights_.size()
                                * kSoftSamples * 6 * kShadow2DFloats);

    auto vertex = [this](const glm::vec2& p, f32 shadow, u32 channel) {
        shadow_2d_vertices_.push_back(p.x);
        shadow_2d_vertices_.push_back(p.y);
        shadow_2d_vertices_.push_back(shadow);
        for (u32 c = 0; c < 4; ++c) {
            shadow_2d_vertices_.push_back(c == channel ? 1.0f : 0.0f);
        }
    };
    auto triangle = [&vertex](const glm::vec2& a, f32 sa, const glm::vec2& b, f32 sb,
                              const glm::vec2& c, f32 sc, u32 channel) {
        vertex(a, sa, channel);
        vertex(b, sb, channel);
        vertex(c, sc, channel);
    };

    for (u32 channel = 0; channel < shadow_2d_lights_.size(); ++channel) {
        const Shadow2DLight& light = shadow_2d_lights_[channel];
        // A source with width is sampled across, each sample throwing the silhouette
        // it sees at its own share. The shares add, which is the soft edge: hidden from
        // every sample collects all of them, from half collects half.
        const u32 samples = light.softness > 1e-4f ? kSoftSamples : 1u;
        const f32 share = 1.0f / static_cast<f32>(samples);
        // How far a sample sits from the middle of the source, in -1..1.
        const auto offsetOf = [samples](u32 s) {
            if (samples <= 1) return 0.0f;
            return (static_cast<f32>(s) + 0.5f) / static_cast<f32>(samples) * 2.0f - 1.0f;
        };

        for (const ShadowRing2D& ring : shadow_rings_2d_) {
            const glm::vec2* pts = shadow_points_2d_.data() + ring.first;
            glm::vec2 centre{0.0f};
            for (u32 i = 0; i < ring.count; ++i) centre += pts[i];
            centre /= static_cast<f32>(ring.count);

            // What a light cannot reach it cannot be hidden from: past its own reach it
            // contributes nothing, so an occluder out there has no shadow to draw. Costs
            // one distance per ring and saves every triangle behind it.
            if (!light.directional) {
                f32 radius = 0.0f;
                for (u32 i = 0; i < ring.count; ++i) {
                    radius = std::max(radius, glm::distance(pts[i], centre));
                }
                if (glm::distance(centre, light.pos) > light.reach + light.softness + radius) {
                    continue;
                }
            }

            for (u32 s = 0; s < samples; ++s) {
                const f32 t = offsetOf(s);
                if (light.directional) {
                    // Parallel rays, so a source with width is an ANGLE rather than a
                    // place: the softness is how wide it is where its shadows end, and
                    // what a sample changes is the direction they all travel.
                    const f32 spread = (light.reach > 1e-6f) ? light.softness / light.reach : 0.0f;
                    const f32 angle = t * spread;
                    const glm::vec2 dir{
                        light.dir.x * std::cos(angle) - light.dir.y * std::sin(angle),
                        light.dir.x * std::sin(angle) + light.dir.y * std::cos(angle),
                    };
                    // The silhouette of parallel rays: the two points furthest apart
                    // across the way they travel.
                    const glm::vec2 across = perpendicularTo(dir);
                    u32 lo = 0;
                    u32 hi = 0;
                    for (u32 i = 1; i < ring.count; ++i) {
                        if (glm::dot(pts[i] - pts[lo], across) < 0.0f) lo = i;
                        if (glm::dot(pts[i] - pts[hi], across) > 0.0f) hi = i;
                    }
                    const glm::vec2 reach = dir * (light.reach * kShadow2DOvershoot);
                    triangle(pts[lo], share, pts[hi], share, pts[hi] + reach, share, channel);
                    triangle(pts[lo], share, pts[hi] + reach, share, pts[lo] + reach, share, channel);
                    continue;
                }

                // The source is a disc, so it is sampled across the diameter square to
                // what it is lighting — the direction its width actually widens.
                const glm::vec2 from =
                    light.pos + perpendicularTo(centre - light.pos) * (t * light.softness);
                // The silhouette from where this sample stands: the two points every
                // other point of the ring sits between, seen from here. A sample inside
                // the ring finds none and throws no shadow from it.
                u32 lo = 0;
                u32 hi = 0;
                for (u32 i = 1; i < ring.count; ++i) {
                    if (cross2(pts[lo] - from, pts[i] - from) < 0.0f) lo = i;
                    if (cross2(pts[hi] - from, pts[i] - from) > 0.0f) hi = i;
                }
                if (lo == hi) continue;
                const glm::vec2 farLo = extrude(pts[lo], from, light.reach);
                const glm::vec2 farHi = extrude(pts[hi], from, light.reach);
                triangle(pts[lo], share, pts[hi], share, farHi, share, channel);
                triangle(pts[lo], share, farHi, share, farLo, share, channel);
            }
        }
    }
}

void RenderFrame::declareShadow2DPass() {
    if (shadow_2d_resource_ == rg::kNoResource) return;

    rg::PassDesc mask;
    mask.name = "shadow-2d";
    mask.write = shadow_2d_resource_;
    mask.clear = true;
    // Zero is "nothing hides this light here" in all four channels, which is what a
    // frame whose geometry comes back empty has to read as.
    mask.clearColor[0] = mask.clearColor[1] = mask.clearColor[2] = 0.0f;
    mask.clearColor[3] = 0.0f;
    mask.execute = [this](const rg::PassContext&) { executeShadow2DPass(); };
    graph_.addPass(std::move(mask));
}

void RenderFrame::executeShadow2DPass() {
    if (shadow_2d_resource_ == rg::kNoResource) return;
    if (!ensureShadow2DShader()) return;

    ES_PROFILE_SCOPE("render.shadow2d");
    buildShadow2DGeometry();
    // What the mask cost, in the unit it is spent in: a shadow is triangles now, and
    // neither the count nor the occluders behind it shows in a pixel.
    ES_PROFILE_COUNTER("render.shadow2d.triangles",
                       static_cast<u32>(shadow_2d_vertices_.size() / (kShadow2DFloats * 3)));
    ES_PROFILE_COUNTER("render.shadow2d.occluders", static_cast<u32>(shadow_rings_2d_.size()));
    ES_PROFILE_COUNTER("render.shadow2d.lights", static_cast<u32>(shadow_2d_lights_.size()));
    if (shadow_2d_vertices_.empty()) return;

    const u32 bytes = static_cast<u32>(shadow_2d_vertices_.size() * sizeof(f32));
    if (shadow_2d_vbo_ == BufferHandle::Invalid || bytes > shadow_2d_vbo_bytes_) {
        if (shadow_2d_vbo_ != BufferHandle::Invalid) device_.deleteBuffer(shadow_2d_vbo_);
        // Grown in steps rather than to the exact size: the geometry follows how many
        // lights are moving, and a re-create every frame is a re-create every frame.
        shadow_2d_vbo_bytes_ = std::max(bytes * 2u, 4096u);
        shadow_2d_vbo_ = device_.createBuffer(
            {GfxBufferUsage::Vertex, shadow_2d_vbo_bytes_, /*dynamic=*/true}, nullptr);
        if (shadow_2d_vbo_ == BufferHandle::Invalid) return;
    }
    device_.updateBuffer(shadow_2d_vbo_, 0, shadow_2d_vertices_.data(), bytes);

    Shader* shader = resource_manager_.getShader(shadow_2d_shader_);
    if (!shader) return;

    PipelineDesc desc{};
    desc.program = shader->handle();
    desc.vertexLayout = shadow_2d_layout_;
    // Adding: one silhouette per sample across the source, each carrying its share, so
    // what a fragment collects is how much of the source is hidden from it. Two walls
    // over one pixel add past a whole shadow, and the read clamps.
    desc.blend = BlendMode::PmaAdditive;
    desc.blendEnabled = true;
    desc.depthTest = false;
    desc.depthWrite = false;
    device_.setPipeline(device_.createPipeline(desc));
    // The camera's own rect, as the scene pass will use it: the mask and the frame it
    // shadows have to land on the same pixels, and opening a pass resets the viewport.
    device_.setViewport(std::max(scene_viewport_.x, 0), std::max(scene_viewport_.y, 0),
                        static_cast<i32>(scene_viewport_.w), static_cast<i32>(scene_viewport_.h));
    context_.updateCameraConstants(view_projection_);
    device_.setVertexBuffer(0, shadow_2d_vbo_, 0);
    device_.setIndexBuffer(BufferHandle::Invalid);
    device_.drawArrays(0, static_cast<u32>(shadow_2d_vertices_.size() / kShadow2DFloats));

    shadow_2d_texture_id_ = static_cast<u32>(graph_.textureOf(shadow_2d_resource_));
}


// The shape mask — the same target as the shadow mask above, carrying the other half
// of "how much of this light is here": what its own cookie covers.

void RenderFrame::collectShape2D(ecs::Registry& registry) {
    shape_2d_lights_.clear();
    shape_2d_resource_ = rg::kNoResource;
    shape_2d_texture_id_ = 0;

    const LightConstants& lights = context_.lights().data();
    auto view = registry.view<ecs::Transform, ecs::Light>();
    for (auto entity : view) {
        if (shape_2d_lights_.size() >= MAX_SHAPE_2D_LIGHTS) break;
        const auto& light = view.get<ecs::Light>(entity);
        if (!light.enabled || !light.cookie.isValid()) continue;
        Texture* tex = resource_manager_.getTexture(light.cookie);
        if (!tex || tex->getId() == 0) continue;

        // The light's own slot, found by where it stands: the collect wrote the array,
        // and a light the cap dropped has no slot to give a channel to.
        const glm::vec3 p = [&] {
            auto& transform = view.get<ecs::Transform>(entity);
            transform.ensureDecomposed();
            return transform.worldPosition;
        }();
        u32 slot = MAX_LIGHTS;
        for (u32 i = 0; i < context_.lights().count(); ++i) {
            const GpuLight& gpu = lights.lights[i];
            if (gpu.posDir.z > 1.5f || gpu.posDir.z < 0.5f) {
                if (std::abs(gpu.posDir.x - p.x) < 1e-3f && std::abs(gpu.posDir.y - p.y) < 1e-3f) {
                    slot = i;
                    break;
                }
            }
        }
        if (slot >= MAX_LIGHTS) continue;

        // The light's own reach where the author named no size: a shape smaller than the
        // reach cuts the light off, and one larger is trimmed by the falloff anyway.
        const f32 reach = std::max(light.radius, 0.0f) * 2.0f;
        const f32 w = light.cookieSize.x > 0.0f ? light.cookieSize.x : reach;
        const f32 h = light.cookieSize.y > 0.0f ? light.cookieSize.y : reach;
        if (w <= 0.0f || h <= 0.0f) continue;

        auto& transform = view.get<ecs::Transform>(entity);
        const glm::vec2 turn = flatTurnZ(transform.worldRotation);
        const auto corner = [&](f32 sx, f32 sy) {
            const f32 lx = sx * w * 0.5f;
            const f32 ly = sy * h * 0.5f;
            return glm::vec2{p.x + lx * turn.x - ly * turn.y, p.y + lx * turn.y + ly * turn.x};
        };
        Shape2DLight entry;
        entry.corners[0] = corner(-1.0f, -1.0f);
        entry.corners[1] = corner(1.0f, -1.0f);
        entry.corners[2] = corner(1.0f, 1.0f);
        entry.corners[3] = corner(-1.0f, 1.0f);
        entry.texture = tex->getId();
        entry.slot = slot;
        shape_2d_lights_.push_back(entry);
    }
    if (shape_2d_lights_.empty()) return;

    for (u32 i = 0; i < shape_2d_lights_.size(); ++i) {
        context_.lights().setLightShape2DChannel(shape_2d_lights_[i].slot, i);
    }

    rg::TargetDesc desc;
    desc.scale = 1.0f;
    desc.format = GfxPixelFormat::RGBA8;
    // Linear: a cookie is artwork, and its edge is meant to be soft. The shadow mask
    // reads nearest for the opposite reason — there, a filtered read would blend in the
    // neighbouring light's silhouette.
    desc.linearFilter = true;
    shape_2d_resource_ = graph_.createTarget(desc);
}

void RenderFrame::releaseShape2DResources() {
    if (shape_2d_vbo_ != BufferHandle::Invalid) device_.deleteBuffer(shape_2d_vbo_);
    if (shape_2d_layout_ != VertexLayoutHandle::Invalid) device_.deleteVertexLayout(shape_2d_layout_);
    shape_2d_vbo_ = BufferHandle::Invalid;
    shape_2d_vbo_bytes_ = 0;
    shape_2d_layout_ = VertexLayoutHandle::Invalid;
}

bool RenderFrame::ensureShape2DShader() {
    if (shape_2d_shader_.isValid()) return true;
    if (shape_2d_shader_tried_) return false;
    shape_2d_shader_tried_ = true;

    auto& resources = resource_manager_;
    const auto target = resources.preferredShaderTarget();
    auto parsed = resource::ShaderParser::parse(ShaderEmbeds::LIGHTSHAPE2D);
    shape_2d_shader_ = resources.createShader(
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex, "", {}, target),
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment, "", {}, target),
        /*rewriteLoose=*/false, resources.preferredShaderLanguage());
    if (!shape_2d_shader_.isValid()) {
        ES_LOG_ERROR("RenderFrame: no 2D light-shape shader; shaped lights are off this run");
        return false;
    }

    VertexLayoutDesc layout;
    layout.attributeCount = 3;
    layout.strides[0] = kShape2DFloats * sizeof(f32);
    layout.attributes[0] = {0, 2, GfxDataType::Float, false, 0, 0};
    layout.attributes[1] = {1, 2, GfxDataType::Float, false, 2 * sizeof(f32), 0};
    layout.attributes[2] = {2, 4, GfxDataType::Float, false, 4 * sizeof(f32), 0};
    shape_2d_layout_ = device_.createVertexLayout(layout);
    return shape_2d_layout_ != VertexLayoutHandle::Invalid;
}

void RenderFrame::declareShape2DPass() {
    if (shape_2d_resource_ == rg::kNoResource) return;

    rg::PassDesc mask;
    mask.name = "light-shape-2d";
    mask.write = shape_2d_resource_;
    mask.clear = true;
    // Zero is "this light's shape does not reach here", which is what a frame whose
    // quads come back empty has to read as.
    mask.clearColor[0] = mask.clearColor[1] = mask.clearColor[2] = 0.0f;
    mask.clearColor[3] = 0.0f;
    mask.execute = [this](const rg::PassContext&) { executeShape2DPass(); };
    graph_.addPass(std::move(mask));
}

void RenderFrame::executeShape2DPass() {
    if (shape_2d_resource_ == rg::kNoResource) return;
    if (!ensureShape2DShader()) return;

    ES_PROFILE_SCOPE("render.lightshape2d");
    ES_PROFILE_COUNTER("render.lightshape2d.lights", static_cast<u32>(shape_2d_lights_.size()));

    shape_2d_vertices_.clear();
    for (u32 i = 0; i < shape_2d_lights_.size(); ++i) {
        const Shape2DLight& light = shape_2d_lights_[i];
        const glm::vec2 uv[4] = {{0.0f, 0.0f}, {1.0f, 0.0f}, {1.0f, 1.0f}, {0.0f, 1.0f}};
        const u32 order[6] = {0, 1, 2, 0, 2, 3};
        for (u32 k = 0; k < 6; ++k) {
            const u32 c = order[k];
            shape_2d_vertices_.push_back(light.corners[c].x);
            shape_2d_vertices_.push_back(light.corners[c].y);
            shape_2d_vertices_.push_back(uv[c].x);
            shape_2d_vertices_.push_back(uv[c].y);
            for (u32 ch = 0; ch < 4; ++ch) {
                shape_2d_vertices_.push_back(ch == i ? 1.0f : 0.0f);
            }
        }
    }
    if (shape_2d_vertices_.empty()) return;

    const u32 bytes = static_cast<u32>(shape_2d_vertices_.size() * sizeof(f32));
    if (shape_2d_vbo_ == BufferHandle::Invalid || bytes > shape_2d_vbo_bytes_) {
        if (shape_2d_vbo_ != BufferHandle::Invalid) device_.deleteBuffer(shape_2d_vbo_);
        shape_2d_vbo_bytes_ = std::max(bytes * 2u, 1024u);
        shape_2d_vbo_ = device_.createBuffer(
            {GfxBufferUsage::Vertex, shape_2d_vbo_bytes_, /*dynamic=*/true}, nullptr);
        if (shape_2d_vbo_ == BufferHandle::Invalid) return;
    }
    device_.updateBuffer(shape_2d_vbo_, 0, shape_2d_vertices_.data(), bytes);

    Shader* shader = resource_manager_.getShader(shape_2d_shader_);
    if (!shader) return;

    PipelineDesc desc{};
    desc.program = shader->handle();
    desc.vertexLayout = shape_2d_layout_;
    // Adding: the channels are independent, so what a quad writes lands only in its
    // own — and two quads of one light are not a thing this pass builds.
    desc.blend = BlendMode::PmaAdditive;
    desc.blendEnabled = true;
    desc.depthTest = false;
    desc.depthWrite = false;
    device_.setPipeline(device_.createPipeline(desc));
    device_.setViewport(std::max(scene_viewport_.x, 0), std::max(scene_viewport_.y, 0),
                        static_cast<i32>(scene_viewport_.w), static_cast<i32>(scene_viewport_.h));
    context_.updateCameraConstants(view_projection_);
    device_.setVertexBuffer(0, shape_2d_vbo_, 0);
    device_.setIndexBuffer(BufferHandle::Invalid);
    // One draw per light: the cookie is the draw's own texture, which is what an atlas
    // would exist to avoid — and four quads do not need one.
    for (u32 i = 0; i < shape_2d_lights_.size(); ++i) {
        device_.bindTexture(0, TextureHandle{shape_2d_lights_[i].texture});
        device_.drawArrays(i * 6, 6);
    }

    shape_2d_texture_id_ = static_cast<u32>(graph_.textureOf(shape_2d_resource_));
}

}  // namespace esengine

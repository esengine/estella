#include "ExternalMeshPlugin.hpp"
#include "../RenderContext.hpp"

#include <glm/gtc/type_ptr.hpp>

namespace esengine {

void ExternalMeshPlugin::submitExternalTriangles(
    const f32* vertices, i32 vertexCount,
    const u16* indices, i32 indexCount,
    u32 textureId, i32 blendMode,
    const f32* transform16,
    RenderStage stage
) {
    ExternalMeshData mesh;
    i32 floatCount = vertexCount * 8;
    mesh.vertices.assign(vertices, vertices + floatCount);
    mesh.indices.assign(indices, indices + indexCount);
    mesh.texture_id = textureId;
    mesh.blend_mode = static_cast<BlendMode>(blendMode);
    mesh.stage = stage;
    mesh.depth = 1.0f - static_cast<f32>(submit_order_++) * 0.0001f;

    if (transform16) {
        mesh.transform = glm::make_mat4(transform16);
    }

    meshes_.push_back(std::move(mesh));
}

void ExternalMeshPlugin::collect(
    ecs::Registry& registry,
    const Frustum& frustum,
    const ClipState& clips,
    TransientBufferPool& buffers,
    DrawList& draw_list,
    RenderFrameContext& ctx
) {
    (void)registry;
    (void)frustum;
    (void)clips;
    (void)buffers;

    for (u32 i = 0; i < meshes_.size(); ++i) {
        const auto& mesh = meshes_[i];

        DrawCommand cmd{};
        cmd.sort_key = DrawCommand::buildSortKey(mesh.stage, 0, 0, mesh.blend_mode, 0, mesh.texture_id, mesh.depth);
        cmd.index_offset = i;
        cmd.index_count = static_cast<u32>(mesh.indices.size());
        cmd.vertex_byte_offset = 0;
        cmd.shader_id = 0;
        cmd.blend_mode = mesh.blend_mode;
        cmd.layout_id = LayoutId::ExtMesh;
        cmd.texture_count = 1;
        cmd.texture_ids[0] = mesh.texture_id;
        cmd.entity = static_cast<Entity>(0);
        cmd.type = RenderType::ExternalMesh;
        cmd.layer = 0;

        draw_list.push(cmd);
    }
}

void ExternalMeshPlugin::customDraw(
    const DrawCommand& cmd,
    StateTracker& state,
    TransientBufferPool& buffers,
    RenderFrameContext& ctx
) {
    u32 meshIndex = cmd.index_offset;
    if (meshIndex >= meshes_.size()) return;

    (void)state;
    (void)buffers;
    (void)ctx;
}

}  // namespace esengine

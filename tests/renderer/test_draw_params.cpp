// DrawParams harness: the loose-uniform → std140 DrawParams rewriter, and the
// Shader facade that routes name-based setUniform writes into the CPU shadow +
// commitParams into the UBO seam (no loose uniform uploads for lifted members).

#include "MockGfxDevice.hpp"
#include "esengine/renderer/DrawParams.hpp"
#include "esengine/renderer/Shader.hpp"

#include <cstdio>
#include <cstring>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

static const char* FS_POSTPROCESS =
    "#version 300 es\n"
    "precision highp float;\n"
    "in vec2 v_texCoord;\n"
    "uniform sampler2D u_texture;\n"
    "uniform vec2 u_resolution;\n"
    "uniform float u_intensity;\n"
    "out vec4 fragColor;\n"
    "void main() { fragColor = vec4(u_resolution, u_intensity, 1.0); }\n";

static const char* VS_PLAIN =
    "#version 300 es\n"
    "in vec2 a_pos;\n"
    "void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }\n";

int main() {
    // ── Rewriter: lifts non-sampler uniforms, leaves samplers loose ──
    {
        auto rw = rewriteLooseUniforms(VS_PLAIN, FS_POSTPROCESS);
        CHECK(!rw.layout.empty(), "postprocess fragment lifts a block");
        CHECK(rw.layout.slots.size() == 2, "two members lifted (sampler stays)");
        CHECK(rw.fragmentSrc.find("uniform vec2 u_resolution;") == std::string::npos,
              "loose u_resolution declaration removed");
        CHECK(rw.fragmentSrc.find("uniform sampler2D u_texture;") != std::string::npos,
              "sampler declaration untouched");
        CHECK(rw.fragmentSrc.find("layout(std140) uniform DrawParams {") != std::string::npos,
              "block declaration inserted");
        CHECK(rw.vertexSrc == VS_PLAIN, "stage without loose uniforms unchanged");

        const DrawParamSlot* res = rw.layout.find("u_resolution");
        const DrawParamSlot* inten = rw.layout.find("u_intensity");
        CHECK(res && res->offset == 0, "vec2 at std140 offset 0");
        CHECK(inten && inten->offset == 8, "float packs after vec2 at offset 8");
        CHECK(rw.layout.blockSize == 16, "block size rounds to 16");
    }

    // ── Rewriter: std140 alignment (vec3 aligns to 16, mat4 = 64) ──
    {
        std::string fs =
            "#version 300 es\nprecision highp float;\n"
            "uniform float u_a;\n"
            "uniform vec3 u_b;\n"
            "uniform mat4 u_m;\n"
            "out vec4 o;\nvoid main() { o = u_m * vec4(u_b, u_a); }\n";
        auto rw = rewriteLooseUniforms(VS_PLAIN, fs);
        CHECK(rw.layout.find("u_a")->offset == 0, "float at 0");
        CHECK(rw.layout.find("u_b")->offset == 16, "vec3 aligns to 16");
        CHECK(rw.layout.find("u_m")->offset == 32, "mat4 aligns after vec3's 12 bytes");
        CHECK(rw.layout.blockSize == 96, "total 96 (32 + 64)");
    }

    // ── Rewriter: both stages share ONE identical block ──
    {
        std::string vs =
            "#version 300 es\nin vec2 a_pos;\n"
            "uniform mat4 u_projection;\n"
            "uniform mat4 u_model;\n"
            "void main() { gl_Position = u_projection * u_model * vec4(a_pos, 0.0, 1.0); }\n";
        std::string fs =
            "#version 300 es\nprecision highp float;\n"
            "uniform vec4 u_color;\n"
            "out vec4 o;\nvoid main() { o = u_color; }\n";
        auto rw = rewriteLooseUniforms(vs, fs);
        CHECK(rw.layout.slots.size() == 3, "union of both stages lifted");
        const std::string block = "layout(std140) uniform DrawParams {\n"
                                  "    mat4 u_projection;\n"
                                  "    mat4 u_model;\n"
                                  "    vec4 u_color;\n"
                                  "};";
        CHECK(rw.vertexSrc.find(block) != std::string::npos, "vertex carries the full union block");
        CHECK(rw.fragmentSrc.find(block) != std::string::npos, "fragment carries the SAME block");
        CHECK(rw.layout.find("u_color")->offset == 128, "member offsets span the union");
    }

    // ── Rewriter: leaves what it can't lift ──
    {
        std::string fs =
            "#version 300 es\nprecision highp float;\n"
            "uniform float u_arr[4];\n"          // array → stays loose
            "uniform float u_a, u_b;\n"          // multi-declarator → stays loose
            "// uniform float u_commented;\n"    // comment → ignored
            "/* uniform float u_blocked; */\n"   // comment → ignored
            "uniform float u_real;\n"
            "out vec4 o;\nvoid main() { o = vec4(u_real); }\n";
        auto rw = rewriteLooseUniforms(VS_PLAIN, fs);
        CHECK(rw.layout.slots.size() == 1, "only the plain declaration lifts");
        CHECK(rw.layout.find("u_real") != nullptr, "the plain declaration is u_real");
        CHECK(rw.fragmentSrc.find("uniform float u_arr[4];") != std::string::npos,
              "array declaration untouched");
        CHECK(rw.fragmentSrc.find("uniform float u_a, u_b;") != std::string::npos,
              "multi-declarator untouched");
    }

    // ── Rewriter: bails on an authored DrawParams block and on type conflicts ──
    {
        std::string fs = "#version 300 es\nuniform float u_x;\n"
                         "layout(std140) uniform DrawParams { float y; };\n";
        auto rw = rewriteLooseUniforms(VS_PLAIN, fs);
        CHECK(rw.layout.empty() && rw.fragmentSrc == fs, "authored DrawParams name bails");

        std::string vs2 = "#version 300 es\nuniform float u_x;\n";
        std::string fs2 = "#version 300 es\nuniform vec2 u_x;\n";
        auto rw2 = rewriteLooseUniforms(vs2, fs2);
        CHECK(rw2.layout.empty(), "cross-stage type conflict bails");
    }

    // ── Rewriter: GLSL ES 1.00 sources (no #version 300) keep loose uniforms ──
    {
        std::string vs = "attribute vec2 a_position;\nuniform mat4 u_projection;\n"
                         "void main() { gl_Position = u_projection * vec4(a_position, 0.0, 1.0); }\n";
        std::string fs = "precision highp float;\nuniform vec4 u_color;\n"
                         "void main() { gl_FragColor = u_color; }\n";
        auto rw = rewriteLooseUniforms(vs, fs);
        CHECK(rw.layout.empty(), "ES 1.00 program is not lifted");
        CHECK(rw.vertexSrc == vs && rw.fragmentSrc == fs, "ES 1.00 sources unchanged");
    }

    // ── Shader facade: lifted writes land in the shadow, not loose uploads ──
    {
        MockGfxDevice d;
        auto shader = Shader::create(d, "vs", "fs");
        auto rw = rewriteLooseUniforms(VS_PLAIN, FS_POSTPROCESS);
        shader->adoptDrawParams(rw.layout);

        CHECK(shader->hasDrawParams(), "layout adopted");
        CHECK(shader->hasUniform("u_intensity"), "hasUniform sees a block member");

        shader->setUniform("u_intensity", 0.5f);
        CHECK(d.setUniform1fCalls == 0, "lifted float write issues no loose upload");

        shader->setUniform("u_texture", 3);
        CHECK(d.setUniform1iCalls == 1, "sampler still goes through the loose path");

        // First commit creates the UBO from the shadow and binds slot 4.
        shader->commitParams();
        CHECK(d.createBufferCalls == 1, "commit creates the params UBO once");
        CHECK(d.lastBufferDesc.usage == GfxBufferUsage::Uniform, "params UBO is a uniform buffer");
        CHECK(d.lastBufferDesc.size == rw.layout.blockSize, "params UBO sized to the block");
        CHECK(d.lastUniformBufferSlot == DRAW_PARAMS_BINDING, "commit binds DRAW_PARAMS_BINDING");

        // Clean commit re-binds but does not re-upload.
        const int updatesBefore = d.updateBufferCalls;
        shader->commitParams();
        CHECK(d.updateBufferCalls == updatesBefore, "clean commit skips the upload");
        CHECK(d.setUniformBufferCalls == 2, "clean commit still re-binds the shared slot");

        // Dirty commit uploads the shadow — with the written value at its offset.
        shader->setUniform("u_resolution", glm::vec2(640.0f, 480.0f));
        shader->commitParams();
        CHECK(d.updateBufferCalls == updatesBefore + 1, "dirty commit uploads");
        f32 packed[2] = {0.0f, 0.0f};
        std::memcpy(packed, d.lastUpdateData.data() + rw.layout.find("u_resolution")->offset,
                    sizeof(packed));
        CHECK(packed[0] == 640.0f && packed[1] == 480.0f, "value lands at its std140 offset");
    }

    // ── Shader facade: mat3 expands to vec4-strided columns ──
    {
        MockGfxDevice d;
        auto shader = Shader::create(d, "vs", "fs");
        std::string fs = "#version 300 es\nuniform mat3 u_m;\n";
        auto rw = rewriteLooseUniforms(VS_PLAIN, fs);
        shader->adoptDrawParams(rw.layout);
        shader->commitParams();  // create the UBO so the next commit takes the update path

        glm::mat3 m(0.0f);
        m[1][0] = 7.0f;  // column 1, row 0
        shader->setUniform("u_m", m);
        shader->commitParams();
        f32 col1x = 0.0f;
        std::memcpy(&col1x, d.lastUpdateData.data() + 16, sizeof(f32));
        CHECK(d.lastUpdateData.size() == 48, "std140 mat3 occupies 48 bytes");
        CHECK(col1x == 7.0f, "mat3 column 1 lands at stride 16");
    }

    if (g_failures) {
        std::printf("%d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("all draw-params checks passed\n");
    return 0;
}

#include "esengine/renderer/rhi/GlslLoopFloor.hpp"

#include <cstdio>
#include <string>

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

using esengine::gfx::floorConstantLoops;

static int count(const std::string& s, const std::string& what) {
    int n = 0;
    for (std::size_t at = s.find(what); at != std::string::npos; at = s.find(what, at + what.size())) ++n;
    return n;
}

int main() {
    {
        const std::string src =
            "#version 300 es\n"
            "#ifndef VULKAN\n#extension GL_ANGLE_multi_draw : require\n#endif\n"
            "#define MESH 1\n"
            "precision highp float;\n"
            "float f(int n) { float s = 0.0; for (int i = 0; i < 8; i++) { if (i >= n) break; s += 1.0; } return s; }\n";
        const std::string out = floorConstantLoops(src);
        CHECK(out.find("for (int i = (0 + es_loopFloor); i < 8; i++)") != std::string::npos, "a literal start becomes the literal plus the floor");
        CHECK(out.find("#define MESH 1\nuniform highp int es_loopFloor;\nprecision highp float;") != std::string::npos,
              "the floor is declared after the leading directives, outside every conditional");
        CHECK(count(out, "uniform highp int es_loopFloor;") == 1, "the floor is declared once");
    }
    {
        const std::string src =
            "#version 300 es\nvoid main() {\n"
            "    for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for(int z=-1;z<=1;z++) {}\n}\n";
        const std::string out = floorConstantLoops(src);
        CHECK(out.find("for (int x = (-1 + es_loopFloor);") != std::string::npos, "a negative start keeps its sign");
        CHECK(out.find("for (int y = (-1 + es_loopFloor);") != std::string::npos, "a nested loop is floored too");
        CHECK(out.find("for(int z=(-1 + es_loopFloor);") != std::string::npos, "spacing does not hide a loop");
        CHECK(out.find("#version 300 es\nuniform highp int es_loopFloor;\nvoid main()") != std::string::npos, "with no other directive the floor follows #version");
    }
    {
        const std::string src = "#version 300 es\nvoid main() { for (highp int k = 2; k < 6; ++k) {} }\n";
        CHECK(floorConstantLoops(src).find("for (highp int k = (2 + es_loopFloor);") != std::string::npos, "a precision qualifier is read past");
    }
    {
        const std::string src =
            "#version 300 es\nuniform int u_n;\nvoid main() {\n"
            "    for (int i = u_n; i < 4; i++) {}\n"
            "    for (float t = 0.0; t < 1.0; t += 0.1) {}\n"
            "    for (int j = 0x2; j < 4; j++) {}\n"
            "    for (int k = 0 + 1; k < 4; k++) {}\n"
            "    int platform(int i); int format = 0;\n"
            "}\n";
        CHECK(floorConstantLoops(src) == src, "only an int loop that starts at a plain decimal literal is touched; with none the source is unchanged");
    }
    {
        const std::string src =
            "#version 300 es\n#ifdef ES_LINEAR\n#define TONE 1\nuniform float u_gain;\n#endif\n"
            "void main() { for (int i = 0; i < 2; i++) {} }\n";
        CHECK(floorConstantLoops(src).find("#version 300 es\nuniform highp int es_loopFloor;\n#ifdef ES_LINEAR") != std::string::npos,
              "a conditional the declarations open is not where the floor goes");
    }
    {
        const std::string src = "#version 300 es\nvoid main() {}\n";
        CHECK(floorConstantLoops(src) == src, "a source without loops gains no uniform");
    }
    std::printf("%s (%d failure%s)\n", g_failures == 0 ? "PASS" : "FAIL", g_failures, g_failures == 1 ? "" : "s");
    return g_failures == 0 ? 0 : 1;
}

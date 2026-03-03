#pragma once

namespace esengine::ShaderEmbeds {

inline constexpr const char* AXIS = R"esshader(#pragma shader "Axis"

#pragma vertex
attribute vec3 a_position;
attribute vec4 a_color;

uniform mat4 u_viewProj;

varying vec4 v_color;

void main() {
    gl_Position = u_viewProj * vec4(a_position, 1.0);
    v_color = a_color;
}
#pragma end

#pragma fragment
precision mediump float;

varying vec4 v_color;

void main() {
    gl_FragColor = v_color;
}
#pragma end
)esshader";

inline constexpr const char* BATCH = R"esshader(#pragma shader "Batch"

#pragma vertex
attribute vec3 a_position;
attribute vec4 a_color;
attribute vec2 a_texCoord;
attribute float a_texIndex;

uniform mat4 u_projection;

varying vec4 v_color;
varying vec2 v_texCoord;
varying float v_texIndex;

void main() {
    gl_Position = u_projection * vec4(a_position, 1.0);
    v_color = a_color;
    v_texCoord = a_texCoord;
    v_texIndex = a_texIndex;
}
#pragma end

#pragma fragment
precision mediump float;

varying vec4 v_color;
varying vec2 v_texCoord;
varying float v_texIndex;

uniform sampler2D u_textures[8];

void main() {
    int index = int(v_texIndex + 0.5);
    vec4 texColor;

    if (index <= 0) {
        texColor = vec4(1.0);
    } else if (index == 1) {
        texColor = texture2D(u_textures[1], v_texCoord);
    } else if (index == 2) {
        texColor = texture2D(u_textures[2], v_texCoord);
    } else if (index == 3) {
        texColor = texture2D(u_textures[3], v_texCoord);
    } else if (index == 4) {
        texColor = texture2D(u_textures[4], v_texCoord);
    } else if (index == 5) {
        texColor = texture2D(u_textures[5], v_texCoord);
    } else if (index == 6) {
        texColor = texture2D(u_textures[6], v_texCoord);
    } else {
        texColor = texture2D(u_textures[7], v_texCoord);
    }

    gl_FragColor = texColor * v_color;
}
#pragma end
)esshader";

inline constexpr const char* COLOR = R"esshader(#pragma shader "Color"

#pragma vertex
attribute vec2 a_position;

uniform mat4 u_projection;
uniform mat4 u_model;

void main() {
    gl_Position = u_projection * u_model * vec4(a_position, 0.0, 1.0);
}
#pragma end

#pragma fragment
precision mediump float;

uniform vec4 u_color;

void main() {
    gl_FragColor = u_color;
}
#pragma end
)esshader";

inline constexpr const char* GIZMO = R"esshader(#pragma shader "Gizmo"

#pragma vertex
attribute vec3 a_position;
attribute vec4 a_color;

uniform mat4 u_viewProj;
uniform mat4 u_model;

varying vec4 v_color;

void main() {
    gl_Position = u_viewProj * u_model * vec4(a_position, 1.0);
    v_color = a_color;
}
#pragma end

#pragma fragment
precision mediump float;

varying vec4 v_color;

void main() {
    gl_FragColor = v_color;
}
#pragma end
)esshader";

inline constexpr const char* GRID = R"esshader(#pragma shader "Grid"

#pragma vertex
attribute vec3 a_position;

uniform mat4 u_viewProj;

void main() {
    gl_Position = u_viewProj * vec4(a_position, 1.0);
}
#pragma end

#pragma fragment
precision mediump float;

uniform vec4 u_color;

void main() {
    gl_FragColor = u_color;
}
#pragma end
)esshader";

inline constexpr const char* SHAPE = R"esshader(#pragma shader "Shape"
#pragma version 300 es

#pragma vertex
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;
layout(location = 2) in vec4 a_color;
layout(location = 3) in vec4 a_shapeInfo;

uniform mat4 u_projection;

out vec2 v_uv;
out vec4 v_color;
out vec4 v_shapeInfo;

void main() {
    gl_Position = u_projection * vec4(a_position, 0.0, 1.0);
    v_uv = a_texCoord;
    v_color = a_color;
    v_shapeInfo = a_shapeInfo;
}
#pragma end

#pragma fragment
precision mediump float;

in vec2 v_uv;
in vec4 v_color;
in vec4 v_shapeInfo;

out vec4 fragColor;

void main() {
    vec2 halfSize = v_shapeInfo.yz;
    float cornerRadius = v_shapeInfo.w;
    vec2 p = v_uv * halfSize;

    float dist;
    float shapeType = v_shapeInfo.x;

    if (shapeType < 0.5) {
        float r = min(halfSize.x, halfSize.y);
        dist = length(p) - r;
    } else if (shapeType < 1.5) {
        float r = min(halfSize.x, halfSize.y);
        vec2 elongation = halfSize - vec2(r);
        vec2 q = abs(p) - elongation;
        dist = length(max(q, 0.0)) - r;
    } else {
        float r = min(cornerRadius, min(halfSize.x, halfSize.y));
        vec2 q = abs(p) - halfSize + vec2(r);
        dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }

    float fw = fwidth(dist);
    float alpha = 1.0 - smoothstep(-fw, fw, dist);
    if (alpha < 0.001) discard;
    fragColor = vec4(v_color.rgb, v_color.a * alpha);
}
#pragma end
)esshader";

inline constexpr const char* SPRITE = R"esshader(#pragma shader "Sprite"

#pragma vertex
attribute vec2 a_position;
attribute vec2 a_texCoord;

uniform mat4 u_projection;
uniform mat4 u_model;

varying vec2 v_texCoord;

void main() {
    gl_Position = u_projection * u_model * vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
#pragma end

#pragma fragment
precision mediump float;

uniform sampler2D u_texture;
uniform vec4 u_color;

varying vec2 v_texCoord;

void main() {
    vec4 texColor = texture2D(u_texture, v_texCoord);
    gl_FragColor = texColor * u_color;
}
#pragma end
)esshader";

inline constexpr const char* UI = R"esshader(#pragma shader "UI"

#pragma vertex
attribute vec2 a_position;
attribute vec2 a_texCoord;
attribute vec4 a_color;

uniform mat4 u_projection;

varying vec2 v_texCoord;
varying vec4 v_color;

void main() {
    gl_Position = u_projection * vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
    v_color = a_color;
}
#pragma end

#pragma fragment
precision mediump float;

uniform sampler2D u_texture;
uniform int u_useTexture;
uniform int u_useSDF;
uniform float u_sdfSmoothing;

varying vec2 v_texCoord;
varying vec4 v_color;

void main() {
    if (u_useTexture == 1) {
        if (u_useSDF == 1) {
            float dist = texture2D(u_texture, v_texCoord).a;
            float alpha = smoothstep(0.5 - u_sdfSmoothing, 0.5 + u_sdfSmoothing, dist);
            gl_FragColor = vec4(v_color.rgb, v_color.a * alpha);
        } else {
            gl_FragColor = texture2D(u_texture, v_texCoord) * v_color;
        }
    } else {
        gl_FragColor = v_color;
    }
}
#pragma end
)esshader";

}  // namespace esengine::ShaderEmbeds

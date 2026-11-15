# VFX Showcase · 奥术爆轰

一个循环播放的三维特效，用来演示引擎的特效积木怎样拼成一个完整的技能演出。九秒一轮，分三段：

| 阶段 | 时间 | 画面 |
| --- | --- | --- |
| 蓄力 | 0 – 3.6 s | 符文法阵由外向内亮起并旋转，火花被吸向能量核心，核心越涨越不稳定，地面有薄雾向内聚拢 |
| 爆发 | 3.6 – 4.6 s | 闪光、火球、贴地冲击波和空气冲击波（都会弯折背后的画面）、带地面反弹的火花、尘环、镜头震动 |
| 余烬 | 4.6 – 9 s | 余烬随湍流飘散，火球冷却成贴地消散的黑烟，热浪扭曲，地面焦痕里的熔缝慢慢熄灭 |

## 用到的引擎能力

- `ParticleEmitter.intensity`：火花、余烬、闪光的高动态范围亮度，由泛光接住。
- `builtin:particle` 材质：烟、尘、雾靠近地面和柱子时淡出（`u_softness`），烟团随年龄被侵蚀（`u_erosion`）。
- `builtin:distortion` 材质：贴地冲击波是一张平面网格，空气冲击波和热浪是粒子，三者都读整帧画面（`u_screenColor`）来弯折。
- 拉伸粒子、力场（吸引与旋涡）、湍流噪声、地面碰撞、颜色渐变与尺寸曲线、`Particle.emitAt` 定点爆发。
- 四个自定义着色器（`assets/materials/*.esshader`）：能量核心、符文法阵、辉光环、焦痕，参数由 `src/main.ts` 每帧用 `Material.setUniform` 驱动。
- 点光源强度随演出变化并投射柱子的阴影；后处理用了高度雾、泛光、色差、调色、暗角和 ACES 输出。

整段演出只由经过的时间决定（`src/timeline.ts`），所以无头逐帧步进时每一帧都能复现。

## 运行

在编辑器里打开本目录的 `project.esproject`，或从仓库根目录导出后用无头浏览器出图：

```bash
node pipeline/bin/estella.mjs export examples/vfx-showcase --out output/vfx-showcase/web --no-aot
```

```bash
node examples/vfx-showcase/tools/capture.mjs 1.2,3.3,3.8,4.0,4.8,7.5
```

截图写到 `output/vfx-showcase/frames/`，参数是要截的时间点（秒）。

## 重新生成资产

贴图、材质和场景都由一个脚本确定性地生成（需要 Python 的 `numpy` 与 `Pillow`）：

```bash
python3 examples/vfx-showcase/tools/generate.py
```

夜空环境（`assets/env/`）取自 Cyber Rooftop 示例。

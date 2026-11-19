# 风起地 · Windrise Study

Estella 原生 3D 场景与 2D HUD 示例，以《原神》蒙德风起地和荧为参考。包含大橡树、草地与花丛、远山、溪流、七天神像，以及可操控的荧。人物和神像通过 Estella 的 Tripo 集成生成；人物经过 Blender 修补、绑定检查和 Estella 动画接入。

本次习作依据日间实机截图重建了大树的主叉、外沿细枝叶、树荫下的缓坡、小径和远处的雪峰。荧的眼睛、发束、前裙、背部束带和一对飘带按默认服装细化。树根与碎石的具体分布、侧脸和动态裙摆仍与参考有差距。

## 打开与试玩

在 Estella 打开本目录的 `project.esproject`，场景为 `assets/scenes/main.esscene`。人物、神像、地形、材质、灯光和 HUD 都是可编辑资源。

仓库根目录执行：

```powershell
node pipeline/bin/estella.mjs export examples/windrise --out output/windrise/web --no-aot
node examples/windrise/tools/preview.mjs
```

访问 `http://127.0.0.1:5187/`。服务只监听本机，运行资源随 Web 包提供。

在地址末尾加上 `?view=oak` 可看向神像与大树。`?view=portrait`、`?view=body`、`?view=rear` 和 `?view=profile` 分别进入面部近景、全身正面、背面和侧面。人物对照使用固定姿势。按 P 可回到可操作的第三人称视角。

| 操作 | 按键 |
| --- | --- |
| 移动 / 冲刺 | WASD / 左 Shift |
| 跳跃 | Space |
| 环视 / 缩放 | 鼠标右键拖动或方向键 / 滚轮 |
| 风涡剑效果 | E，3 秒冷却 |
| 神像共鸣 | 走近后按 F |
| 前后视角 / 隐藏 HUD | V / P |
| 回到起点 | Home |

冲刺消耗体力，停止后恢复。行走高度跟随生成地形；水域、主树干、神像底座和样区边界限制移动。小石块和远景树不提供完整物理碰撞。刷新重置本次探索；等级与生命条用于展示。

## 资源与修改

- `src/world.ts`：地面高度、起点、神像位置。
- `src/main.ts`：移动、相机、动作驱动、体力与交互。
- `tools/build.mjs` 生成环境、材质和原生 HUD。树形由 `tools/grove.mjs` 定义，草叶、石块和石柱由 `tools/field.mjs` 定义。日间天空位于 `src/sky.ts`。
- `assets/character/lumine-final.glb` 包含 27,023 个三角面、共享骨架和五段动画。身体与飘带具有独立的网格和贴图。
- `assets/character/locomotion.esanimator`：待机、行走、跑步混合，跳跃和攻击状态。
- `assets/shrine/anemo-statue.glb`：24,281 三角面神像；场景内按 6.1 米高放置。
- `source/lumine.blend` 是可编辑的角色，`source/tripo` 保留原件，`source/paint` 保留正反面的投影绘稿和可独立调整的飘带纹样。
- `references/lumine-front.png`：本次生成使用的正面参考。
- `source/provenance.json`：参考来源、Tripo 任务及积分记录。

环境重建：`node examples/windrise/tools/build.mjs`。

从 Tripo 原件重建人物时，先用后台 Blender 依次运行 `tools/finish-character.py` 和 `tools/paint-character.py`，然后执行以下导入命令。已经包含在项目中的最终 Blender 文件可以直接编辑。

```powershell
node pipeline/bin/estella.mjs import-model examples/windrise/assets/character/lumine-final.glb --project examples/windrise --scale 100
node examples/windrise/tools/compact-clips.mjs
node examples/windrise/tools/build.mjs
```

Blender 检查脚本使用 `scenario-blender-expert` 的 `bx_audit` / `bx_review` 工具，默认从用户技能目录读取，也可用 `BLENDER_REVIEW_TOOLS` 指定。场景生成和试玩不依赖 Blender 或 Tripo 账号。

## 同机位对照

[风起地大树](source/comparisons/windrise.png) · [荧的面部](source/comparisons/lumine-face.png) · [服装正反面](source/comparisons/lumine-outfit.png) · [侧面轮廓](source/comparisons/lumine-profile.png)

对照图左栏取自原神实机参考，中栏和右栏分别是上版与本版的 Estella WebGL2 截图。树冠顶点、树根与神像底座用于对齐场景，头顶、眼线、衣摆和脚底用于对齐人物。原作截图的镜头参数未知。两栏 Estella 画面使用相同的相机坐标、角度、视场角、姿势和裁切。

`tools/photograph.mjs <Web 构建目录> <截图目录>` 拍摄五个固定视角。将同一套摄影脚本用于两版资源后，可运行 `tools/comparisons.mjs <参考图目录> <上版截图目录> <本版截图目录> <对照图目录>`。参考图名为 `windrise.png` 与 `lumine-default.jpg`，地址保存在 `source/provenance.json`。脚本先校验两版相机参数，再从原始截图裁切并排。

## 验证与已知差距

```powershell
node sdk/node_modules/typescript/bin/tsc -p examples/windrise/tsconfig.json --noEmit
node pipeline/bin/estella.mjs export examples/windrise --out output/windrise/web --no-aot --json output/windrise/export.json
node examples/windrise/tools/verify.mjs
```

验证通过无界面 Chromium 操作真实按键，检查资源加载、骨骼变化、冲刺体力、跳跃落地、技能状态恢复、摄影模式、步行抵达神像和 1280×720 布局。截图及报告输出到 `output/windrise`。这些结果证明当前 WebGL2 构建可运行，不代表移动设备、WebGPU 或编辑器交互验收。

Blender 网格检查通过。人物身体有 9 条、神像有 2 条被三个以上面共享的边警告。重建的两条飘带通过网格与贴合检查，随上身骨骼运动。头发、裙摆和手部的极端动作仍有精修空间。

角色与地点名称、造型参考来自《原神》，本项目是非官方视觉研究。参考链接及生成过程见来源记录。

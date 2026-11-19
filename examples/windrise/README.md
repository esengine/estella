# 风起地 · Windrise Study

Estella 原生 3D 场景与 2D HUD 示例，以《原神》蒙德风起地和荧为参考。包含大橡树、草地与花丛、远山、溪流、七天神像，以及可操控的荧。人物和神像通过 Estella 的 Tripo 集成生成；人物经过 Blender 修补、绑定检查和 Estella 动画接入。

当前是可运行的视觉复刻习作，尚未达到一比一：树形、地形分布、角色脸部与服饰细节、光照及动作仍与原作有差距。没有完整原作地图、任务、战斗、布料模拟或面部表情系统。

## 打开与试玩

在 Estella 打开本目录的 `project.esproject`，场景为 `assets/scenes/main.esscene`。人物、神像、地形、材质、灯光和 HUD 都是可编辑资源。

仓库根目录执行：

```powershell
node pipeline/bin/estella.mjs export examples/windrise --out output/windrise/web --no-aot
node examples/windrise/tools/preview.mjs
```

访问 `http://127.0.0.1:5187/`。服务只监听本机，运行资源随 Web 包提供。

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
- `tools/build.mjs`：确定性生成环境、场景、材质和原生 HUD；运行会覆盖这些生成资源。
- `assets/character/lumine-final.glb`：修补后的 24,791 三角面角色，含骨骼和五段动画；对应 `.esprefab`、`.esmesh`、`.estimeline` 是引擎资源。
- `assets/character/locomotion.esanimator`：待机、行走、跑步混合，跳跃和攻击状态。
- `assets/shrine/anemo-statue.glb`：24,281 三角面神像；场景内按 6.1 米高放置。
- `source/lumine.blend`：可编辑人物源文件；`source/tripo` 保留生成原件。
- `references/lumine-front.png`：本次生成使用的正面参考。
- `source/provenance.json`：参考来源、Tripo 任务及积分记录。

环境重建：`node examples/windrise/tools/build.mjs`。

重新导出人物时，后台运行 `tools/finish-character.py`，再执行：

```powershell
node pipeline/bin/estella.mjs import-model examples/windrise/assets/character/lumine-final.glb --project examples/windrise --scale 100
node examples/windrise/tools/compact-clips.mjs
node examples/windrise/tools/build.mjs
```

Blender 检查脚本使用 `scenario-blender-expert` 的 `bx_audit` / `bx_review` 工具，默认从用户技能目录读取，也可用 `BLENDER_REVIEW_TOOLS` 指定。场景生成和试玩不依赖 Blender 或 Tripo 账号。

## 验证与已知差距

```powershell
node sdk/node_modules/typescript/bin/tsc -p examples/windrise/tsconfig.json --noEmit
node pipeline/bin/estella.mjs export examples/windrise --out output/windrise/web --no-aot --json output/windrise/export.json
node examples/windrise/tools/verify.mjs
```

验证通过无界面 Chromium 操作真实按键，检查资源加载、骨骼变化、冲刺体力、跳跃落地、技能状态恢复、摄影模式、步行抵达神像和 1280×720 布局。截图及报告输出到 `output/windrise`。这些结果证明当前 WebGL2 构建可运行，不代表移动设备、WebGPU 或编辑器交互验收。

Blender 交付检查通过；人物仍有 9 条、神像仍有 2 条被三个以上面共享的边警告。人物的两段断开飘带已经桥接，并纠正了被错误分配到手骨的权重。头发和裙摆目前随已有骨骼运动，手部与关节变形仍需要人工精修。

角色与地点名称、造型参考来自《原神》，本项目是非官方视觉研究。参考链接及生成过程见来源记录。

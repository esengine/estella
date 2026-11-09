# 下城避难所 · Cyber Rooftop

以 [赛博生存建造参考图](references/target.png) 为目标搭建的 Estella 项目。世界由可编辑的 **3D 模型**构成，**2D HUD** 使用原生 Canvas、UINode、UIVisual 和 Text；没有把概念图作为游戏背景。包含屋顶安全屋、双层种植架、集装箱、管线、水处理设施、补给箱、城市建筑、广告牌、高架列车、雨、蒸汽、局部积水反射及第一人称建造工具。

这是可运行的场景重建版本，**尚未达到参考图的一比一视觉精度**：建筑表面密度、角色手部、工具造型、城市广告布局和电影级光照仍与参考图有差距。验收截图必须使用 `output/cyber-rooftop/actual.png`，不能把 `references/target.png` 当作实机证据。

## 打开与运行

在 Estella 编辑器中打开本目录的 `project.esproject`，打开 `assets/scenes/main.esscene`。本地自动验证仅使用 Blender 后台模式、CLI 和无界面 Chromium；编辑器验收留给 CI。

从仓库根目录执行：

```powershell
node pipeline/bin/estella.mjs export examples/cyber-rooftop --out output/cyber-rooftop/web --no-aot
node examples/cyber-rooftop/tools/preview.mjs
```

随后访问 `http://127.0.0.1:5186/`。预览服务仅监听本机，可用 `PORT` 环境变量指定端口。Web 包包含运行资源，不依赖纹理 CDN。

| 操作 | 按键 |
| --- | --- |
| 移动 / 加速 | WASD / 左 Shift |
| 环视 | 按住鼠标右键拖动，或方向键 |
| 回到参考构图 | Home |
| 平台 / 净水装置 | 4 / 5，或点击对应快捷栏 |
| 旋转 / 放置 | R / 在场景中单击左键 |
| 退出 / 恢复建造 | Esc / B |
| 回收右侧补给箱 | 靠近后按 F，最多四次 |

平台消耗 4 废钢、2 电子元件；净水装置消耗 8 废钢、4 电子元件。放置检查完整旋转占地、建筑区域、屋顶边缘、材料余额和已建物件。样区最多建造 12 个对象。净水装置完成任务并将饮水状态提升到 84%。生命、义体和能量目前显示样区初值；其余快捷栏是场景展示，尚无完整生存模拟、背包逻辑或存档。刷新会重置建造。

## 编辑与重建

- `tools/model.py`：确定性的模型构造源，米制、Y 向上。包含几何、UV、材质与逻辑分组；按材质合并以控制绘制批次。
- `assets/models/rooftop.glb`：可在常见 DCC 中继续编辑的模型交换文件；同目录的 `.esprefab`、`.esmesh`、`.esmaterial` 是 Estella 导入产物。
- `assets/models/characters/heroine-v01/UC_CH_Heroine_Wasteland_v01_Rigged.glb`：女主首版源资产，40,080 个三角面、4K PBR、66 根 Mixamo 骨骼及待机、行走、跑步三段原地动画。已转换为原生网格、预制体、PBR 材质和动画资源，原始 GLB 保持不变。[四视图与资产记录](references/heroine-v01/asset-manifest.json)保存在 `references/heroine-v01/`。等待引擎抓握功能后接入主场景；模型高度归一化约为 1，接入时需核对实际身高、变形和镜头效果。
- `assets/models/equipment/construction-projector-v02/UC_EQ_ConstructionProjector_v02.glb`：Tripo 智能网格建造枪，10,518 个三角面、4K PBR、13 个挂点；同目录包含对应原生资源。模型已换算为米，长约 31.5 厘米，所有节点缩放为 1。保持原有拓扑、法线、UV 与贴图，尚未替换场景中的旧工具。
- `tools/scene.mjs`：摄像机、灯光、后处理、粒子与建造对象池；通过 `tools/hud-scene.mjs` 构建原生 HUD。
- `tools/hud-scene.mjs`：按四角及底部居中锚定面板，保留可编辑的原生文字、状态值和快捷栏交互。`src/hud-layout.json` 供场景构建和运行时共用布局参数。
- `tools/textures.py`：可重建的基础表面图、招牌、HUD 象形图标与备用物品图标；需要 Python Pillow 和 Windows 微软雅黑字体。末尾调用 `tools/hud.py` 重建边框、勾选状态、按键帽和选中描边。
- `assets/textures/hud-inventory-atlas.png`：八件物品共用的透明图集；`tools/hud-inventory-frames.json` 保存各图块边界，原生 UIVisual 按 UV 引用。`hud-map.png` 是独立的区域示意底图；玩家标记由运行时更新，底图尚未根据场景自动生成。重建边框不会覆盖这两张图片。
- `assets/textures/billboard.png`、`worn-paint.png`：广告与磨损表面图；视觉规格保存在 `references/asset-prompts.txt`。
- `src/building.ts`、`src/main.ts`：空间约束及交互；场景几何和 HUD 都使用 Estella 运行时。

已有纹理保留不变，仅重建场景时执行 `node examples/cyber-rooftop/tools/scene.mjs`。仅调整 HUD 边框可执行 `python examples/cyber-rooftop/tools/hud.py`。完整重建（保留广告、磨损表面、物品图集及地图底图）：

```powershell
python examples/cyber-rooftop/tools/textures.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python examples/cyber-rooftop/tools/model.py
node pipeline/bin/estella.mjs import-model examples/cyber-rooftop/assets/models/rooftop.glb examples/cyber-rooftop/assets/models --project examples/cyber-rooftop
node examples/cyber-rooftop/tools/scene.mjs
node tools/asset-meta.js examples/cyber-rooftop/assets
```

模型脚本同时写出 `output/cyber-rooftop/cyber-rooftop.blend`。这个本地工作文件不入库；可通过源脚本重建。环境与软粒子图复用本仓库 `neon-ascension` 中的资源。

## 建造枪挂点

[挂点图](references/construction-projector-v02/socket-map.png)由实际枪模渲染；[grasp-profile.json](references/construction-projector-v02/grasp-profile.json)记录米制位置、XYZW 四元数、表面法线与角色接口约定。GLB 和原生预制体具有相同的 `Mounts` 子树：

| 节点 | 用途 |
| --- | --- |
| `Socket_Grip_R` | 握把内的握持基准；局部 +Y 沿握把向上、+Z 朝前 |
| `Socket_Palm_R`、`Socket_Thumb_R` | 右手掌心和对侧拇指接触 |
| `Socket_Index_R` | 食指在护圈外的待机接触 |
| `Socket_Middle_R`、`Socket_Ring_R`、`Socket_Pinky_R` | 中指、无名指、小指指腹接触 |
| `Guide_Middle_R`、`Guide_Ring_R`、`Guide_Pinky_R` | 三根手指绕握把前侧的表面引导 |
| `Socket_Trigger`、`Socket_Support_L` | 可选扳机按压、左手托持 |
| `Socket_Muzzle` | 发射口，局部 +Z 发射；位于前壳之外 5 毫米 |

装备根节点使用右手坐标系，+Y 向上、+Z 朝枪口。所有表面挂点的局部 +Z 为朝外法线，+Y 为握把上方向在切平面内的投影。**接触点是皮肤接触位置，不是骨骼中心**；角色手部配置需要提供腕部到握持基准的变换、指骨长度、关节限制和指腹厚度。肘部 pole 属于角色。食指按压还需检查护圈空间；当前数据不代表已完成自然抓握或动画验收。

重建挂点、重新导入和验证（只使用后台 Blender）：

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python-exit-code 1 --python examples/cyber-rooftop/tools/projector-sockets.py -- --write
node pipeline/bin/estella.mjs import-model examples/cyber-rooftop/assets/models/equipment/construction-projector-v02/UC_EQ_ConstructionProjector_v02.glb examples/cyber-rooftop/assets/models/equipment/construction-projector-v02 --project examples/cyber-rooftop
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python-exit-code 1 --python examples/cyber-rooftop/tools/projector-sockets.py -- --render
```

最后一步检查挂点贴面、四元数、预制体转换和源数据哈希，并渲染挂点图。可编辑图示场景及校验报告保存在 `output/cyber-rooftop/projector-sockets/`。之前的角色握枪试摆已保存在本地 `output/cyber-rooftop/pending-grip-integration/`，不作为已验收的主场景接入。

## 展示质量与资源约定

顶棚和上层种植灯使用向下的原生聚光灯，入口保留全向点光阴影。加上月光，共请求九块阴影图；不要把聚光灯改成全向点光来补亮，否则六面阴影会挤占其他灯的预算。使用灯光状态检查实际分配，不能仅凭 `meshShadows: true` 判断阴影已经生效。

`roof-normal.png`、`roof-orm.png` 和 `roof-wetness.png` 保存的是法线、材质参数及湿度数据，侧车文件必须保留 `sRGB: false`。参考图和制作工具通过 `assetExclude` 排除在资源导入和发布之外。

后续以实机画面与参考构图对照打磨建筑层次、近景工具和手部、湿地材质、植被与城市远景。每轮同时验收建造交互、原生 HUD、粒子与性能；记录分辨率和设备，后台节流或暂停采样不作为帧率证据。

## 验证

```powershell
node build-tools/cli.js check-examples
& ./sdk/node_modules/.bin/tsc.cmd -p examples/cyber-rooftop/tsconfig.json
node --test examples/cyber-rooftop/tools/building.test.mjs
node tools/asset-meta.js examples/cyber-rooftop/assets --check
node examples/cyber-rooftop/tools/verify.mjs
```

最后一步使用已导出的 Web 包，在真正无界面的 Chromium 中通过真实键鼠操作，检验旋转、材料扣除、重复放置拦截、取消、移动边界、净水任务、快捷栏和粒子动画。逐帧观察使用引擎原有只读 Playthrough 接口。报告与 1672×940 / 1280×720 截图写入 `output/cyber-rooftop/`。此结果不代表移动设备或编辑器验收。

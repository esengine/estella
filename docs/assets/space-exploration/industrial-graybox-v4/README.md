# 工业科幻灰模效果参考 v4

以用户提供的 modular_ship_kit.blend、kit_overview.png 和 kit_assembled.png 为造型依据，供 3D 模块材质制作、灯光设计及 2D 建造界面使用。

本包是基于灰模参考图制作的材质与光照概念图。Blender 文件已在后台只读检查；这些效果没有写回原始 .blend，也不是该文件完成贴图后的直接渲染。

## 文件

| 文件 | 内容 |
| --- | --- |
| [01-industrial-module-overview.png](01-industrial-module-overview.png) | 按灰模两排六列排列的 12 类部件效果 |
| [02-industrial-assembled-ship.png](02-industrial-assembled-ship.png) | 保留单引擎、低矮舱体、单块太阳能板和双管炮的拼装效果 |
| [03-industrial-gameplay-atmosphere.png](03-industrial-gameplay-atmosphere.png) | 同一示例舰的游戏氛围与建造模式构图 |
| [references/graybox-overview.png](references/graybox-overview.png) | 用户提供的原始总览参考 |
| [references/graybox-assembled.png](references/graybox-assembled.png) | 用户提供的原始拼装参考 |
| [source-dimensions.json](source-dimensions.json) | 原始 .blend 散列、模块结构及实测尺寸 |
| [prompts.json](prompts.json) | 完整提示词、输入图角色及依赖关系 |
| [manifest.json](manifest.json) | 原生像素尺寸、文件散列、验证范围 |

原始文件的总览路径实际为 kit_overview.png。本包采用该文件，没有依赖路径中的误写 kit_overview/ .png。

## 本轮风格

- 材质：拉丝钢、哑光涂装装甲、局部划痕、油污及黑色橡胶密封。
- 配色：低饱和深枪灰为主，每类模块仅用一种主要识别色。动力为克制青色、武器为氧化橙红、货运为旧赭黄；结构件保持中性金属。
- 接口：灰模的黄色方板作为位置标记，效果图将其解释为机械连接盖、锁扣和密封框。发光条集中在接口内部，外壳接缝不铺灯带。
- 形体：保留低矮宽体和大小模块比例，使用小幅硬倒角；喷口、转台等功能曲面按灰模保留。
- 光照：单个主光、弱轮廓光、深阴影与局部反射，少量尘埃用于表现空间。太阳能板和舱盖不发光。
- 参考：Dead Space、Alien Isolation、Starfield、Elite Dangerous、The Expanse 所指向的工业科幻材质和制造感。未复刻其具体舰船或标识。

## 原始灰模的实际结构

Blender 5.2.1 LTS 读取到公制、单位缩放 1，223 个网格对象，12 个基础模块根节点及 6 个示例舰模块根节点。

12 类基础模块为：hull_1x1x1、hull_2x2x1、hull_2x4x1、corridor_2x1x1、cockpit_2x2x1、cargo_2x2x1、reactor_2x2x1、engine_L_2x2x2、thruster_1x1x1、turret_1x1x1、solar_1x1x1、dock_1x1x1。

示例舰为 1 台大引擎、1 个反应堆舱、1 个货舱、1 个驾驶舱、1 块太阳能板和 1 座双管炮。它取代前一轮概念图的双引擎、宽体外挂货舱造型。

| 测量对象 | 实际网格外包围尺寸，米 |
| --- | --- |
| 1×1×1 船体主体 | 1.9 × 1.9 × 1.9 |
| 2×2×1 船体主体 | 3.9 × 3.9 × 1.9 |
| 2×4×1 船体主体 | 3.9 × 7.9 × 1.9 |
| 货舱主体 | 3.9 × 3.9 × 1.9 |
| 走廊 tube | 3.9 × 1.4 × 1.4 |
| 示例 +X 接口标记板 | 0.06 × 1 × 1 |

尺寸为单个命名网格的世界空间包围盒，不包含其他网格的突出装甲、接口、上盖及附件。2m 网格与 1.9m / 3.9m 外形之间的余量，不等于已验证的装配公差。

## 内部空间与后续建模

当前主体是灰盒体积，黄色 PORT 对象是实体标记板；本轮没有验证内部通道或气密连接。1m 方形接口应先按机械挂点处理。1.9m 外壳高度和 1.4m 走廊外部高度不应直接承诺可供成年角色正常站立行走。

如果游戏允许进入船内，需要另设生活舱层高、通道净空与人员门标准；可以考虑生活舱占两层网格，设备舱保留一层。应先做角色碰撞与走行白模，再建立独立内壁、地板、门框和封口盖。

效果图增加的锁扣、装甲缝、密封圈和驾驶舱表面细节属于视觉设计提案。局部接口数量与细节可能存在图像生成偏差，最终连接位置、数量、方向及尺寸以 .blend 中的 PORT 节点与经过校准的模型为准。不要从阴影或透视图反推接口公差。

## 验证范围

已检查源文件单位、根节点数量、主要网格尺寸、图像主题和主要轮廓；已核对 PNG 可解码并记录原生分辨率。未改动源 .blend，未制作生产材质、UV、贴图烘焙、LOD、碰撞或手机运行验收。原图保留实际分辨率，没有插值放大冒充 8K。

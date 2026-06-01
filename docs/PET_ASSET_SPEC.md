# AtlasOS 宠物悬浮物资源规范

本文档定义 AtlasOS 桌面宠物悬浮物资源的制作规范，面向设计师、AI 图片生成流程和后续资源包制作者。当前实现以 `src/shared/pet.ts`、`src/renderer/src/components/settings-dialog.tsx`、`src/renderer/src/PetApp.tsx` 和 `src/renderer/src/styles.css` 为准。

## 快速规格

| 项目 | 规范 |
| --- | --- |
| 宠物显示区域 | 当前渲染为 `72x72` CSS px 的方形悬浮物 |
| 推荐单帧尺寸 | `128x128` PNG/WebP，透明背景 |
| 高清源尺寸 | 可使用 `256x256` 单帧源图，再导出为 `128x128` 或直接上传 |
| 雪碧图方向 | 仅支持横向单行等宽帧 |
| 推荐雪碧图尺寸 | `1024x128`，即 `8` 帧，每帧 `128x128` |
| 帧数范围 | `1-64` |
| FPS 范围 | `1-30` |
| 默认播放 | `8` 帧，`8fps` |
| 雪碧图格式 | PNG、WebP |
| 普通图片/动图格式 | PNG、GIF、WebP |
| 视频格式 | WebM |
| 背景 | 必须透明，不要使用绿幕、白底、黑底或棋盘格 |

## 资源状态

AtlasOS 宠物资源包包含 3 个状态槽位：

| 状态 | 设置面板名称 | 使用场景 | 建议视觉 |
| --- | --- | --- | --- |
| `idle` | 待机资源 / Idle asset | 没有运行中 agent，也没有需要处理的提醒 | 轻微漂浮、呼吸、眨眼、微光 |
| `running` | 运行中资源 / Running asset | 有 Codex 或 Claude Code agent 正在执行，且没有更高优先级提醒 | 前倾、拖尾、压缩拉伸、速度感 |
| `attention` | 提醒资源 / Attention asset | 有到期事项、agent 等待确认、错误或高优先级提醒 | 脉冲、闪烁、警觉动作，但不要遮挡主体 |

状态优先级为：`attention` 高于 `running` 高于 `idle`。如果 `running` 或 `attention` 没有配置资源，界面会回退显示 `idle` 资源。

## 资源包字段

资源包内部按状态分别保存资源地址、资源类型和雪碧图播放参数：

| 状态 | 地址字段 | 类型字段 | 雪碧图参数字段 |
| --- | --- | --- | --- |
| `idle` | `idleSrc` | `idleKind` | `idleSprite` |
| `running` | `runningSrc` | `runningKind` | `runningSprite` |
| `attention` | `attentionSrc` | `attentionKind` | `attentionSprite` |

`idleKind`、`runningKind`、`attentionKind` 的可选值都是 `image`、`video`、`sprite`。

## 资源类型

每个状态槽位都可以选择以下类型之一：

| 类型 | 系统值 | 支持格式 | 播放方式 | 适用场景 |
| --- | --- | --- | --- | --- |
| 静态/动图图片 | `image` | PNG、GIF、WebP | `<img>`，`object-fit: contain` | 静态宠物、GIF/WebP 自带动画 |
| 视频 | `video` | WebM | 自动播放、循环、静音、inline | 更复杂的循环动画 |
| 横向雪碧图 | `sprite` | PNG、WebP | CSS `steps(frameCount)` 横向逐帧播放 | 推荐的可控动画格式 |

雪碧图入口只接受 PNG/WebP。普通资源入口接受 PNG/GIF/WebP/WebM。

## 雪碧图布局

雪碧图必须是横向单行等宽帧：

```text
sheetWidth  = frameWidth * frameCount
sheetHeight = frameHeight
frameWidth  = frameHeight
```

推荐标准：

| 帧数 | 单帧 | 总尺寸 | FPS | 用途 |
| --- | --- | --- | --- | --- |
| 8 | `128x128` | `1024x128` | 8 | 默认推荐，体积和表现最均衡 |
| 12 | `128x128` | `1536x128` | 12 | 更流畅的运行/提醒动画 |
| 16 | `128x128` | `2048x128` | 12-16 | 复杂循环，注意文件体积 |

虽然系统允许 `1-64` 帧，但资源包建议控制在 `8-16` 帧。帧数过高会增加图片宽度、加载成本和人工检查成本。

## 帧内安全区

以 `128x128` 单帧为例：

| 区域 | 建议 |
| --- | --- |
| 主体核心 | 保持在中心 `88x88` 到 `104x104` 区域内 |
| 发光/拖尾 | 可以扩展到 `112x112`，四周至少保留 `8px` 透明边距 |
| 运行拖尾 | 不要贴边；左侧拖尾至少保留 `4-8px` 透明边距 |
| 视觉中心 | 每帧主体中心保持稳定，避免播放时左右跳动 |
| 裁切 | 任何一帧都不能裁掉触角、外发光、拖尾或阴影 |

系统会把资源放入方形 `72x72` 宠物容器中显示。非方形帧会被视觉拉伸，因此雪碧图单帧必须按方形制作。

## 透明度与边缘

资源应导出为带 alpha 的透明 PNG/WebP。

必须避免：

- 绿幕、洋红幕、白底、黑底、棋盘格背景。
- 半透明边缘混入背景色，例如绿边、白边、黑边。
- 投影或发光被背景色污染。
- 把透明区域预乘到黑色或白色背景后再导出。

推荐：

- 使用原生透明背景生成或绘制。
- 对发光、拖尾、玻璃质感使用半透明 alpha，而不是画在纯色背景上。
- 导出后在深色背景和浅色背景各检查一次边缘。
- 检查四角像素 alpha 是否为 `0`。

## 动画设计规则

所有状态应保持同一个宠物身份：主体轮廓、颜色、脸部特征、触角/装饰位置应一致。不同状态只改变姿态、节奏和特效强度。

### Idle

- 循环应安静，适合长时间停留。
- 推荐动作：上下漂浮、轻微缩放、眨眼、柔和呼吸光。
- 避免高频闪烁或大幅位移。

### Running

- 表达“正在运行”，但仍然是悬浮物。
- 推荐动作：前倾、轻微 squash/stretch、触角回弹、蓝紫/青色拖尾、速度线。
- 避免添加腿、手、鞋、轮子、翅膀、身体或地面接触。
- 拖尾必须在每帧透明区域内完整保留。

### Attention

- 表达“需要用户处理”，但不要过度干扰。
- 推荐动作：脉冲光圈、短促抖动、提醒闪光、表情变化。
- 避免大面积红色常亮；危险色只用于明确错误态。
- 不要让提醒特效遮挡脸部或主体识别点。

## 播放参数

系统为每个状态保存独立的雪碧图播放参数：

| 字段 | 范围 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `frameCount` | `1-64` | `8` | 横向帧数量 |
| `fps` | `1-30` | `8` | 每秒播放帧数 |

实际时长计算：

```text
durationSeconds = frameCount / fps
```

例如 `8` 帧 `8fps` 的循环时长是 `1s`；`12` 帧 `12fps` 也是 `1s`。

## 文件命名建议

推荐使用稳定、可读、可自动识别的命名：

```text
atlas-pet-idle-sprite-8x128.png
atlas-pet-running-sprite-8x128.png
atlas-pet-attention-sprite-8x128.png
```

如果是普通图片或视频：

```text
atlas-pet-idle.png
atlas-pet-running.webp
atlas-pet-attention.webm
```

## AI 生成提示词模板

生成雪碧图时建议明确以下约束：

```text
Create a transparent-background horizontal sprite sheet for a small floating orb pet.
Exactly 8 frames in one row, each frame is an equal 128x128 square cell.
Total canvas size is 1024x128.
Preserve the same character identity across all frames: glossy purple-blue floating orb, simple cute face, two antenna nubs, cyan rim glow.
Use true transparent alpha background. No solid color background, no green screen, no checkerboard, no shadow plane.
Keep every frame fully inside its cell with at least 8px transparent padding.
Use a seamless looping animation.
Avoid legs, arms, torso, props, ground contact, text, watermark, cropped glow, and colored edge contamination.
```

按状态追加：

```text
Idle: gentle floating, soft breathing glow, calm expression.
Running: fast-moving state, forward lean, squash/stretch, antenna bounce, blue/cyan/purple motion trails behind the orb.
Attention: alert state, pulsing glow ring, subtle shake, expressive but readable face.
```

## 上传前验收清单

上传资源前至少检查：

- 文件格式符合入口：雪碧图为 PNG/WebP，普通资源为 PNG/GIF/WebP/WebM。
- 雪碧图为横向单行，帧宽一致。
- 单帧是方形，推荐 `128x128`。
- 总宽度等于 `单帧宽度 * frameCount`。
- 设置面板里的 `frameCount` 与真实帧数一致。
- `fps` 在 `1-30` 范围内，推荐 `8-12`。
- 背景透明，四角 alpha 为 `0`。
- 每帧主体没有裁切，播放时视觉中心稳定。
- 在深色和浅色背景下都没有绿边、白边、黑边或明显脏边。
- `idle`、`running`、`attention` 三个状态的角色身份一致。

可选自检脚本：

```python
from pathlib import Path
from PIL import Image
import sys

path = Path(sys.argv[1])
frame_count = int(sys.argv[2])
image = Image.open(path).convert("RGBA")
width, height = image.size

assert width % frame_count == 0, "sheet width must be divisible by frameCount"
assert width // frame_count == height, "each sprite frame must be square"
assert image.getpixel((0, 0))[3] == 0, "top-left pixel must be transparent"
assert image.getpixel((width - 1, 0))[3] == 0, "top-right pixel must be transparent"
assert image.getpixel((0, height - 1))[3] == 0, "bottom-left pixel must be transparent"
assert image.getpixel((width - 1, height - 1))[3] == 0, "bottom-right pixel must be transparent"

print(f"ok: {path} size={width}x{height} frames={frame_count} frame={width // frame_count}x{height}")
```

使用示例：

```powershell
python check-pet-sprite.py D:\assets\atlas-pet-running-sprite-8x128.png 8
```

## 当前实现注意事项

- 宠物容器当前固定渲染为 `72x72` CSS px；资源源图建议更大，以保证缩放后清晰。
- 雪碧图播放使用 CSS `steps(frameCount)`，不会读取图片元数据，也不会自动检测帧数。
- 系统不会自动校验雪碧图总宽度是否匹配 `frameCount`，需要制作者在上传前自行检查。
- 视频资源会静音循环播放；如果需要透明视频，使用带 alpha 的 WebM，并在目标 Electron/Chromium 环境中确认兼容性。
- 普通 GIF/WebP 动画由浏览器自身播放，不受 `frameCount` 和 `fps` 字段控制。

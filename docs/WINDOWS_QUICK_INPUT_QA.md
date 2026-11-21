# Windows 快捷输入安装版验收

## 外部编辑框自动粘贴回归

后续源码生产构建在独立测试桌面通过实际系统热键验证。Chrome 和 Edge 的多行文本框分别使用片段快捷键和搜索确认，两条路径均只触发一次粘贴。中文、表情、制表符、空行和末尾换行按原文替换了选区，一次撤销恢复原文。两款浏览器还通过了单行输入、普通 `contenteditable`、带文本框角色的富文本区域，以及密码框、只读框、同窗焦点切换和打开选择器后原选区变化的检查。独立进程中的 WPF 文本框也通过了两条入口的多行选区替换。

### 微信 4.2.0.13 的复现

在文件传输助手的空草稿中，片段快捷键和搜索回车均进入手动复制。两者捕获到的是同一个 `Qt51514QWindowIcon` 顶层窗口。切到微信搜索框后，Windows 仍报告相同的焦点窗口。UI Automation 焦点只提供 Window 和 Transform 模式，订阅焦点事件后仍未枚举到编辑框；Win32 未报告光标窗口，MSAA 光标矩形为空。

在同一空草稿手动按 Ctrl+V 成功插入测试原文，一次撤销后草稿为空。此次复现将故障定位到 AtlasOS 对原输入目标的识别，测试期间未发送消息。

### 多行片段直接粘贴（2026-11-22）

在全新配置和只公开窗口的自绘桌面编辑器中，用系统快捷键首次插入多行片段，原窗口直接收到一次粘贴。用搜索窗口选中同一片段并按一次 Enter，也只粘贴一次。两条路径均逐字保留中文、表情、制表符、空行和末尾换行。搜索期间切到其他窗口会取消插入。mintty 的两条入口均提供手动复制，终端收到零字节，剪贴板序列号未变。

### 通用窗口粘贴早期复测（含当时的多行确认流程）

使用当前源码的生产构建和独立 AtlasOS 配置，在微信 4.2.0.13 的文件传输助手中，将光标放入空草稿。片段快捷键与搜索窗口选中后按 Enter 均只插入了一份单行原文。首次使用两行片段时，确认窗口显示实际的 `Weixin.exe` 完整路径。点击允许后草稿出现两行，再用同一快捷键可直接粘贴两行。每次均通过一次撤销清空草稿，未发送消息。仅激活微信窗口时曾出现手动复制提示，点击聊天输入区后两条入口均通过。

另一个独立的自绘桌面编辑器也通过了单行插入和多行授权。普通 Enter 和 Esc 均不会授予权限，切到其他窗口会取消请求。授权在重启后生效；同名可执行文件放到另一目录会再次询问。在设置中撤销后，原路径也会再次询问。Git for Windows 的 mintty 经两条入口触发多行片段后均只提供手动复制，终端未收到字节，剪贴板序列号未变。

同一构建在 Chrome 和 Edge 通过了普通输入框、富文本、选区和撤销回归。WPF 文本框首轮出现一次表情变成 `??`，同一构建随后连续 12 轮通过直达和搜索的逐字比对。其中 6 轮记录了 WPF 选择的剪贴板格式，均为 `UnicodeText`。首次异常的原因尚未确定。

## 0.0.26 安装版历史记录

2026-11-21 在 Windows 11 x64（内部版本 26200）验证 AtlasOS 0.0.26、Electron 42.1.0。以下“直达”指用户配置的片段快捷键，“搜索”指通过窗口快捷键选择片段并按 Enter。

## 最终安装包

产品提交 `280400f` 已集成到 `codex/windows-quick-input` 的 `7fe062f`。生产构建、91 个测试文件中的 726 项测试、打包后 node-pty 文件校验和仓库测试文件跟踪校验均通过。

验收机上的标准 Windows x64 安装包为 `D:\projects\AtlasOS-quick-input-qa\release-final\AtlasOS.Setup-0.0.26.exe`，共 207457614 字节，SHA-256 为 `1A05A1B8D1B72535BB4474F7A8F96DF6E4BF49AA454AC136AFEAE97AC3A18256`。使用独立 GUID 安装同一份应用内容后，比对了以下三个文件，并核对已有 AtlasOS 0.0.23 的卸载注册与安装位置。

| 安装目录中的文件 | 与标准包相同的 SHA-256 |
| --- | --- |
| `AtlasOS.exe` | `DE1BC2943CE05EC5AFA8DD611051C5C81B2695F7643EFE3C8B7DB78ECA88049B` |
| `resources/app.asar` | `3D1F99BD4D393C90AA75D74AF4A1202A7C7DF8FC4ABA7AFE04C0A12A2E43F01B` |
| `resources/app.asar.unpacked/out/main/quick-input-helper.exe` | `D6944B53F93B2A40D9282417190214D355739F3C14678F1300CA9A0D13E89558` |

复测结束后已卸载两份带独立 GUID 的测试副本，并确认原有 AtlasOS 0.0.23 的安装文件与卸载注册仍在。标准安装包、构建产物和实测日志保留在验收目录。

## 最终安装版复测

以下日志均位于验收机的 `D:\projects\AtlasOS-quick-input-qa`。

| 实测路径 | 结果 | 日志 |
| --- | --- | --- |
| 经典记事本、现代记事本编辑控件 | 经典记事本的光标与选区分别走两种入口，中文、表情、空白、换行逐字匹配，一次撤销恢复。窗口首次唤起至取得焦点 0.326 秒，复用 0.022 秒。现代记事本的原版 RichEditD2DPT 控件也通过两条路径。 | `final-classic.log`、`final-modern-control.log` |
| 真实记事本与系统文件剪贴板 | 经用户明确授权，向交互会话的剪贴板写入一个测试文件列表。两种入口 × 光标／选区均在一次原生撤销后，由独立进程实际粘贴出同一份 CF_HDROP 文件列表。四次核对文件路径、数量与内容均通过；播种后剪贴板序列号一直为 34。 | `final-classic-file-list.log`、`final-classic-file-list-evidence.json` |
| 切窗与重复确认 | 按住直达键切走、在确认键按下后切走、选择器最小化时第三个程序取得焦点，均保留用户的新焦点，原目标与新目标均未写入。只接受一个字符的控件提示检查原处，再次确认不会重试。可从复制提示用窗口键重新搜索。 | `final-focus.log`、`final-native-negative.log` |
| 便签、Markdown、内嵌网页 | 三类编辑器各通过两种入口 × 光标／选区。原文、撤销和同窗其他输入区均正确。网页若同步把 `MiXeD` 改成大写，两种入口都会提示检查原处。 | `final-editor-sticky.log`、`final-editor-markdown.log`、`final-editor-guest.log` |
| 两个真实终端会话 | 仅原会话收到一份片段。多行仅在支持括号粘贴时提交。终端启动延迟超过 5 秒，直达与搜索均等待真实应答；在排队期间重新加载来源页面则两个会话均未收到片段。 | `final-terminal-physical.log`、`final-queue.log`、`final-queue-navigation.log` |
| 外部浏览器与剪贴板 | Chrome、Edge 两种入口均需明确点击复制，再由用户粘贴。独立窗口站内，自动插入终端后，另一进程仍能按原格式粘贴文本、加粗 RTF、文件列表和图片，也能粘贴面板打开期间新复制的文件列表。 | `final-private-chrome.log`、`final-private-edge.log`、`final-private-terminal.log` |
| 搜索与快捷键录制 | 双屏上的窗口跟随原目标，重复唤起使用新请求。录制器将 Ctrl+V 和 Shift+Insert 记录为快捷键；从右键菜单明确粘贴快捷键名称可导入 F9 并保存。 | `final-palette.log`、`final-private-recorder.log` |

### 微软拼音候选窗与回车

**通过。** 本次使用与已验收安装目录哈希一致的 0.0.26 发布程序，正常关闭主窗口到托盘。在真实记事本中选中 `original`，用已配置的 F8 唤起快捷输入。片段名称同时匹配 `ni` 和「你」，确保每次按键时均有可选片段。经授权临时启用微软拼音，测试探针在快捷输入窗口所属的 Windows 前台线程上切换并读取输入法配置，确认其为微软拼音。截图中可见系统候选列表的第一项「你」和第二项「尼」。

| 操作 | 搜索框与记事本的实际结果 |
| --- | --- |
| 输入 `ni`，候选窗显示时按 ↓、Enter | 候选窗收起，搜索框仍有焦点，查询为 `ni`；记事本原文与选区均保留。 |
| 清空查询，再输入 `ni`，按空格选中首个候选「你」 | 查询变为「你」，同一搜索请求保持打开；记事本原文与选区仍保留。 |
| 候选窗关闭后，单独按 Enter | 焦点回到记事本，片段只替换原选区一次。一次原生撤销即恢复 `Pinyin test original selection`。 |

这三步区分了候选窗的 Enter、选词和片段确认。简体微软拼音默认用 Enter 收起候选并保留输入，用空格选择当前候选。[微软拼音按键说明](https://support.microsoft.com/zh-cn/windows/hardware/input-devices/microsoft-simplified-chinese-ime)

验收前后剪贴板序列号均为 48。独立监测进程确认原前台窗口、焦点、输入法、键盘布局及输入模式均已恢复，微软拼音已回到验收前的禁用状态。本机证据位于 `ime-modern/full-native-dfyf13mi/`，包括 `evidence.jsonl`、候选显示与收起的四张截图，以及 `watchdog-confirm.json` 和 `configuration-confirm.json`。

## 首轮安装版的兼容性矩阵（`307e660`）

多行片段用 JSON 字面量表示为 `"  中文😀\t\n\n尾  \n"`，包含两个前导空格、制表符、空行、两个行尾空格和末尾换行。每个可编辑目标均核对实际文本或前台终端程序收到的数据。

| 应用和控件 | 直达与搜索的实测结果 |
| --- | --- |
| Windows 经典记事本 10.0.26100.9949，标准多行 Edit | 两种入口分别在 `one two` 中部插入或替换选中的 `two`。四次均只写一次，Windows 行尾为 CRLF，单次撤销恢复整段原文。按住片段键和重复按确认键均无额外输入。 |
| Microsoft Store 记事本 11.2609.11.0 的 RichEditD2DPT 控件 | 从已安装的 `riched20.dll` 16.0.20330.42276 加载真实控件到测试窗口。直达在光标处插入，搜索替换选区，均一次可撤销。整应用在隔离配置下启动后退出，未取得它自己的编辑窗口。 |
| AtlasOS 便签（Tiptap）、Markdown（CodeMirror）、内嵌网页 textarea | 每种编辑器均覆盖两种入口 × 中部光标／选区，共 12 次。`leftselectionright` 中只有预定位置改变，保存值与预期相同，单次撤销恢复原文。同类第二个编辑区／网页字段保持原值，网页的 input 处理器读到新值。 |
| 桌面 Edge 158.0.4370.33、Chrome 158.0.8127.36，多行 textarea | 两种实际系统键均显示选中的片段和复制按钮。Esc、主动切窗、再次按 Enter 均未复制。另在独立剪贴板上分别走两种入口，点击复制后向网页发送 Ctrl+V。`prefix suffix` 的选区 [3, 7) 替换为完整多行片段，第二个字段保持 `untouched`。 |
| AtlasOS 终端，xterm.js 6.0.0、node-pty 1.1.0、Windows ConPTY | 两个会话中的前台程序分别读取了直达与搜索收到的数据。关闭括号粘贴时单行 `"  atlas 七  "` 精确到达，无额外回车。开启后多行片段作为一次括号粘贴到达，包括末尾 LF。同伴会话无新增数据。关闭时直达多行、或已打开面板后关闭模式再确认，均提供复制，两个会话无新增数据。 |
| Git for Windows mintty 3.5.2.0 | 外部会话的粘贴模式无法由 AtlasOS 核实。两种系统键触发多行片段时均显示复制操作，取消后前台程序读取零字节，剪贴板序列号未变。 |

## 首轮剪贴板、目标失效与快捷键

- 在单独的 Windows 窗口站分别放入文本、加粗 RTF、文件列表和图片。每种格式都走直达和搜索，终端前台程序逐字收到一份多行片段。另一个进程实际粘贴并核对原文字、加粗效果、文件路径及内容、位图尺寸及指定像素。选择窗口打开后再将图片换成文件列表，确认后粘贴得到新文件列表。
- 该窗口站有独立剪贴板。测试驱动调用安装版登记的快捷键回调，在选择器最小化后将活动窗口还给原窗口；所有产品文件均来自安装目录。真实系统键和 Windows 自行恢复前台窗口由独立桌面的终端用例覆盖。经典记事本实测只读取交互窗口站的剪贴板序列号，四种插入前后均相等；尚未在记事本的同一次操作中设置图片／文件列表并跨应用粘贴验型。
- 只读和关闭的记事本控件会保留选中的片段并提供复制。实际辅助进程降至低完整性后无法捕获或写入中完整性目标。原生测试控件只接受一个字符时，安装版两种入口均显示“请检查原输入位置”，重复 Enter 只留下首次编辑。选择器确认键按下后、松键前切到另一应用，两边均未收到文字。
- 从无片段的新配置冷启动，通过设置界面创建三条片段、修改正文、删除一条。录制 F8、F10 和 Ctrl+Alt+B，检测到占用及冲突后可改键。关闭翻译、主画布关闭到托盘后，长按 5.4 秒只写一次。在设置中改为 F7，清除另两个绑定，托盘退出后其他进程可注册 F7；重启仍只显示保留的两条片段和绑定。
- 鼠标放在另一块屏幕，快捷输入窗口仍出现在原目标所在的工作区，两块工作区均为 1920 × 1032。重开窗口清空搜索并使用新请求，已删除片段、旧请求、空结果和 Esc 均无写入。开启系统双 Ctrl 翻译时，搜索框内实际按键让 Windows 钩子发出一次双 Ctrl 事件，搜索保持焦点，外部选区捕获的剪贴板读取次数为零。
- 中文组词事件通过 Chromium 测试。首轮独立桌面激活 Microsoft Pinyin 返回 `0x80004005`，真实候选窗的最终结果见上方「微软拼音候选窗与回车」。

## 首轮发现与复现记录（修复前）

在支持插入的原生 Edit 内按住 Ctrl+Alt+F9，切到另一个记事本再松键。安装版 0.0.26（`307e660`）会弹出复制提示，抢走刚切换的窗口焦点。相同手势从外部浏览器开始时，焦点正确留在新窗口。重现记录见验收目录 `installed-failure-ui/before-review-result.txt`。

带同步格式化处理器的网页另有原文确认边界。在 Chromium 的 textarea 中输入 `MiXeD`，页面的 input 处理器立即将其转为大写；浏览器编辑命令报告成功，实际值变为 `AMIXEDCDEF`。这项单独的浏览器探针与上表安装版普通网页输入框的结果分别记录。后续构建还需验证应用在终端启动排队超过 1.5 秒时的写入应答。

## 首轮构建与复核（`307e660`）

生产构建、打包后 node-pty x64 七项运行文件校验、仓库的测试文件跟踪校验均通过。本机集成回归 89 个测试文件、707 项通过；另在同一提交运行设置、持久化、系统键、搜索、翻译和终端的 94 项针对性测试，全部通过。

生产安装器 `AtlasOS.Setup-0.0.26.exe` 为 207449700 字节，SHA-256 为 `CEBF268448B68B588BDEAD121971234915E08A1AF44593FBBAAD17435A2AC094`。同目录生成了 blockmap 和 `latest.yml`。此次使用缓存的 Electron 和 node-pty 提供的 x64 预编译文件，未进行本机源码重编译。构建命令如下。

```powershell
# D:\projects\AtlasOS-quick-input-08
$env:TRAVIS_REPO_SLUG = 'liaokongVFX/AtlasOS'
npm.cmd run build
npm.cmd run ensure:electron
node_modules/.bin/electron-builder.cmd --win nsis --publish never --config.directories.output=D:/projects/AtlasOS-quick-input-qa/release --config.electronDist=D:/projects/AtlasOS/node_modules/electron/dist
npm.cmd run verify:no-tests
```

本机已注册 AtlasOS 0.0.23。验收使用同一 `win-unpacked` 内容生成带独立 GUID 的 NSIS 安装器，安装到 `D:\projects\AtlasOS-quick-input-qa\installed-08`。验证了两条卸载注册信息以及旧安装指向的路径。安装后逐个比对标准包与测试安装目录中的文件，以下 SHA-256 全部匹配。

| 文件 | SHA-256 |
| --- | --- |
| `AtlasOS.exe` | `AB0FB1A9D24F2A4D6B3D5BA64751F2517ABD6A9CEAED3F4319F02472CF0885F8` |
| `resources/app.asar` | `C8CDA9A8169D6D21273FC266C4F0902073FD0479AA0C35FB207466B62F4E0FF6` |
| `resources/app.asar.unpacked/out/main/quick-input-helper.exe` | `27C8E59314181AB848641E9CAFD16A767ED8C7F6DB61A37D57BBC58EFB689E81` |

```powershell
node_modules/.bin/electron-builder.cmd --config D:/projects/AtlasOS-quick-input-qa/isolated-builder.cjs --prepackaged D:/projects/AtlasOS-quick-input-qa/release/win-unpacked --win nsis --publish never
D:/projects/AtlasOS-quick-input-qa/qa-wrapper/AtlasOS.QuickInput.IsolatedSetup.exe /S /currentuser /D=D:\projects\AtlasOS-quick-input-qa\installed-08
```

原始记录保存在验收机的 `D:\projects\AtlasOS-quick-input-qa`。`classic/`、`palette/`、`lifecycle/`、`installed-editors/`、`browser/` 保留物理按键结果。独立剪贴板结果见 `installed-terminal.log`、`installed-edge.log`、`installed-chrome.log`。终端物理按键结果见 `installed-terminal-physical.log`、`external.log`。原生失败、翻译及输入法分别见 `installed-failure-ui/result.txt`、`native-failures.txt`、`installed-double-ctrl.log`、`ime-modern/`。

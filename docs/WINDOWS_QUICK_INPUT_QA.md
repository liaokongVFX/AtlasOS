# Windows 快捷输入安装版验收

2026-11-21 在 Windows 11 x64（内部版本 26200）验证 AtlasOS 0.0.26、Electron 42.1.0，产品代码为 `307e660`。以下“直达”指用户配置的片段快捷键，“搜索”指窗口快捷键、选择片段并按 Enter。

## 输入与实际结果

多行片段用 JSON 字面量表示为 `"  中文😀\t\n\n尾  \n"`，包含两个前导空格、制表符、空行、两个行尾空格和末尾换行。每个可编辑目标均核对实际文本或前台终端程序收到的数据。

| 应用和控件 | 直达与搜索的实测结果 |
| --- | --- |
| Windows 经典记事本 10.0.26100.9949，标准多行 Edit | 两种入口分别在 `one two` 中部插入或替换选中的 `two`。四次均只写一次，Windows 行尾为 CRLF，单次撤销恢复整段原文。按住片段键和重复按确认键均无额外输入。 |
| Microsoft Store 记事本 11.2609.11.0 的 RichEditD2DPT 控件 | 从已安装的 `riched20.dll` 16.0.20330.42276 加载真实控件到测试窗口。直达在光标处插入，搜索替换选区，均一次可撤销。整应用在隔离配置下启动后退出，未取得它自己的编辑窗口。 |
| AtlasOS 便签（Tiptap）、Markdown（CodeMirror）、内嵌网页 textarea | 每种编辑器均覆盖两种入口 × 中部光标／选区，共 12 次。`leftselectionright` 中只有预定位置改变，保存值与预期相同，单次撤销恢复原文。同类第二个编辑区／网页字段保持原值，网页的 input 处理器读到新值。 |
| 桌面 Edge 158.0.4370.33、Chrome 158.0.8127.36，多行 textarea | 两种实际系统键均显示选中的片段和复制按钮。Esc、主动切窗、再次按 Enter 均未复制。另在独立剪贴板上分别走两种入口，点击复制后向网页发送 Ctrl+V。`prefix suffix` 的选区 [3, 7) 替换为完整多行片段，第二个字段保持 `untouched`。 |
| AtlasOS 终端，xterm.js 6.0.0、node-pty 1.1.0、Windows ConPTY | 两个会话中的前台程序分别读取了直达与搜索收到的数据。关闭括号粘贴时单行 `"  atlas 七  "` 精确到达，无额外回车。开启后多行片段作为一次括号粘贴到达，包括末尾 LF。同伴会话无新增数据。关闭时直达多行、或已打开面板后关闭模式再确认，均提供复制，两个会话无新增数据。 |
| Git for Windows mintty 3.5.2.0 | 外部会话的粘贴模式无法由 AtlasOS 核实。两种系统键触发多行片段时均显示复制操作，取消后前台程序读取零字节，剪贴板序列号未变。 |

## 剪贴板、目标失效与快捷键

- 在单独的 Windows 窗口站分别放入文本、加粗 RTF、文件列表和图片。每种格式都走直达和搜索，终端前台程序逐字收到一份多行片段。另一个进程实际粘贴并核对原文字、加粗效果、文件路径及内容、位图尺寸及指定像素。选择窗口打开后再将图片换成文件列表，确认后粘贴得到新文件列表。
- 该窗口站有独立剪贴板。测试驱动调用安装版登记的快捷键回调，在选择器最小化后将活动窗口还给原窗口；所有产品文件均来自安装目录。真实系统键和 Windows 自行恢复前台窗口由独立桌面的终端用例覆盖。经典记事本实测只读取交互窗口站的剪贴板序列号，四种插入前后均相等；尚未在记事本的同一次操作中设置图片／文件列表并跨应用粘贴验型。
- 只读和关闭的记事本控件会保留选中的片段并提供复制。实际辅助进程降至低完整性后无法捕获或写入中完整性目标。原生测试控件只接受一个字符时，安装版两种入口均显示“请检查原输入位置”，重复 Enter 只留下首次编辑。选择器确认键按下后、松键前切到另一应用，两边均未收到文字。
- 从无片段的新配置冷启动，通过设置界面创建三条片段、修改正文、删除一条。录制 F8、F10 和 Ctrl+Alt+B，检测到占用及冲突后可改键。关闭翻译、主画布关闭到托盘后，长按 5.4 秒只写一次。在设置中改为 F7，清除另两个绑定，托盘退出后其他进程可注册 F7；重启仍只显示保留的两条片段和绑定。
- 鼠标放在另一块屏幕，快捷输入窗口仍出现在原目标所在的工作区，两块工作区均为 1920 × 1032。重开窗口清空搜索并使用新请求，已删除片段、旧请求、空结果和 Esc 均无写入。开启系统双 Ctrl 翻译时，搜索框内实际按键让 Windows 钩子发出一次双 Ctrl 事件，搜索保持焦点，外部选区捕获的剪贴板读取次数为零。
- 中文组词事件已通过 Chromium 测试。独立桌面向 Microsoft Pinyin 请求线程级激活得到 `0x80004005`，实际按 N、I 未打开候选窗。原生候选窗方向键和回车仍待验证。

## 待复核的行为

在支持插入的原生 Edit 内按住 Ctrl+Alt+F9，切到另一个记事本再松键。安装版 0.0.26（`307e660`）会弹出复制提示，抢走刚切换的窗口焦点。相同手势从外部浏览器开始时，焦点正确留在新窗口。重现记录见验收目录 `installed-failure-ui/before-review-result.txt`。

带同步格式化处理器的网页另有原文确认边界。在 Chromium 的 textarea 中输入 `MiXeD`，页面的 input 处理器立即将其转为大写；浏览器编辑命令报告成功，实际值变为 `AMIXEDCDEF`。这项单独的浏览器探针与上表安装版普通网页输入框的结果分别记录。后续构建还需验证应用在终端启动排队超过 1.5 秒时的写入应答。

## 构建与复核

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

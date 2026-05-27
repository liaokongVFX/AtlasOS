import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@shared/constants'

export { DEFAULT_LOCALE, LOCALES }
export type { Locale }

const zhCN = {
  'app.error.loadWorkspace': '加载工作区失败',
  'app.error.reorderCanvases': '画布排序失败',
  'app.error.saveCanvas': '保存画布失败',

  'background.background': '背景',
  'background.color': '颜色',
  'background.imageOpacity': '图片透明度',
  'background.imageUrl': '图片 URL',

  'browser.address': '地址',
  'browser.back': '后退',
  'browser.capture': '截图',
  'browser.defaultTabTitle': '示例',
  'browser.devtools': '开发者工具',
  'browser.forward': '前进',
  'browser.newTab': '新标签页',
  'browser.reload': '刷新',
  'browser.screenshotAlt': '浏览器截图',

  'canvas.createComponent': '创建组件',
  'canvas.deleteCanvas': '删除画布',
  'canvas.deleteCanvasAria': '删除 {name}',
  'canvas.deleteCanvasDescription': '删除 {name}？',
  'canvas.deleteCanvasTitle': '删除画布？',
  'canvas.findCanvasNode': '查找画布节点',
  'canvas.findCanvasNodeDescription': '搜索当前画布节点并跳转到所选节点。',
  'canvas.findNodes': '查找节点',
  'canvas.fitView': '适应视图',
  'canvas.homeName': '主页',
  'canvas.newCanvas': '新建画布',
  'canvas.newCanvasName': '画布 {index}',
  'canvas.noMatchingNodes': '没有匹配的节点。',
  'canvas.noNodes': '当前工作区没有节点。',
  'canvas.nodeListLabel': '画布节点',
  'canvas.nodes': '节点',
  'canvas.renameCanvasAria': '重命名 {name}',
  'canvas.thisCanvas': '此画布',
  'canvas.untitledName': '未命名画布',
  'canvas.zoomIn': '放大',
  'canvas.zoomOut': '缩小',

  'common.cancel': '取消',
  'common.browse': '浏览',
  'common.close': '关闭',
  'common.create': '创建',
  'common.defaults': '默认值',
  'common.delete': '删除',
  'common.disable': '停用',
  'common.enable': '启用',
  'common.name': '名称',
  'common.reload': '重新加载',
  'common.remove': '移除',
  'common.rename': '重命名',
  'common.reveal': '显示',
  'common.save': '保存',
  'common.scan': '扫描',

  'component.browser': '浏览器',
  'component.calendar': '日历',
  'component.componentFailed': '组件运行失败',
  'component.filePreview': '文件预览',
  'component.files': '文件',
  'component.kanban': '看板',
  'component.quickLauncher': '快捷启动',
  'component.markdownNote': 'Markdown 笔记',
  'component.missingPlugin': '缺失插件',
  'component.pluginUnavailable': '插件不可用',
  'component.terminal': '终端',
  'component.systemMonitor': '电脑状态',
  'component.title': '组件标题',

  'calendar.aria': '当前日期与时间：{date} {time}',
  'calendar.collapse': '折叠日历',
  'calendar.currentTime': '当前时间',
  'calendar.detail': '当前日期与时间',
  'calendar.expand': '展开日历',
  'calendar.live': '实时',
  'calendar.localTime': '本地时间',
  'calendar.monthGrid': '{month} 月历',
  'calendar.timezone': '时区',
  'calendar.today': '今天',
  'calendar.todayLabel': '今天，{date}',

  'filePreview.failedImagePreview': '图片预览加载失败。',
  'filePreview.failedRead': '读取文件失败',
  'filePreview.failedVideoPreview': '视频预览加载失败。',
  'filePreview.noFileBound': '未绑定文件',
  'filePreview.refresh': '刷新',
  'filePreview.unsupported': '此文件类型暂不支持预览。',

  'fileTree.bindTitle': '绑定文件树到文件夹',
  'fileTree.chooseFolder': '选择文件夹',
  'fileTree.collapseFolder': '收起文件夹',
  'fileTree.copyFilePath': '复制文件路径',
  'fileTree.createDescription': '在 {location} 中创建。',
  'fileTree.currentDirectory': '当前目录',
  'fileTree.deleteFile': '删除文件',
  'fileTree.deleteFileTitle': '删除文件？',
  'fileTree.deleteFolder': '删除文件夹',
  'fileTree.deleteFolderTitle': '删除文件夹？',
  'fileTree.entryActions': '{name} 操作',
  'fileTree.expandFolder': '展开文件夹',
  'fileTree.failedCopyPath': '复制文件路径失败',
  'fileTree.failedCreateFile': '创建文件失败',
  'fileTree.failedCreateFolder': '创建文件夹失败',
  'fileTree.failedLoadFolder': '加载文件夹失败',
  'fileTree.failedOpenDesktop': '打开到桌面失败',
  'fileTree.failedOpenLocation': '打开文件位置失败',
  'fileTree.failedRename': '重命名项目失败',
  'fileTree.failedTrash': '移动到回收站失败',
  'fileTree.newFile': '新建文件',
  'fileTree.newFileTitle': '新建文件',
  'fileTree.newFolder': '新建文件夹',
  'fileTree.newFolderTitle': '新建文件夹',
  'fileTree.openCommandLine': '打开命令行',
  'fileTree.openDesktop': '打开到桌面',
  'fileTree.revealLocation': '打开文件所在位置',
  'fileTree.renameDescription': '修改 {name} 的名称。',
  'fileTree.renameFileTitle': '重命名文件',
  'fileTree.renameFolderTitle': '重命名文件夹',
  'fileTree.thisItem': '该项目',
  'fileTree.trashDescription': '将 {name} 移到回收站。',

  'kanban.addCard': '添加卡片',
  'kanban.addCardAria': '在 {column} 添加卡片',
  'kanban.addColumn': '添加列',
  'kanban.assignee': '负责人',
  'kanban.clearDate': '清除日期',
  'kanban.clearFilters': '清除筛选',
  'kanban.columnSettings': '列设置',
  'kanban.columnSettingsAria': '{column} 设置',
  'kanban.date': '日期',
  'kanban.defaultCardTitle': '新卡片',
  'kanban.defaultColumn.backlog': '待办',
  'kanban.defaultColumn.doing': '进行中',
  'kanban.defaultColumn.done': '完成',
  'kanban.defaultColumnTitle': '新列',
  'kanban.deleteColumn': '删除列',
  'kanban.deleteColumnDescription': '删除 {column} 会同时删除其中 {count} 张卡片。',
  'kanban.deleteColumnTitle': '删除列？',
  'kanban.description': '描述',
  'kanban.dragCardTitle': '拖拽卡片；点击打开详情',
  'kanban.dragColumn': '拖拽列 {column}',
  'kanban.dragColumnTitle': '拖拽列',
  'kanban.dueDate': '截止日期',
  'kanban.dueDateTitle': '截止日期',
  'kanban.editCard': '编辑卡片',
  'kanban.editCardDescription': '编辑 Kanban 卡片的标题、描述、标签、优先级、负责人和截止日期。',
  'kanban.editColumnDescription': '编辑 Kanban 列名称和 WIP 限制。',
  'kanban.filter': '筛选',
  'kanban.labels': '标签',
  'kanban.labelsPlaceholder': '用逗号分隔',
  'kanban.nextWeek': '下周',
  'kanban.noCards': '暂无卡片',
  'kanban.noMatchingCards': '无匹配卡片',
  'kanban.openOrDragCard': '打开或拖拽卡片 {title}',
  'kanban.overdue': '已过期',
  'kanban.priority': '优先级',
  'kanban.priority.high': '高',
  'kanban.priority.low': '低',
  'kanban.priority.medium': '中',
  'kanban.priority.none': '无',
  'kanban.priority.urgent': '紧急',
  'kanban.renameAndLimit': '重命名与限制',
  'kanban.searchCards': '搜索卡片',
  'kanban.selectDueDate': '选择截止日期',
  'kanban.stats': '{columns} 列 · {cards} 卡片',
  'kanban.thisColumn': '该列',
  'kanban.title': '标题',
  'kanban.today': '今天',
  'kanban.tomorrow': '明天',
  'kanban.unlimited': '不限制',
  'kanban.unset': '未设置',
  'kanban.wipExceeded': '已超过 WIP 限制',
  'kanban.wipLimit': 'WIP 限制',

  'language.en': 'English',
  'language.zh': '中文',

  'markdown.defaultNote': '# AtlasOS 笔记\n\n使用 Markdown 记录耐久的工作区笔记。\n',
  'markdown.edit': '编辑',
  'markdown.preview': '预览',

  'quickLauncher.addItem': '新增快捷项',
  'quickLauncher.addTab': '新增分页',
  'quickLauncher.chooseFolder': '选择文件夹',
  'quickLauncher.command': '命令',
  'quickLauncher.commandPlaceholder': '例如 npm run dev',
  'quickLauncher.commandRequired': '请输入命令',
  'quickLauncher.cwd': '工作目录',
  'quickLauncher.cwdPlaceholder': '可选',
  'quickLauncher.defaultItemName': '快捷项',
  'quickLauncher.defaultTabName': '常用',
  'quickLauncher.deleteItem': '删除快捷项',
  'quickLauncher.deleteTab': '删除 {name}',
  'quickLauncher.deleteTabDescription': '删除 {name} 会同时删除其中 {count} 个快捷项。',
  'quickLauncher.deleteTabTitle': '删除分页？',
  'quickLauncher.dragItem': '拖拽快捷项 {name}',
  'quickLauncher.dragTab': '拖拽分页 {name}',
  'quickLauncher.editItem': '编辑快捷项',
  'quickLauncher.failedChooseFile': '选择目标失败',
  'quickLauncher.failedLaunch': '无法启动 {name}: {message}',
  'quickLauncher.itemDialogDescription': '配置快捷项名称、类型和启动目标。',
  'quickLauncher.kind.app': '程序',
  'quickLauncher.kind.command': '命令',
  'quickLauncher.kind.file': '文件',
  'quickLauncher.kind.folder': '文件夹',
  'quickLauncher.kind.url': '网址',
  'quickLauncher.launchItem': '启动 {name}',
  'quickLauncher.namePlaceholder': '留空则自动使用目标名称',
  'quickLauncher.noItems': '当前分页没有快捷项',
  'quickLauncher.noSearchResults': '没有匹配的快捷项',
  'quickLauncher.pathPlaceholder': '选择或粘贴路径',
  'quickLauncher.pathRequired': '请选择或输入路径',
  'quickLauncher.renameTab': '重命名分页',
  'quickLauncher.search': '搜索快捷项',
  'quickLauncher.searchResults': '搜索结果',
  'quickLauncher.shell': 'Shell',
  'quickLauncher.tabs': '快捷启动分页',
  'quickLauncher.targetPath': '目标路径',
  'quickLauncher.thisTab': '此分页',
  'quickLauncher.type': '类型',
  'quickLauncher.url': '网址',
  'quickLauncher.urlPlaceholder': 'https://example.com',
  'quickLauncher.urlRequired': '请输入网址',

  'systemMonitor.cpu': 'CPU',
  'systemMonitor.cpuDetail': '全部核心',
  'systemMonitor.detail': 'CPU 与内存',
  'systemMonitor.failedLoad': '无法读取系统状态：{message}',
  'systemMonitor.live': '实时',
  'systemMonitor.loading': '采集中',
  'systemMonitor.memory': '内存',
  'systemMonitor.memoryUsed': '{used} / {total}',
  'systemMonitor.updatedAt': '更新于 {time}',

  'plugin.actionFailed': '插件操作失败',
  'plugin.addFolder': '添加文件夹',
  'plugin.chooseRootTitle': '选择 AtlasOS 插件根目录',
  'plugin.diagnostics': '诊断信息',
  'plugin.failedLoadSettings': '加载插件设置失败',
  'plugin.installTitle': '安装 AtlasOS 插件',
  'plugin.noPluginSelected': '未选择插件。',
  'plugin.noPlugins': '未找到插件。',
  'plugin.noSettings': '没有插件设置。',
  'plugin.pluginRoot': '插件根目录',
  'plugin.pluginSettings': '插件设置',
  'plugin.plugins': '插件',
  'plugin.rootDirectory': '插件根目录',
  'plugin.status.disabled': '已停用',
  'plugin.status.enabled': '已启用',
  'plugin.status.error': '错误',
  'plugin.status.missing': '缺失',
  'plugin.status.running': '运行中',

  'saveState.error': '保存失败',
  'saveState.idle': '就绪',
  'saveState.saved': '已保存',
  'saveState.saving': '保存中',

  'settings.ai': 'AI',
  'settings.aiEmpty': '暂无 AI 设置。',
  'settings.closeSettings': '关闭设置',
  'settings.configure': '配置 AtlasOS。',
  'settings.displayLanguage': '显示语言',
  'settings.general': '通用',
  'settings.languageDescription': '默认使用中文，可随时切换为英文。',
  'settings.languageTitle': '语言',
  'settings.keyboardShortcuts': '键盘快捷键',
  'settings.shortcutAlreadyUsed': '快捷键已被占用',
  'settings.shortcutCreateComponent': '创建组件菜单',
  'settings.shortcutDeselectNodes': '取消选择节点',
  'settings.shortcutFindNodes': '查找节点',
  'settings.shortcutInvalid': '无效快捷键',
  'settings.open': '设置',
  'settings.pet': '宠物',
  'settings.petActionBounce': '弹跳',
  'settings.petActionFloat': '漂浮',
  'settings.petActionMapping': '动作映射',
  'settings.petActionMappingDescription': '为平静和需要注意的状态选择宠物动作。',
  'settings.petActionNone': '无',
  'settings.petActionPulse': '脉冲',
  'settings.petActionShake': '抖动',
  'settings.petAssetPack': '资源包',
  'settings.petAssetPackDescription': '为待机和提醒状态导入本地 PNG、GIF、WebP 或 WebM 文件。',
  'settings.petAttentionAsset': '提醒资源',
  'settings.petAttentionMotion': '提醒动作',
  'settings.petAttentionMotionDescription': '当有提醒或等待处理的 agent 时使用。',
  'settings.petCustomAssetName': '自定义宠物',
  'settings.petDefaultAssetName': 'Atlas 球',
  'settings.petDescription': '桌面宠物提醒、系统通知，以及运行中的 Codex / Claude Code 会话。',
  'settings.petEnableWindow': '启用宠物窗口',
  'settings.petEnableWindowDescription': 'AtlasOS 运行时显示悬浮桌面宠物。',
  'settings.petFilePathError': 'AtlasOS 无法解析这个本地文件路径。',
  'settings.petHookBridge': 'Hook 桥接',
  'settings.petHookBridgeDescription': '在 Codex 或 Claude Code hooks 中使用这个本地端点。AtlasOS 不会自动修改外部配置文件。',
  'settings.petHookBridgeUnavailable': '宠物服务运行后会显示桥接详情。',
  'settings.petIdleAsset': '待机资源',
  'settings.petIdleMotion': '待机动作',
  'settings.petIdleMotionDescription': '没有需要注意的事情时使用。',
  'settings.petNativeNotifications': '系统通知',
  'settings.petNativeNotificationsDescription': '将重要的宠物提醒同步到操作系统通知中心。',
  'settings.petRunningAgents': '运行中的 agents',
  'settings.petRunningAgentsDescription': 'hover 时显示检测到的 Codex 和 Claude Code 终端会话。',
  'settings.sections': '设置分区',

  'terminal.dropFiles': '拖放文件到这里，将路径粘贴到终端',
  'terminal.insertedAttachmentPath': '已插入附件路径',
  'terminal.insertedAttachmentPaths': '已插入 {count} 个附件路径',
  'terminal.insertedCopiedFilePath': '已插入复制的文件路径',
  'terminal.insertedCopiedFilePaths': '已插入 {count} 个复制的文件路径',
  'terminal.onlyImagesTempPath': '只有粘贴的图片可以保存到临时终端路径',
  'terminal.processExited': '进程退出，代码 {code}',
  'terminal.savedScreenshotInserted': '已保存截图并插入路径',
  'terminal.savedScreenshotsInserted': '已保存 {count} 张截图并插入路径',
  'terminal.startFailed': '启动终端失败：{message}',
  'terminal.unableInsertPastedAttachment': '无法插入粘贴的附件',
  'terminal.unableInsertPastedScreenshot': '无法插入粘贴的截图'
} as const

const enUS: Record<keyof typeof zhCN, string> = {
  'app.error.loadWorkspace': 'Failed to load workspace',
  'app.error.reorderCanvases': 'Failed to reorder canvases',
  'app.error.saveCanvas': 'Failed to save canvas',

  'background.background': 'Background',
  'background.color': 'Color',
  'background.imageOpacity': 'Image opacity',
  'background.imageUrl': 'Image URL',

  'browser.address': 'Address',
  'browser.back': 'Back',
  'browser.capture': 'Capture screenshot',
  'browser.defaultTabTitle': 'Example',
  'browser.devtools': 'Developer tools',
  'browser.forward': 'Forward',
  'browser.newTab': 'New tab',
  'browser.reload': 'Reload',
  'browser.screenshotAlt': 'Browser screenshot',

  'canvas.createComponent': 'Create component',
  'canvas.deleteCanvas': 'Delete canvas',
  'canvas.deleteCanvasAria': 'Delete {name}',
  'canvas.deleteCanvasDescription': 'Delete {name}?',
  'canvas.deleteCanvasTitle': 'Delete canvas?',
  'canvas.findCanvasNode': 'Find canvas node',
  'canvas.findCanvasNodeDescription': 'Search current canvas nodes and jump to the selected node.',
  'canvas.findNodes': 'Find nodes',
  'canvas.fitView': 'Fit view',
  'canvas.homeName': 'Home',
  'canvas.newCanvas': 'New canvas',
  'canvas.newCanvasName': 'Canvas {index}',
  'canvas.noMatchingNodes': 'No matching nodes.',
  'canvas.noNodes': 'No nodes in this workspace.',
  'canvas.nodeListLabel': 'Canvas nodes',
  'canvas.nodes': 'Nodes',
  'canvas.renameCanvasAria': 'Rename {name}',
  'canvas.thisCanvas': 'this canvas',
  'canvas.untitledName': 'Untitled Canvas',
  'canvas.zoomIn': 'Zoom in',
  'canvas.zoomOut': 'Zoom out',

  'common.cancel': 'Cancel',
  'common.browse': 'Browse',
  'common.close': 'Close',
  'common.create': 'Create',
  'common.defaults': 'Defaults',
  'common.delete': 'Delete',
  'common.disable': 'Disable',
  'common.enable': 'Enable',
  'common.name': 'Name',
  'common.reload': 'Reload',
  'common.remove': 'Remove',
  'common.rename': 'Rename',
  'common.reveal': 'Reveal',
  'common.save': 'Save',
  'common.scan': 'Scan',

  'component.browser': 'Browser',
  'component.calendar': 'Calendar',
  'component.componentFailed': 'Component failed',
  'component.filePreview': 'File Preview',
  'component.files': 'Files',
  'component.kanban': 'Kanban',
  'component.quickLauncher': 'Quick Launcher',
  'component.markdownNote': 'Markdown Note',
  'component.missingPlugin': 'Missing plugin',
  'component.pluginUnavailable': 'Plugin unavailable',
  'component.terminal': 'Terminal',
  'component.systemMonitor': 'System Monitor',
  'component.title': 'Component title',

  'calendar.aria': 'Current date and time: {date} {time}',
  'calendar.collapse': 'Collapse calendar',
  'calendar.currentTime': 'Current time',
  'calendar.detail': 'Current date and time',
  'calendar.expand': 'Expand calendar',
  'calendar.live': 'Live',
  'calendar.localTime': 'Local time',
  'calendar.monthGrid': '{month} calendar',
  'calendar.timezone': 'Time zone',
  'calendar.today': 'Today',
  'calendar.todayLabel': 'Today, {date}',

  'filePreview.failedImagePreview': 'Failed to load image preview.',
  'filePreview.failedRead': 'Failed to read file',
  'filePreview.failedVideoPreview': 'Failed to load video preview.',
  'filePreview.noFileBound': 'No file bound',
  'filePreview.refresh': 'Refresh',
  'filePreview.unsupported': 'Preview is not available for this file type.',

  'fileTree.bindTitle': 'Bind file tree to folder',
  'fileTree.chooseFolder': 'Choose folder',
  'fileTree.collapseFolder': 'Collapse folder',
  'fileTree.copyFilePath': 'Copy file path',
  'fileTree.createDescription': 'Create in {location}.',
  'fileTree.currentDirectory': 'current directory',
  'fileTree.deleteFile': 'Delete file',
  'fileTree.deleteFileTitle': 'Delete file?',
  'fileTree.deleteFolder': 'Delete folder',
  'fileTree.deleteFolderTitle': 'Delete folder?',
  'fileTree.entryActions': '{name} actions',
  'fileTree.expandFolder': 'Expand folder',
  'fileTree.failedCopyPath': 'Failed to copy file path',
  'fileTree.failedCreateFile': 'Failed to create file',
  'fileTree.failedCreateFolder': 'Failed to create folder',
  'fileTree.failedLoadFolder': 'Failed to load folder',
  'fileTree.failedOpenDesktop': 'Failed to open file on desktop',
  'fileTree.failedOpenLocation': 'Failed to open file location',
  'fileTree.failedRename': 'Failed to rename item',
  'fileTree.failedTrash': 'Failed to move item to recycle bin',
  'fileTree.newFile': 'New file',
  'fileTree.newFileTitle': 'New file',
  'fileTree.newFolder': 'New folder',
  'fileTree.newFolderTitle': 'New folder',
  'fileTree.openCommandLine': 'Open command line',
  'fileTree.openDesktop': 'Open on desktop',
  'fileTree.revealLocation': 'Reveal in folder',
  'fileTree.renameDescription': 'Change the name for {name}.',
  'fileTree.renameFileTitle': 'Rename file',
  'fileTree.renameFolderTitle': 'Rename folder',
  'fileTree.thisItem': 'this item',
  'fileTree.trashDescription': 'Move {name} to the recycle bin.',

  'kanban.addCard': 'Add card',
  'kanban.addCardAria': 'Add card to {column}',
  'kanban.addColumn': 'Add column',
  'kanban.assignee': 'Assignee',
  'kanban.clearDate': 'Clear date',
  'kanban.clearFilters': 'Clear filters',
  'kanban.columnSettings': 'Column settings',
  'kanban.columnSettingsAria': '{column} settings',
  'kanban.date': 'Date',
  'kanban.defaultCardTitle': 'New card',
  'kanban.defaultColumn.backlog': 'To do',
  'kanban.defaultColumn.doing': 'In progress',
  'kanban.defaultColumn.done': 'Done',
  'kanban.defaultColumnTitle': 'New column',
  'kanban.deleteColumn': 'Delete column',
  'kanban.deleteColumnDescription': 'Deleting {column} will also delete {count} cards in it.',
  'kanban.deleteColumnTitle': 'Delete column?',
  'kanban.description': 'Description',
  'kanban.dragCardTitle': 'Drag card; click to open details',
  'kanban.dragColumn': 'Drag column {column}',
  'kanban.dragColumnTitle': 'Drag column',
  'kanban.dueDate': 'Due date',
  'kanban.dueDateTitle': 'Due date',
  'kanban.editCard': 'Edit card',
  'kanban.editCardDescription': 'Edit the Kanban card title, description, labels, priority, assignee, and due date.',
  'kanban.editColumnDescription': 'Edit the Kanban column name and WIP limit.',
  'kanban.filter': 'Filter',
  'kanban.labels': 'Labels',
  'kanban.labelsPlaceholder': 'Separate with commas',
  'kanban.nextWeek': 'Next week',
  'kanban.noCards': 'No cards',
  'kanban.noMatchingCards': 'No matching cards',
  'kanban.openOrDragCard': 'Open or drag card {title}',
  'kanban.overdue': 'Overdue',
  'kanban.priority': 'Priority',
  'kanban.priority.high': 'High',
  'kanban.priority.low': 'Low',
  'kanban.priority.medium': 'Medium',
  'kanban.priority.none': 'None',
  'kanban.priority.urgent': 'Urgent',
  'kanban.renameAndLimit': 'Rename and limit',
  'kanban.searchCards': 'Search cards',
  'kanban.selectDueDate': 'Select due date',
  'kanban.stats': '{columns} columns · {cards} cards',
  'kanban.thisColumn': 'this column',
  'kanban.title': 'Title',
  'kanban.today': 'Today',
  'kanban.tomorrow': 'Tomorrow',
  'kanban.unlimited': 'Unlimited',
  'kanban.unset': 'Not set',
  'kanban.wipExceeded': 'WIP limit exceeded',
  'kanban.wipLimit': 'WIP limit',

  'language.en': 'English',
  'language.zh': '中文',

  'markdown.defaultNote': '# AtlasOS note\n\nUse Markdown for durable workspace notes.\n',
  'markdown.edit': 'Edit',
  'markdown.preview': 'Preview',

  'quickLauncher.addItem': 'Add shortcut',
  'quickLauncher.addTab': 'Add tab',
  'quickLauncher.chooseFolder': 'Choose folder',
  'quickLauncher.command': 'Command',
  'quickLauncher.commandPlaceholder': 'For example npm run dev',
  'quickLauncher.commandRequired': 'Enter a command',
  'quickLauncher.cwd': 'Working directory',
  'quickLauncher.cwdPlaceholder': 'Optional',
  'quickLauncher.defaultItemName': 'Shortcut',
  'quickLauncher.defaultTabName': 'Favorites',
  'quickLauncher.deleteItem': 'Delete shortcut',
  'quickLauncher.deleteTab': 'Delete {name}',
  'quickLauncher.deleteTabDescription': 'Deleting {name} will also delete {count} shortcuts in it.',
  'quickLauncher.deleteTabTitle': 'Delete tab?',
  'quickLauncher.dragItem': 'Drag shortcut {name}',
  'quickLauncher.dragTab': 'Drag tab {name}',
  'quickLauncher.editItem': 'Edit shortcut',
  'quickLauncher.failedChooseFile': 'Failed to choose target',
  'quickLauncher.failedLaunch': 'Unable to launch {name}: {message}',
  'quickLauncher.itemDialogDescription': 'Configure the shortcut name, type, and launch target.',
  'quickLauncher.kind.app': 'App',
  'quickLauncher.kind.command': 'Command',
  'quickLauncher.kind.file': 'File',
  'quickLauncher.kind.folder': 'Folder',
  'quickLauncher.kind.url': 'URL',
  'quickLauncher.launchItem': 'Launch {name}',
  'quickLauncher.namePlaceholder': 'Blank uses the target name',
  'quickLauncher.noItems': 'No shortcuts in this tab',
  'quickLauncher.noSearchResults': 'No matching shortcuts',
  'quickLauncher.pathPlaceholder': 'Choose or paste a path',
  'quickLauncher.pathRequired': 'Choose or enter a path',
  'quickLauncher.renameTab': 'Rename tab',
  'quickLauncher.search': 'Search shortcuts',
  'quickLauncher.searchResults': 'Search results',
  'quickLauncher.shell': 'Shell',
  'quickLauncher.tabs': 'Quick launcher tabs',
  'quickLauncher.targetPath': 'Target path',
  'quickLauncher.thisTab': 'this tab',
  'quickLauncher.type': 'Type',
  'quickLauncher.url': 'URL',
  'quickLauncher.urlPlaceholder': 'https://example.com',
  'quickLauncher.urlRequired': 'Enter a URL',

  'systemMonitor.cpu': 'CPU',
  'systemMonitor.cpuDetail': 'All cores',
  'systemMonitor.detail': 'CPU and memory',
  'systemMonitor.failedLoad': 'Unable to read system status: {message}',
  'systemMonitor.live': 'Live',
  'systemMonitor.loading': 'Collecting',
  'systemMonitor.memory': 'Memory',
  'systemMonitor.memoryUsed': '{used} / {total}',
  'systemMonitor.updatedAt': 'Updated {time}',

  'plugin.actionFailed': 'Plugin action failed',
  'plugin.addFolder': 'Add folder',
  'plugin.chooseRootTitle': 'Choose AtlasOS plugin root',
  'plugin.diagnostics': 'Diagnostics',
  'plugin.failedLoadSettings': 'Failed to load plugin settings',
  'plugin.installTitle': 'Install AtlasOS plugin',
  'plugin.noPluginSelected': 'No plugin selected.',
  'plugin.noPlugins': 'No plugins found.',
  'plugin.noSettings': 'No plugin settings.',
  'plugin.pluginRoot': 'Plugin root',
  'plugin.pluginSettings': 'Plugin settings',
  'plugin.plugins': 'Plugins',
  'plugin.rootDirectory': 'Plugin root directory',
  'plugin.status.disabled': 'disabled',
  'plugin.status.enabled': 'enabled',
  'plugin.status.error': 'error',
  'plugin.status.missing': 'missing',
  'plugin.status.running': 'running',

  'saveState.error': 'Error',
  'saveState.idle': 'Ready',
  'saveState.saved': 'Saved',
  'saveState.saving': 'Saving',

  'settings.ai': 'AI',
  'settings.aiEmpty': 'No AI settings yet.',
  'settings.closeSettings': 'Close settings',
  'settings.configure': 'Configure AtlasOS.',
  'settings.displayLanguage': 'Display language',
  'settings.general': 'General',
  'settings.languageDescription': 'Chinese is the default. You can switch to English at any time.',
  'settings.languageTitle': 'Language',
  'settings.keyboardShortcuts': 'Keyboard shortcuts',
  'settings.shortcutAlreadyUsed': 'Shortcut already used',
  'settings.shortcutCreateComponent': 'Open create menu',
  'settings.shortcutDeselectNodes': 'Deselect nodes',
  'settings.shortcutFindNodes': 'Find nodes',
  'settings.shortcutInvalid': 'Invalid shortcut',
  'settings.open': 'Settings',
  'settings.pet': 'Pet',
  'settings.petActionBounce': 'Bounce',
  'settings.petActionFloat': 'Float',
  'settings.petActionMapping': 'Action mapping',
  'settings.petActionMappingDescription': 'Choose the pet motion for calm and attention states.',
  'settings.petActionNone': 'None',
  'settings.petActionPulse': 'Pulse',
  'settings.petActionShake': 'Shake',
  'settings.petAssetPack': 'Asset pack',
  'settings.petAssetPackDescription': 'Import local PNG, GIF, WebP, or WebM files for the idle and attention pet states.',
  'settings.petAttentionAsset': 'Attention asset',
  'settings.petAttentionMotion': 'Attention motion',
  'settings.petAttentionMotionDescription': 'Used when alerts or waiting agents need action.',
  'settings.petCustomAssetName': 'Custom pet',
  'settings.petDefaultAssetName': 'Atlas Orb',
  'settings.petDescription': 'Desktop pet reminders, native notifications, and running Codex / Claude Code sessions.',
  'settings.petEnableWindow': 'Enable pet window',
  'settings.petEnableWindowDescription': 'Show the floating desktop pet while AtlasOS is running.',
  'settings.petFilePathError': 'AtlasOS could not resolve this local file path.',
  'settings.petHookBridge': 'Hook bridge',
  'settings.petHookBridgeDescription': 'Use this local endpoint from Codex or Claude Code hooks. AtlasOS does not edit external config files automatically.',
  'settings.petHookBridgeUnavailable': 'Bridge details will appear when the pet service is running.',
  'settings.petIdleAsset': 'Idle asset',
  'settings.petIdleMotion': 'Idle motion',
  'settings.petIdleMotionDescription': 'Used when nothing needs attention.',
  'settings.petNativeNotifications': 'Native notifications',
  'settings.petNativeNotificationsDescription': 'Mirror important pet alerts into the OS notification center.',
  'settings.petRunningAgents': 'Running agents',
  'settings.petRunningAgentsDescription': 'Show detected Codex and Claude Code terminal sessions on hover.',
  'settings.sections': 'Settings sections',

  'terminal.dropFiles': 'Drop files here to paste their paths into the terminal',
  'terminal.insertedAttachmentPath': 'Inserted attachment path',
  'terminal.insertedAttachmentPaths': 'Inserted {count} attachment paths',
  'terminal.insertedCopiedFilePath': 'Inserted copied file path',
  'terminal.insertedCopiedFilePaths': 'Inserted {count} copied file paths',
  'terminal.onlyImagesTempPath': 'Only pasted images can be saved to a temporary terminal path',
  'terminal.processExited': 'Process exited with code {code}',
  'terminal.savedScreenshotInserted': 'Saved screenshot and inserted its path',
  'terminal.savedScreenshotsInserted': 'Saved {count} screenshots and inserted their paths',
  'terminal.startFailed': 'Failed to start terminal: {message}',
  'terminal.unableInsertPastedAttachment': 'Unable to insert the pasted attachment',
  'terminal.unableInsertPastedScreenshot': 'Unable to insert the pasted screenshot'
}

export const LOCALE_STORAGE_KEY = 'atlasos:locale'

export type I18nKey = keyof typeof zhCN
export type I18nValues = Record<string, string | number>
export type TFunction = (key: I18nKey, values?: I18nValues) => string

const messages: Record<Locale, Record<I18nKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS
}

let currentLocale: Locale = DEFAULT_LOCALE

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALES.includes(value as Locale)
}

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE

  try {
    const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    return isLocale(storedLocale) ? storedLocale : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

function formatMessage(template: string, values?: I18nValues): string {
  if (!values) return template

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  )
}

export function getCurrentLocale(): Locale {
  return currentLocale
}

export function setCurrentLocale(locale: Locale): void {
  currentLocale = locale
}

export function translate(locale: Locale, key: I18nKey, values?: I18nValues): string {
  return formatMessage(messages[locale]?.[key] ?? messages[DEFAULT_LOCALE][key], values)
}

export function translateCurrent(key: I18nKey, values?: I18nValues): string {
  return translate(currentLocale, key, values)
}

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: TFunction
}

export const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: setCurrentLocale,
  t: (key, values) => translate(DEFAULT_LOCALE, key, values)
})

type I18nProviderProps = {
  children: ReactNode
  locale?: Locale
  onLocaleChange?: (locale: Locale) => void
}

export function I18nProvider({ children, locale: controlledLocale, onLocaleChange }: I18nProviderProps): JSX.Element {
  const [uncontrolledLocale, setUncontrolledLocale] = useState<Locale>(() => {
    const initialLocale = readStoredLocale()
    setCurrentLocale(initialLocale)
    return initialLocale
  })
  const locale = controlledLocale ?? uncontrolledLocale

  useEffect(() => {
    setCurrentLocale(locale)

    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale
    }

    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    } catch {
      // Local storage can be unavailable in hardened or test environments.
    }
  }, [locale])

  const setLocale = useCallback((nextLocale: Locale) => {
    setCurrentLocale(nextLocale)
    setUncontrolledLocale(nextLocale)
    onLocaleChange?.(nextLocale)
  }, [onLocaleChange])

  const t = useCallback<TFunction>((key, values) => translate(locale, key, values), [locale])
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}

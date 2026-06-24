import { z } from 'zod'
import {
  aiDailySummarySettingsPatchSchema,
  aiProfileDraftSchema,
  aiTranslationSettingsPatchSchema,
  MAX_AI_SCREENSHOT_IMAGE_DATA_URL_CHARS as MAX_AI_SCREENSHOT_IMAGE_DATA_URL_CHARS_VALUE
} from './ai'
import { agentUsageDaySchema } from './agent-usage'
import { pluginConfigSchema, pluginIdSchema } from './plugins'
import { petAlertTargetSchema, petSettingsSchema } from './pet'
import {
  remoteServerComponentInputSchema,
  remoteServerConnectInputSchema,
  remoteServerDeleteProfileInputSchema,
  remoteServerDownloadInputSchema,
  remoteServerFileOperationInputSchema,
  remoteServerRenameInputSchema,
  remoteServerSaveProfileInputSchema,
  remoteServerSessionInputSchema,
  remoteServerShellResizeInputSchema,
  remoteServerShellWriteInputSchema,
  remoteServerTestConnectionInputSchema,
  remoteServerTreeInputSchema,
  remoteServerUploadInputSchema
} from './remote-servers'
import { appSettingsPatchSchema, appSettingsSchema, browserBoundsSchema, canvasDocumentSchema, terminalCreateSchema } from './schema'

export const MAX_TERMINAL_PASTED_ASSET_BASE64_CHARS = 14 * 1024 * 1024
export const MAX_AI_SCREENSHOT_IMAGE_DATA_URL_CHARS = MAX_AI_SCREENSHOT_IMAGE_DATA_URL_CHARS_VALUE

const base64PayloadPattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const aiScreenshotImageDataUrlPattern = /^data:image\/(?:png|jpeg);base64,/

function isAiScreenshotImageDataUrl(value: string): boolean {
  if (!aiScreenshotImageDataUrlPattern.test(value)) return false

  const base64 = value.slice(value.indexOf(',') + 1)
  return base64PayloadPattern.test(base64)
}

export const createCanvasInputSchema = z.object({
  name: z.string().min(1).max(80).optional()
})

export const canvasIdInputSchema = z.object({
  canvasId: z.string().min(1)
})

export const reorderCanvasesInputSchema = z.object({
  canvasOrder: z.array(z.string().min(1)).min(1)
})

export const saveCanvasInputSchema = z.object({
  canvas: canvasDocumentSchema
})

export const updateAppSettingsInputSchema = z.object({
  settings: appSettingsSchema
})

export const patchAppSettingsInputSchema = z.object({
  patch: appSettingsPatchSchema
})

export const aiProfileSaveInputSchema = z.object({
  profile: aiProfileDraftSchema,
  apiKey: z.string().trim().max(20_000).optional()
})

export const aiProfileIdInputSchema = z.object({
  profileId: z.string().trim().min(1).max(120)
})

export const aiProfileApiKeyInputSchema = aiProfileIdInputSchema.extend({
  apiKey: z.string().trim().min(1).max(20_000)
})

export const aiUpdateTranslationSettingsInputSchema = z.object({
  patch: aiTranslationSettingsPatchSchema
})

export const aiUpdateDailySummarySettingsInputSchema = z.object({
  patch: aiDailySummarySettingsPatchSchema
})

export const aiOpenTranslatorInputSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  source: z.enum(['app', 'browser', 'system'])
})

export const aiTranslateInputSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  profileId: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  targetLanguage: z.string().trim().min(1).max(80).optional()
})

export const aiScreenshotCaptureSourceSchema = z.enum(['app', 'browser', 'system'])

export const aiStartScreenshotCaptureInputSchema = z.object({
  source: aiScreenshotCaptureSourceSchema
})

export const aiScreenshotImageInputSchema = z.object({
  sessionId: z.string().trim().min(1).max(120),
  imageDataUrl: z
    .string()
    .trim()
    .min(1)
    .max(MAX_AI_SCREENSHOT_IMAGE_DATA_URL_CHARS)
    .refine(isAiScreenshotImageDataUrl, 'Screenshot image must be a PNG or JPEG data URL')
})

export const chooseDirectoryInputSchema = z.object({
  title: z.string().optional()
})

export const listTreeInputSchema = z.object({
  rootPath: z.string().min(1),
  targetPath: z.string().min(1).optional(),
  maxDepth: z.number().int().min(0).max(64).default(1)
})

export const fileOperationInputSchema = z.object({
  rootPath: z.string().min(1),
  targetPath: z.string().min(1),
  name: z.string().min(1).max(240).optional(),
  contents: z.string().optional()
})

export const filePathInputSchema = z.object({
  rootPath: z.string().min(1),
  targetPath: z.string().min(1)
})

export const moveFileInputSchema = z.object({
  rootPath: z.string().min(1),
  sourcePath: z.string().min(1),
  destinationPath: z.string().min(1)
})

export const searchFilesInputSchema = z.object({
  rootPath: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(200).default(50)
})

export const watchDirectoryInputSchema = z.object({
  rootPath: z.string().min(1),
  targetPath: z.string().min(1).optional()
})

export const terminalWriteInputSchema = z.object({
  sessionId: z.string().min(1),
  data: z.string()
})

export const terminalResizeInputSchema = z.object({
  sessionId: z.string().min(1),
  cols: z.number().int().min(10),
  rows: z.number().int().min(4)
})

export const terminalCloseInputSchema = z.object({
  sessionId: z.string().min(1)
})

export const terminalCloseComponentInputSchema = z.object({
  componentId: z.string().min(1)
})

export const terminalPersistAssetInputSchema = z.object({
  dataBase64: z.string().min(1).max(MAX_TERMINAL_PASTED_ASSET_BASE64_CHARS).regex(base64PayloadPattern),
  mimeType: z
    .string()
    .trim()
    .max(80)
    .regex(/^image\/[a-z0-9.+-]+$/i)
    .optional(),
  sourceName: z.string().min(1).max(240).optional()
})

export const terminalSaveClipboardImageInputSchema = z.object({})

export const terminalReadClipboardFilesInputSchema = z.object({})

export const remoteServersListProfilesInputSchema = z.object({})
export const remoteServersSaveProfileInputSchema = remoteServerSaveProfileInputSchema
export const remoteServersDeleteProfileInputSchema = remoteServerDeleteProfileInputSchema
export const remoteServersTestConnectionInputSchema = remoteServerTestConnectionInputSchema
export const remoteServersConnectInputSchema = remoteServerConnectInputSchema
export const remoteServersCloseSessionInputSchema = remoteServerSessionInputSchema
export const remoteServersCloseComponentInputSchema = remoteServerComponentInputSchema
export const remoteServersShellWriteInputSchema = remoteServerShellWriteInputSchema
export const remoteServersShellResizeInputSchema = remoteServerShellResizeInputSchema
export const remoteServersStatusInputSchema = remoteServerSessionInputSchema
export const remoteServersListTreeInputSchema = remoteServerTreeInputSchema
export const remoteServersReadFileInputSchema = remoteServerFileOperationInputSchema
export const remoteServersWriteFileInputSchema = remoteServerFileOperationInputSchema
export const remoteServersCreateFileInputSchema = remoteServerFileOperationInputSchema
export const remoteServersCreateFolderInputSchema = remoteServerFileOperationInputSchema
export const remoteServersRenameInputSchema = remoteServerRenameInputSchema
export const remoteServersDeleteInputSchema = remoteServerFileOperationInputSchema
export const remoteServersUploadInputSchema = remoteServerUploadInputSchema
export const remoteServersDownloadInputSchema = remoteServerDownloadInputSchema

export const systemMetricsGetInputSchema = z.object({})

export const agentUsageRefreshInputSchema = z.object({})

export const agentUsageYearInputSchema = z.object({
  year: z.number().int().min(2000).max(2200).optional()
})

export const agentUsageDayInputSchema = z.object({
  day: agentUsageDaySchema
})

export const agentUsageGenerateSummaryInputSchema = agentUsageDayInputSchema.extend({
  locale: z.enum(['zh-CN', 'en-US']).optional(),
  regenerate: z.boolean().default(false)
})

export const claudeHistoryListInputSchema = z.object({})

export const claudeHistorySessionInputSchema = z.object({
  sessionId: z.string().trim().min(1).max(200)
})

export const codexHistoryListInputSchema = z.object({})

export const codexHistorySessionInputSchema = z.object({
  sessionId: z.string().trim().min(1).max(200)
})

export const gitRepositoryInputSchema = z.object({
  repoPath: z.string().min(1)
})

export const gitLogInputSchema = gitRepositoryInputSchema.extend({
  ref: z.string().min(1).max(240).optional(),
  limit: z.number().int().min(1).max(500).default(200),
  skip: z.number().int().min(0).max(100_000).default(0)
})

export const gitDiffInputSchema = gitRepositoryInputSchema.extend({
  target: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('worktree'),
      filePath: z.string().min(1).optional()
    }),
    z.object({
      kind: z.literal('staged'),
      filePath: z.string().min(1).optional()
    }),
    z.object({
      kind: z.literal('commit'),
      commitHash: z.string().min(1).max(80),
      filePath: z.string().min(1).optional(),
      oldPath: z.string().min(1).optional()
    })
  ])
})

export const gitCommitDetailInputSchema = gitRepositoryInputSchema.extend({
  commitHash: z.string().min(1).max(80)
})

export const gitPathsInputSchema = gitRepositoryInputSchema.extend({
  filePaths: z.array(z.string().min(1)).min(1).max(200)
})

export const gitCommitInputSchema = gitRepositoryInputSchema.extend({
  message: z.string().trim().min(1).max(10_000),
  filePaths: z.array(z.string().min(1)).min(1).max(200).optional()
})

export const gitBranchInputSchema = gitRepositoryInputSchema.extend({
  name: z.string().trim().min(1).max(240),
  startPoint: z.string().trim().min(1).max(240).optional()
})

export const gitSwitchBranchInputSchema = gitRepositoryInputSchema.extend({
  name: z.string().trim().min(1).max(240),
  remote: z.boolean().default(false)
})

export const gitStashPushInputSchema = gitRepositoryInputSchema.extend({
  message: z.string().trim().max(240).optional()
})

export const gitStashRefInputSchema = gitRepositoryInputSchema.extend({
  ref: z.string().trim().min(1).max(80)
})

export const petUpdateSettingsInputSchema = z.object({
  settings: petSettingsSchema
})

export const petAlertInputSchema = z.object({
  alertId: z.string().min(1)
})

export const petClearAlertsInputSchema = z.object({
  alertIds: z.array(z.string().min(1)).max(500).optional()
})

export const petSnoozeAlertInputSchema = petAlertInputSchema.extend({
  minutes: z.number().int().min(1).max(60 * 24 * 14)
})

export const petSetPositionInputSchema = z.object({
  x: z.number().int(),
  y: z.number().int()
})

export const petSetInteractiveInputSchema = z.object({
  interactive: z.boolean()
})

export const petOpenTargetInputSchema = z.object({
  target: petAlertTargetSchema
})

const launcherPathKindSchema = z.enum(['app', 'file', 'folder'])
const launcherIconDataUrlSchema = z
  .string()
  .trim()
  .max(512 * 1024)
  .regex(/^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/i)

export const launcherChooseFileInputSchema = z.object({
  kind: z.enum(['app', 'file']).default('file')
})

export const launcherChooseFileResultSchema = z
  .object({
    path: z.string().min(1),
    iconDataUrl: launcherIconDataUrlSchema.nullable()
  })
  .nullable()

export const launcherOpenInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: launcherPathKindSchema,
    targetPath: z.string().min(1)
  }),
  z.object({
    kind: z.literal('url'),
    url: z.string().min(1).max(4096)
  }),
  z.object({
    kind: z.literal('command'),
    shell: z.enum(['cmd', 'powershell']),
    command: z.string().trim().min(1).max(8192),
    cwd: z.string().trim().min(1).optional()
  })
])

export const browserCreateTabInputSchema = z.object({
  componentId: z.string().min(1),
  url: z.string().url().default('https://example.com'),
  partition: z.string().optional()
})

export const browserNavigateInputSchema = z.object({
  tabId: z.string().min(1),
  url: z.string().url()
})

export const browserTabInputSchema = z.object({
  tabId: z.string().min(1)
})

export const browserSetZoomInputSchema = browserTabInputSchema.extend({
  zoomFactor: z.number().min(0.5).max(3)
})

export const browserSelectorInputSchema = z.object({
  tabId: z.string().min(1),
  selector: z.string().min(1).max(500)
})

export const browserClickInputSchema = browserSelectorInputSchema

export const browserTypeInputSchema = browserSelectorInputSchema.extend({
  text: z.string()
})

export const browserBoundsInputSchema = browserBoundsSchema

export const pluginIdInputSchema = z.object({
  pluginId: pluginIdSchema
})

export const pluginInstallDirectoryInputSchema = z.object({
  sourcePath: z.string().min(1).optional(),
  dialogTitle: z.string().min(1).max(120).optional()
})

export const pluginRootDirectoryInputSchema = z.object({
  rootPath: z.string().min(1)
})

export const pluginConfigInputSchema = pluginIdInputSchema.extend({
  config: pluginConfigSchema
})

export const pluginInvokeInputSchema = pluginIdInputSchema.extend({
  command: z.string().min(1).max(120),
  input: z.unknown().optional()
})

export type SaveCanvasInput = z.infer<typeof saveCanvasInputSchema>
export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsInputSchema>
export type TerminalCreateInput = z.infer<typeof terminalCreateSchema>
export type LauncherChooseFileResult = z.infer<typeof launcherChooseFileResultSchema>
export type LauncherOpenInput = z.infer<typeof launcherOpenInputSchema>
export type GitDiffInput = z.infer<typeof gitDiffInputSchema>

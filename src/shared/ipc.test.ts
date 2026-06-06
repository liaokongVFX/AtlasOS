import { describe, expect, it } from 'vitest'
import {
  listTreeInputSchema,
  claudeHistoryListInputSchema,
  claudeHistorySessionInputSchema,
  codexHistoryListInputSchema,
  codexHistorySessionInputSchema,
  gitCommitInputSchema,
  gitDiffInputSchema,
  gitLogInputSchema,
  launcherChooseFileResultSchema,
  petClearAlertsInputSchema,
  systemMetricsGetInputSchema,
  terminalPersistAssetInputSchema,
  terminalReadClipboardFilesInputSchema,
  terminalSaveClipboardImageInputSchema,
  watchDirectoryInputSchema
} from './ipc'

describe('listTreeInputSchema', () => {
  it('defaults to one-level directory reads for lazy expansion', () => {
    const input = listTreeInputSchema.parse({ rootPath: '/repo', targetPath: '/repo/src' })

    expect(input).toEqual({ rootPath: '/repo', targetPath: '/repo/src', maxDepth: 1 })
  })

  it('allows bounded explicit recursion for compatibility', () => {
    expect(listTreeInputSchema.parse({ rootPath: '/repo', maxDepth: 64 }).maxDepth).toBe(64)
    expect(() => listTreeInputSchema.parse({ rootPath: '/repo', maxDepth: 65 })).toThrow()
  })
})

describe('watchDirectoryInputSchema', () => {
  it('accepts an optional target directory inside the watched root', () => {
    expect(watchDirectoryInputSchema.parse({ rootPath: '/repo', targetPath: '/repo/src' })).toEqual({
      rootPath: '/repo',
      targetPath: '/repo/src'
    })
  })
})

describe('terminalPersistAssetInputSchema', () => {
  it('accepts base64 encoded image payloads', () => {
    const input = terminalPersistAssetInputSchema.parse({
      dataBase64: 'c2NyZWVuc2hvdA==',
      mimeType: 'image/png',
      sourceName: 'clipboard.png'
    })

    expect(input).toEqual({
      dataBase64: 'c2NyZWVuc2hvdA==',
      mimeType: 'image/png',
      sourceName: 'clipboard.png'
    })
  })

  it('rejects non-image or malformed clipboard payloads', () => {
    expect(() =>
      terminalPersistAssetInputSchema.parse({
        dataBase64: 'c2NyZWVuc2hvdA==',
        mimeType: 'text/plain'
      })
    ).toThrow()

    expect(() =>
      terminalPersistAssetInputSchema.parse({
        dataBase64: 'not base64',
        mimeType: 'image/png'
      })
    ).toThrow()
  })
})

describe('terminalSaveClipboardImageInputSchema', () => {
  it('accepts the empty clipboard-image save request', () => {
    expect(terminalSaveClipboardImageInputSchema.parse({})).toEqual({})
  })
})

describe('terminalReadClipboardFilesInputSchema', () => {
  it('accepts the empty clipboard-file read request', () => {
    expect(terminalReadClipboardFilesInputSchema.parse({})).toEqual({})
  })
})

describe('systemMetricsGetInputSchema', () => {
  it('accepts the empty system metrics request', () => {
    expect(systemMetricsGetInputSchema.parse({})).toEqual({})
  })
})

describe('petClearAlertsInputSchema', () => {
  it('accepts optional alert ids for scoped alert clearing', () => {
    expect(petClearAlertsInputSchema.parse({})).toEqual({})
    expect(petClearAlertsInputSchema.parse({ alertIds: ['alert-1'] })).toEqual({ alertIds: ['alert-1'] })
  })
})

describe('launcherChooseFileResultSchema', () => {
  it('accepts selected files with optional png icon data', () => {
    expect(
      launcherChooseFileResultSchema.parse({
        path: 'C:\\Tools\\tool.exe',
        iconDataUrl: 'data:image/png;base64,aWNvbg=='
      })
    ).toEqual({
      path: 'C:\\Tools\\tool.exe',
      iconDataUrl: 'data:image/png;base64,aWNvbg=='
    })
    expect(launcherChooseFileResultSchema.parse({ path: 'C:\\Tools\\tool.exe', iconDataUrl: null })).toEqual({
      path: 'C:\\Tools\\tool.exe',
      iconDataUrl: null
    })
    expect(launcherChooseFileResultSchema.parse(null)).toBeNull()
  })

  it('rejects non-png icon payloads', () => {
    expect(() =>
      launcherChooseFileResultSchema.parse({
        path: 'C:\\Tools\\tool.exe',
        iconDataUrl: 'data:text/plain;base64,aWNvbg=='
      })
    ).toThrow()
  })
})

describe('Claude history IPC schemas', () => {
  it('accepts the empty list request', () => {
    expect(claudeHistoryListInputSchema.parse({})).toEqual({})
  })

  it('trims and validates session detail requests', () => {
    expect(claudeHistorySessionInputSchema.parse({ sessionId: '  alpha-session  ' })).toEqual({ sessionId: 'alpha-session' })
    expect(() => claudeHistorySessionInputSchema.parse({ sessionId: '   ' })).toThrow()
  })
})

describe('Codex history IPC schemas', () => {
  it('accepts the empty list request', () => {
    expect(codexHistoryListInputSchema.parse({})).toEqual({})
  })

  it('trims and validates session detail requests', () => {
    expect(codexHistorySessionInputSchema.parse({ sessionId: '  codex-session  ' })).toEqual({ sessionId: 'codex-session' })
    expect(() => codexHistorySessionInputSchema.parse({ sessionId: '   ' })).toThrow()
  })
})

describe('git IPC schemas', () => {
  it('defaults Git log pagination to the first 200 commits', () => {
    expect(gitLogInputSchema.parse({ repoPath: '/repo' })).toEqual({
      repoPath: '/repo',
      limit: 200,
      skip: 0
    })
  })

  it('accepts split diff targets for worktree, staged, and commit diffs', () => {
    expect(gitDiffInputSchema.parse({ repoPath: '/repo', target: { kind: 'worktree', filePath: 'src/app.ts' } }).target).toEqual({
      kind: 'worktree',
      filePath: 'src/app.ts'
    })
    expect(gitDiffInputSchema.parse({ repoPath: '/repo', target: { kind: 'staged' } }).target).toEqual({ kind: 'staged' })
    expect(
      gitDiffInputSchema.parse({
        repoPath: '/repo',
        target: { kind: 'commit', commitHash: 'abc1234', filePath: 'src/app.ts', oldPath: 'src/old.ts' }
      }).target
    ).toEqual({ kind: 'commit', commitHash: 'abc1234', filePath: 'src/app.ts', oldPath: 'src/old.ts' })
  })

  it('accepts optional file paths for selected Git commits', () => {
    expect(
      gitCommitInputSchema.parse({
        repoPath: '/repo',
        message: 'commit selected',
        filePaths: ['src/app.ts', 'README.md']
      })
    ).toEqual({
      repoPath: '/repo',
      message: 'commit selected',
      filePaths: ['src/app.ts', 'README.md']
    })
  })
})

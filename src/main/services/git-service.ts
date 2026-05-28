import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { dialog } from 'electron'
import {
  chooseDirectoryInputSchema,
  gitBranchInputSchema,
  gitCommitDetailInputSchema,
  gitCommitInputSchema,
  gitDiffInputSchema,
  gitLogInputSchema,
  gitPathsInputSchema,
  gitRepositoryInputSchema,
  gitStashPushInputSchema,
  gitStashRefInputSchema,
  gitSwitchBranchInputSchema
} from '@shared/ipc'
import type {
  GitBranchSummary,
  GitChangedFile,
  GitCommitFile,
  GitCommitSummary,
  GitDiffResult,
  GitDiffTarget,
  GitFileStatus,
  GitOperationResult,
  GitStashEntry,
  GitStatusSnapshot,
  GitSummary
} from '@shared/git'
import { translateShared } from '@shared/locale-text'
import { assertInsideRoot } from './path-safety'
import { handleValidated } from './ipc-helpers'

type GitRunResult = {
  stdout: string
  stderr: string
  code: number | null
  truncated: boolean
}

type GitRunOptions = {
  allowExitCodes?: number[]
  maxOutputChars?: number
  timeoutMs?: number
}

const DEFAULT_GIT_TIMEOUT_MS = 30_000
const DEFAULT_GIT_OUTPUT_CHARS = 4 * 1024 * 1024
const MAX_DIFF_CHARS = 1_200_000
const GIT_LOG_DEFAULT_LIMIT = 200
const FIELD_SEPARATOR = '\x1f'
const RECORD_SEPARATOR = '\x1e'

function appendLimited(current: string, chunk: Buffer, maxOutputChars: number): { value: string; truncated: boolean } {
  if (current.length >= maxOutputChars) return { value: current, truncated: true }

  const nextText = chunk.toString('utf8')
  const available = maxOutputChars - current.length
  if (nextText.length <= available) return { value: current + nextText, truncated: false }
  return { value: current + nextText.slice(0, available), truncated: true }
}

function splitFixed(value: string, separator: string, fields: number): string[] {
  const result: string[] = []
  let offset = 0

  for (let index = 0; index < fields - 1; index += 1) {
    const next = value.indexOf(separator, offset)
    if (next === -1) {
      result.push(value.slice(offset))
      offset = value.length
      break
    }

    result.push(value.slice(offset, next))
    offset = next + separator.length
  }

  result.push(value.slice(offset))
  return result
}

function splitStatusFields(value: string, fieldsBeforePath: number): string[] {
  return splitFixed(value, ' ', fieldsBeforePath + 1)
}

function isSafeRef(value: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._/@+-]*$/.test(value) &&
    !value.startsWith('-') &&
    !value.includes('..') &&
    !value.includes('//') &&
    !value.includes('@{') &&
    !value.endsWith('/') &&
    !value.endsWith('.') &&
    !value.endsWith('.lock')
  )
}

function assertSafeRef(value: string): string {
  const ref = value.trim()
  if (!isSafeRef(ref)) throw new Error('Invalid Git ref')
  return ref
}

function assertSafeCommitHash(value: string): string {
  const hash = value.trim()
  if (!/^[0-9a-fA-F]{4,64}$/.test(hash)) throw new Error('Invalid Git commit hash')
  return hash
}

function assertSafeStashRef(value: string): string {
  const ref = value.trim()
  if (!/^stash@\{\d+\}$/.test(ref)) throw new Error('Invalid Git stash ref')
  return ref
}

function trimGitOutput(value: string): string {
  return value.replace(/\r?\n$/, '')
}

function gitErrorMessage(result: GitRunResult): string {
  return trimGitOutput(result.stderr || result.stdout) || 'Git command failed'
}

function statusFromCode(code: string): GitFileStatus {
  if (code === 'A') return 'added'
  if (code === 'C') return 'copied'
  if (code === 'D') return 'deleted'
  if (code === 'R') return 'renamed'
  if (code === 'T') return 'typechange'
  if (code === '?') return 'untracked'
  if (code === 'U') return 'conflicted'
  return 'modified'
}

function parseInteger(value: string | undefined): number {
  if (!value) return 0
  const parsed = Number.parseInt(value.replace(/^[+-]/, ''), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function branchNameFromHead(value: string | null): string | null {
  if (!value || value === '(detached)') return null
  return value
}

function parseStatusRecord(
  files: GitChangedFile[],
  path: string,
  oldPath: string | undefined,
  indexStatus: string,
  worktreeStatus: string
): void {
  if (indexStatus === 'U' || worktreeStatus === 'U') {
    files.push({
      path,
      oldPath,
      area: 'conflicted',
      status: 'conflicted',
      indexStatus,
      worktreeStatus
    })
    return
  }

  if (indexStatus !== '.') {
    files.push({
      path,
      oldPath,
      area: 'staged',
      status: statusFromCode(indexStatus),
      indexStatus,
      worktreeStatus
    })
  }

  if (worktreeStatus !== '.') {
    files.push({
      path,
      oldPath,
      area: 'unstaged',
      status: statusFromCode(worktreeStatus),
      indexStatus,
      worktreeStatus
    })
  }
}

export function parseGitStatus(repoPath: string, output: string): GitStatusSnapshot {
  const files: GitChangedFile[] = []
  const tokens = output.split('\0').filter(Boolean)
  let headOid: string | null = null
  let currentBranch: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let stashCount = 0

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]

    if (token.startsWith('# branch.oid ')) {
      const oid = token.slice('# branch.oid '.length).trim()
      headOid = oid === '(initial)' ? null : oid
      continue
    }

    if (token.startsWith('# branch.head ')) {
      currentBranch = branchNameFromHead(token.slice('# branch.head '.length).trim())
      continue
    }

    if (token.startsWith('# branch.upstream ')) {
      upstream = token.slice('# branch.upstream '.length).trim() || null
      continue
    }

    if (token.startsWith('# branch.ab ')) {
      const parts = token.split(' ')
      ahead = parseInteger(parts[2])
      behind = parseInteger(parts[3])
      continue
    }

    if (token.startsWith('# stash ')) {
      stashCount = parseInteger(token.slice('# stash '.length).trim())
      continue
    }

    if (token.startsWith('1 ')) {
      const [, xy, , , , , , , path] = splitStatusFields(token, 8)
      parseStatusRecord(files, path, undefined, xy[0] ?? '.', xy[1] ?? '.')
      continue
    }

    if (token.startsWith('2 ')) {
      const [, xy, , , , , , , , path] = splitStatusFields(token, 9)
      const oldPath = tokens[index + 1]
      index += oldPath ? 1 : 0
      parseStatusRecord(files, path, oldPath, xy[0] ?? '.', xy[1] ?? '.')
      continue
    }

    if (token.startsWith('u ')) {
      const [, xy, , , , , , , , , path] = splitStatusFields(token, 10)
      files.push({
        path,
        area: 'conflicted',
        status: 'conflicted',
        indexStatus: xy[0] ?? 'U',
        worktreeStatus: xy[1] ?? 'U'
      })
      continue
    }

    if (token.startsWith('? ')) {
      const path = token.slice(2)
      files.push({
        path,
        area: 'untracked',
        status: 'untracked',
        indexStatus: '?',
        worktreeStatus: '?'
      })
    }
  }

  return {
    repoPath,
    headOid,
    currentBranch,
    upstream,
    ahead,
    behind,
    stashCount,
    isClean: files.length === 0,
    hasConflicts: files.some((file) => file.area === 'conflicted'),
    files
  }
}

function parseBranchList(output: string): GitBranchSummary[] {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [head, fullName, name, upstream, headOid, lastCommitDate, lastCommitSubject] = line.split('\0')

      return {
        name,
        fullName,
        current: head.trim() === '*',
        remote: fullName.startsWith('refs/remotes/'),
        upstream: upstream || null,
        headOid,
        lastCommitDate: lastCommitDate || null,
        lastCommitSubject: lastCommitSubject || ''
      }
    })
    .filter((branch) => branch.name && !branch.fullName.endsWith('/HEAD'))
}

function parseCommitRefs(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseCommitRecord(record: string, includeBody = false): GitCommitSummary | null {
  const fieldCount = includeBody ? 9 : 8
  const fields = splitFixed(record, FIELD_SEPARATOR, fieldCount)
  const [hash, shortHash, parents, authorName, authorEmail, authoredAt, refs, subject, body] = fields
  if (!hash) return null

  return {
    hash,
    shortHash,
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    authorName,
    authorEmail,
    authoredAt,
    refs: parseCommitRefs(refs),
    subject,
    body: includeBody ? body.trim() : undefined
  }
}

export function parseGitLog(output: string): GitCommitSummary[] {
  return output
    .split(RECORD_SEPARATOR)
    .map((record) => parseCommitRecord(record.trim()))
    .filter((commit): commit is GitCommitSummary => Boolean(commit))
}

function parseCommitFileStatus(value: string): GitFileStatus {
  if (value.startsWith('R')) return 'renamed'
  if (value.startsWith('C')) return 'copied'
  return statusFromCode(value[0] ?? 'M')
}

function parseCommitFiles(output: string): GitCommitFile[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, firstPath, secondPath] = line.split('\t')
      return {
        path: secondPath || firstPath,
        oldPath: secondPath ? firstPath : undefined,
        status: parseCommitFileStatus(status)
      }
    })
}

function parseStashList(output: string): GitStashEntry[] {
  return output
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [ref, hash, message] = record.split(FIELD_SEPARATOR)
      return { ref, hash, message }
    })
}

function isDiffBinary(diff: string): boolean {
  return diff.includes('GIT binary patch') || /^Binary files /m.test(diff) || /^Binary file /m.test(diff)
}

function truncateDiff(diff: string, alreadyTruncated = false): { diff: string; truncated: boolean } {
  if (diff.length <= MAX_DIFF_CHARS) return { diff, truncated: alreadyTruncated }
  return {
    diff: diff.slice(0, MAX_DIFF_CHARS),
    truncated: true
  }
}

function escapeDiffPath(path: string): string {
  return path.replace(/\\/g, '/')
}

function untrackedFileDiff(path: string, contents: string): string {
  const lines = contents.split(/\r?\n/)
  const lineCount = contents.endsWith('\n') || contents.length === 0 ? Math.max(0, lines.length - 1) : lines.length
  const body = lines
    .slice(0, lineCount)
    .map((line) => `+${line}`)
    .join('\n')

  return [
    `diff --git a/${escapeDiffPath(path)} b/${escapeDiffPath(path)}`,
    'new file mode 100644',
    'index 0000000..0000000',
    '--- /dev/null',
    `+++ b/${escapeDiffPath(path)}`,
    `@@ -0,0 +1,${lineCount} @@`,
    body
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

function isProbablyBinary(buffer: Buffer): boolean {
  return buffer.includes(0)
}

export class GitService {
  registerIpc(): void {
    handleValidated('git:choose-repository', chooseDirectoryInputSchema, async (_, input) => {
      const result = await dialog.showOpenDialog({
        title: input.title ?? translateShared(undefined, 'filesystem.chooseFolder'),
        properties: ['openDirectory', 'createDirectory']
      })

      if (result.canceled) return null
      return this.resolveRepositoryRoot(result.filePaths[0])
    })

    handleValidated('git:summary', gitRepositoryInputSchema, (_, input) => this.getSummary(input.repoPath))
    handleValidated('git:status', gitRepositoryInputSchema, (_, input) => this.getStatus(input.repoPath))
    handleValidated('git:branches', gitRepositoryInputSchema, (_, input) => this.getBranches(input.repoPath))
    handleValidated('git:log', gitLogInputSchema, (_, input) => this.getLog(input.repoPath, input.ref, input.limit, input.skip))
    handleValidated('git:commit-detail', gitCommitDetailInputSchema, (_, input) => this.getCommitDetail(input.repoPath, input.commitHash))
    handleValidated('git:diff', gitDiffInputSchema, (_, input) => this.getDiff(input.repoPath, input.target))
    handleValidated('git:stage', gitPathsInputSchema, (_, input) => this.stage(input.repoPath, input.filePaths))
    handleValidated('git:unstage', gitPathsInputSchema, (_, input) => this.unstage(input.repoPath, input.filePaths))
    handleValidated('git:commit', gitCommitInputSchema, (_, input) => this.commit(input.repoPath, input.message, input.filePaths))
    handleValidated('git:branch-create', gitBranchInputSchema, (_, input) => this.createBranch(input.repoPath, input.name, input.startPoint))
    handleValidated('git:branch-switch', gitSwitchBranchInputSchema, (_, input) => this.switchBranch(input.repoPath, input.name, input.remote))
    handleValidated('git:branch-delete', gitBranchInputSchema, (_, input) => this.deleteBranch(input.repoPath, input.name))
    handleValidated('git:fetch', gitRepositoryInputSchema, (_, input) => this.fetch(input.repoPath))
    handleValidated('git:pull', gitRepositoryInputSchema, (_, input) => this.pull(input.repoPath))
    handleValidated('git:push', gitRepositoryInputSchema, (_, input) => this.push(input.repoPath))
    handleValidated('git:stash-list', gitRepositoryInputSchema, (_, input) => this.getStashes(input.repoPath))
    handleValidated('git:stash-push', gitStashPushInputSchema, (_, input) => this.pushStash(input.repoPath, input.message))
    handleValidated('git:stash-apply', gitStashRefInputSchema, (_, input) => this.applyStash(input.repoPath, input.ref))
    handleValidated('git:stash-pop', gitStashRefInputSchema, (_, input) => this.popStash(input.repoPath, input.ref))
    handleValidated('git:stash-drop', gitStashRefInputSchema, (_, input) => this.dropStash(input.repoPath, input.ref))
  }

  async getSummary(repoPathInput: string): Promise<GitSummary> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    const [status, branches, commits, stashes] = await Promise.all([
      this.getStatus(repoPath),
      this.getBranches(repoPath),
      this.getLog(repoPath, undefined, GIT_LOG_DEFAULT_LIMIT, 0),
      this.getStashes(repoPath)
    ])

    return {
      repoPath,
      status,
      branches,
      commits,
      stashes
    }
  }

  async getStatus(repoPathInput: string): Promise<GitStatusSnapshot> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    const result = await this.runGit(repoPath, ['status', '--porcelain=v2', '-z', '--branch', '--show-stash'])
    return parseGitStatus(repoPath, result.stdout)
  }

  async getBranches(repoPathInput: string): Promise<GitBranchSummary[]> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    const result = await this.runGit(repoPath, [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(HEAD)%00%(refname)%00%(refname:short)%00%(upstream:short)%00%(objectname)%00%(committerdate:iso8601)%00%(subject)%0a',
      'refs/heads',
      'refs/remotes'
    ])
    return parseBranchList(result.stdout)
  }

  async getLog(repoPathInput: string, ref?: string, limit = GIT_LOG_DEFAULT_LIMIT, skip = 0): Promise<GitCommitSummary[]> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    const args = [
      'log',
      `--max-count=${limit}`,
      `--skip=${skip}`,
      '--date=iso-strict',
      `--pretty=format:${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%P${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%D${FIELD_SEPARATOR}%s`
    ]
    if (ref) args.push(assertSafeRef(ref))
    args.push('--')

    const result = await this.runGit(repoPath, args)
    return parseGitLog(result.stdout)
  }

  async getCommitDetail(repoPathInput: string, commitHashInput: string): Promise<GitCommitSummary> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    const commitHash = assertSafeCommitHash(commitHashInput)
    const metadata = await this.runGit(repoPath, [
      'show',
      '-s',
      `--format=%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%P${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%D${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%B`,
      commitHash
    ])
    const commit = parseCommitRecord(trimGitOutput(metadata.stdout), true)
    if (!commit) throw new Error('Unable to read commit')

    const files = await this.runGit(repoPath, ['show', '--format=', '--name-status', '-M', '--no-ext-diff', commitHash, '--'])
    return {
      ...commit,
      files: parseCommitFiles(files.stdout)
    }
  }

  async getDiff(repoPathInput: string, target: GitDiffTarget): Promise<GitDiffResult> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    let result: GitRunResult | null = null

    if (target.kind === 'worktree' && target.filePath && (await this.isUntracked(repoPath, target.filePath))) {
      return this.getUntrackedDiff(repoPath, { kind: 'worktree', filePath: target.filePath })
    }

    if (target.kind === 'worktree') {
      result = await this.runGit(repoPath, ['diff', '--no-ext-diff', '--', ...this.pathspecs(repoPath, target.filePath)])
    } else if (target.kind === 'staged') {
      result = await this.runGit(repoPath, ['diff', '--cached', '--no-ext-diff', '--', ...this.pathspecs(repoPath, target.filePath)])
    } else {
      const commitHash = assertSafeCommitHash(target.commitHash)
      result = await this.runGit(repoPath, [
        'show',
        '--format=',
        '--find-renames',
        '--no-ext-diff',
        commitHash,
        '--',
        ...this.pathspecs(repoPath, target.filePath, target.oldPath)
      ])
    }

    const truncated = truncateDiff(result.stdout, result.truncated)
    return {
      repoPath,
      target,
      diff: truncated.diff,
      binary: isDiffBinary(truncated.diff),
      truncated: truncated.truncated
    }
  }

  async stage(repoPathInput: string, filePaths: string[]): Promise<GitOperationResult> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    await this.runGit(repoPath, ['add', '--', ...this.pathspecs(repoPath, ...filePaths)])
    return this.operationResult(repoPath, 'Staged files')
  }

  async unstage(repoPathInput: string, filePaths: string[]): Promise<GitOperationResult> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    await this.runGit(repoPath, ['restore', '--staged', '--', ...this.pathspecs(repoPath, ...filePaths)])
    return this.operationResult(repoPath, 'Unstaged files')
  }

  async commit(repoPathInput: string, message: string, filePaths: string[] = []): Promise<GitOperationResult> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    const paths = this.pathspecs(repoPath, ...filePaths)
    if (paths.length) {
      await this.runGit(repoPath, ['add', '--', ...paths])
      await this.runGit(repoPath, ['commit', '-m', message, '--only', '--', ...paths])
    } else {
      await this.runGit(repoPath, ['commit', '-m', message])
    }
    return this.operationResult(repoPath, 'Created commit')
  }

  async createBranch(repoPathInput: string, nameInput: string, startPointInput?: string): Promise<GitOperationResult> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    const name = assertSafeRef(nameInput)
    const args = ['branch', name]
    if (startPointInput) args.push(assertSafeRef(startPointInput))
    await this.runGit(repoPath, args)
    return this.operationResult(repoPath, `Created branch ${name}`)
  }

  async switchBranch(repoPathInput: string, nameInput: string, remote = false): Promise<GitOperationResult> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    const name = assertSafeRef(nameInput)
    await this.runGit(repoPath, remote ? ['switch', '--track', name] : ['switch', name])
    return this.operationResult(repoPath, `Switched to ${name}`)
  }

  async deleteBranch(repoPathInput: string, nameInput: string): Promise<GitOperationResult> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    const name = assertSafeRef(nameInput)
    await this.runGit(repoPath, ['branch', '-d', name])
    return this.operationResult(repoPath, `Deleted branch ${name}`)
  }

  async fetch(repoPathInput: string): Promise<GitOperationResult> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    await this.runGit(repoPath, ['fetch', '--prune'], { timeoutMs: 90_000 })
    return this.operationResult(repoPath, 'Fetched remotes')
  }

  async pull(repoPathInput: string): Promise<GitOperationResult> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    await this.runGit(repoPath, ['pull', '--ff-only'], { timeoutMs: 90_000 })
    return this.operationResult(repoPath, 'Pulled latest changes')
  }

  async push(repoPathInput: string): Promise<GitOperationResult> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    await this.runGit(repoPath, ['push'], { timeoutMs: 90_000 })
    return this.operationResult(repoPath, 'Pushed current branch')
  }

  async getStashes(repoPathInput: string): Promise<GitStashEntry[]> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    const result = await this.runGit(repoPath, ['stash', 'list', `--format=%gd${FIELD_SEPARATOR}%H${FIELD_SEPARATOR}%gs${RECORD_SEPARATOR}`])
    return parseStashList(result.stdout)
  }

  async pushStash(repoPathInput: string, message?: string): Promise<GitOperationResult> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    const args = ['stash', 'push', '-u']
    if (message?.trim()) args.push('-m', message.trim())
    await this.runGit(repoPath, args)
    return this.operationResult(repoPath, 'Created stash')
  }

  async applyStash(repoPathInput: string, refInput: string): Promise<GitOperationResult> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    const ref = assertSafeStashRef(refInput)
    await this.runGit(repoPath, ['stash', 'apply', ref])
    return this.operationResult(repoPath, `Applied ${ref}`)
  }

  async popStash(repoPathInput: string, refInput: string): Promise<GitOperationResult> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    const ref = assertSafeStashRef(refInput)
    await this.runGit(repoPath, ['stash', 'pop', ref])
    return this.operationResult(repoPath, `Popped ${ref}`)
  }

  async dropStash(repoPathInput: string, refInput: string): Promise<GitOperationResult> {
    const repoPath = await this.resolveRepositoryRoot(repoPathInput)
    const ref = assertSafeStashRef(refInput)
    await this.runGit(repoPath, ['stash', 'drop', ref])
    return this.operationResult(repoPath, `Dropped ${ref}`)
  }

  private async operationResult(repoPath: string, message: string): Promise<GitOperationResult> {
    return {
      ok: true,
      message,
      status: await this.getStatus(repoPath)
    }
  }

  private async resolveRepositoryRoot(inputPath: string): Promise<string> {
    if (!isAbsolute(inputPath)) throw new Error('Git repository paths must be absolute')

    const cwd = resolve(inputPath)
    const result = await this.runGitAtPath(cwd, ['rev-parse', '--show-toplevel'])
    const repoPath = resolve(trimGitOutput(result.stdout))
    if (!repoPath) throw new Error('Selected folder is not a Git repository')
    return repoPath
  }

  private pathspecs(repoPath: string, ...paths: Array<string | undefined>): string[] {
    return paths.filter((path): path is string => Boolean(path)).map((path) => this.pathspec(repoPath, path))
  }

  private pathspec(repoPath: string, pathInput: string): string {
    const targetPath = isAbsolute(pathInput) ? assertInsideRoot(repoPath, pathInput) : assertInsideRoot(repoPath, resolve(repoPath, pathInput))
    const relativePath = relative(repoPath, targetPath).replace(/\\/g, '/')
    if (!relativePath || relativePath.startsWith('../')) throw new Error('Invalid Git file path')
    return relativePath
  }

  private async isUntracked(repoPath: string, filePath: string): Promise<boolean> {
    const result = await this.runGit(repoPath, ['ls-files', '--others', '--exclude-standard', '--', this.pathspec(repoPath, filePath)])
    return result.stdout.trim().length > 0
  }

  private async getUntrackedDiff(repoPath: string, target: GitDiffTarget & { kind: 'worktree'; filePath: string }): Promise<GitDiffResult> {
    const path = this.pathspec(repoPath, target.filePath)
    const absolutePath = assertInsideRoot(repoPath, resolve(repoPath, path))
    const info = await stat(absolutePath)
    if (info.size > MAX_DIFF_CHARS) {
      return { repoPath, target, diff: '', binary: false, truncated: true }
    }

    const buffer = await readFile(absolutePath)
    if (isProbablyBinary(buffer)) {
      return { repoPath, target, diff: '', binary: true, truncated: false }
    }

    const diff = untrackedFileDiff(path, buffer.toString('utf8'))
    const truncated = truncateDiff(diff)
    return {
      repoPath,
      target,
      diff: truncated.diff,
      binary: false,
      truncated: truncated.truncated
    }
  }

  private runGit(repoPath: string, args: string[], options: GitRunOptions = {}): Promise<GitRunResult> {
    return this.runGitAtPath(repoPath, args, options)
  }

  private runGitAtPath(cwd: string, args: string[], options: GitRunOptions = {}): Promise<GitRunResult> {
    const allowExitCodes = options.allowExitCodes ?? [0]
    const maxOutputChars = options.maxOutputChars ?? DEFAULT_GIT_OUTPUT_CHARS
    const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS

    return new Promise((resolvePromise, reject) => {
      const child = spawn('git', args, {
        cwd,
        shell: false,
        windowsHide: true
      })
      let stdout = ''
      let stderr = ''
      let truncated = false
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) return
        child.kill()
        settled = true
        reject(new Error('Git command timed out'))
      }, timeoutMs)

      child.stdout.on('data', (chunk: Buffer) => {
        const next = appendLimited(stdout, chunk, maxOutputChars)
        stdout = next.value
        truncated = truncated || next.truncated
      })

      child.stderr.on('data', (chunk: Buffer) => {
        const next = appendLimited(stderr, chunk, maxOutputChars)
        stderr = next.value
        truncated = truncated || next.truncated
      })

      child.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(error)
      })

      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        const result = { stdout, stderr, code, truncated }

        if (!allowExitCodes.includes(code ?? -1)) {
          reject(new Error(gitErrorMessage(result)))
          return
        }

        resolvePromise(result)
      })
    })
  }
}

import * as Dialog from '@radix-ui/react-dialog'
import { Diff, Hunk, parseDiff } from 'react-diff-view'
import {
  Box,
  Check,
  ChevronRight,
  GitBranch,
  GitCommitHorizontal,
  GitCompare,
  GitPullRequest,
  GitPullRequestArrow,
  History,
  Layers,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type {
  GitBranchSummary,
  GitChangedFile,
  GitCommitFile,
  GitCommitSummary,
  GitDiffResult,
  GitDiffTarget,
  GitOperationResult,
  GitStashEntry,
  GitStatusSnapshot,
  GitSummary
} from '@shared/git'
import { useI18n } from '../../i18n'
import { asNumber, asString, cn } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'

type GitManagerTab = 'changes' | 'log' | 'branches' | 'stashes'
type DiffMode = 'split' | 'unified'
type ResizePane = 'sidebar' | 'fileRail'

type PendingConfirm = {
  title: string
  description: string
  actionLabel: string
  danger?: boolean
  run: () => Promise<void>
}

type SelectedDiff = {
  id: string
  title: string
  detail?: string
  target: GitDiffTarget
}

type CommitScope =
  | {
      kind: 'staged'
    }
  | {
      kind: 'selected'
      filePaths: string[]
    }

type GitManagerCopy = {
  bindRepo: string
  chooseRepo: string
  repository: string
  noRepo: string
  refresh: string
  fetch: string
  pull: string
  push: string
  commit: string
  createBranch: string
  stash: string
  changes: string
  log: string
  branches: string
  stashes: string
  staged: string
  unstaged: string
  untracked: string
  conflicted: string
  clean: string
  noChanges: string
  noCommits: string
  noBranches: string
  noStashes: string
  files: string
  resizeLog: string
  resizeFiles: string
  aheadBehind: (ahead: number, behind: number) => string
  dirtyCount: (count: number) => string
  stashCount: (count: number) => string
  stage: string
  unstage: string
  selectedCount: (count: number) => string
  selectAllChanges: string
  stageSelected: string
  unstageSelected: string
  commitSelected: string
  commitSelectedDescription: (count: number) => string
  loadMore: string
  split: string
  unified: string
  noDiff: string
  binaryDiff: string
  truncatedDiff: string
  commitMessage: string
  commitPlaceholder: string
  branchName: string
  stashMessage: string
  optional: string
  cancel: string
  confirm: string
  errorDetails: string
  viewError: string
  closeError: string
  deleteBranch: string
  switchBranch: string
  apply: string
  pop: string
  drop: string
  remote: string
  local: string
  current: string
  byAuthor: (author: string) => string
  confirmPull: string
  confirmPush: string
  confirmSwitchBranch: (name: string, remote: boolean) => string
  confirmDeleteBranch: (name: string) => string
  confirmApplyStash: (ref: string) => string
  confirmPopStash: (ref: string) => string
  confirmDropStash: (ref: string) => string
}

const COPY: Record<'zh-CN' | 'en-US', GitManagerCopy> = {
  'zh-CN': {
    bindRepo: '绑定 Git 仓库',
    chooseRepo: '选择仓库',
    repository: '仓库',
    noRepo: '选择一个本地 Git 仓库来查看状态、分支、提交和 diff。',
    refresh: '刷新',
    fetch: 'Fetch',
    pull: 'Pull',
    push: 'Push',
    commit: '提交',
    createBranch: '新建分支',
    stash: 'Stash',
    changes: '变更',
    log: '日志',
    branches: '分支',
    stashes: 'Stashes',
    staged: '已暂存',
    unstaged: '未暂存',
    untracked: '未跟踪',
    conflicted: '冲突',
    clean: '工作区干净',
    noChanges: '没有文件变更',
    noCommits: '没有提交',
    noBranches: '没有分支',
    noStashes: '没有 stash',
    files: '文件',
    resizeLog: '调整日志列表宽度',
    resizeFiles: '调整文件列表宽度',
    aheadBehind: (ahead, behind) => `领先 ${ahead} / 落后 ${behind}`,
    dirtyCount: (count) => `${count} 个变更`,
    stashCount: (count) => `${count} 个 stash`,
    stage: '暂存',
    unstage: '取消暂存',
    selectedCount: (count) => `已选 ${count}`,
    selectAllChanges: '选择所有变更',
    stageSelected: '暂存选中',
    unstageSelected: '取消暂存',
    commitSelected: '提交选中',
    commitSelectedDescription: (count) => `将只提交选中的 ${count} 个文件；未选中的已暂存文件会保留。`,
    loadMore: '加载更多',
    split: '并排',
    unified: '统一',
    noDiff: '没有可显示的 diff',
    binaryDiff: '二进制文件无法显示 diff',
    truncatedDiff: 'Diff 过大，已截断显示。',
    commitMessage: '提交信息',
    commitPlaceholder: '描述这次提交',
    branchName: '分支名',
    stashMessage: 'Stash 信息',
    optional: '可选',
    cancel: '取消',
    confirm: '确认',
    errorDetails: '错误详情',
    viewError: '详情',
    closeError: '关闭',
    deleteBranch: '删除分支',
    switchBranch: '切换分支',
    apply: 'Apply',
    pop: 'Pop',
    drop: 'Drop',
    remote: '远端',
    local: '本地',
    current: '当前',
    byAuthor: (author) => `作者 ${author}`,
    confirmPull: '对当前分支执行 git pull --ff-only。',
    confirmPush: '使用当前 Git 远端推送当前分支。',
    confirmSwitchBranch: (name, remote) => (remote ? `从 ${name} 创建跟踪分支。` : `切换到 ${name}。`),
    confirmDeleteBranch: (name) => `使用 git branch -d 删除本地分支 ${name}。`,
    confirmApplyStash: (ref) => `应用 ${ref}。`,
    confirmPopStash: (ref) => `Pop ${ref}。`,
    confirmDropStash: (ref) => `Drop ${ref}。`
  },
  'en-US': {
    bindRepo: 'Bind Git repository',
    chooseRepo: 'Choose repository',
    repository: 'Repository',
    noRepo: 'Choose a local Git repository to inspect status, branches, commits, and diffs.',
    refresh: 'Refresh',
    fetch: 'Fetch',
    pull: 'Pull',
    push: 'Push',
    commit: 'Commit',
    createBranch: 'New branch',
    stash: 'Stash',
    changes: 'Changes',
    log: 'Log',
    branches: 'Branches',
    stashes: 'Stashes',
    staged: 'Staged',
    unstaged: 'Unstaged',
    untracked: 'Untracked',
    conflicted: 'Conflicts',
    clean: 'Clean working tree',
    noChanges: 'No file changes',
    noCommits: 'No commits',
    noBranches: 'No branches',
    noStashes: 'No stashes',
    files: 'Files',
    resizeLog: 'Resize log list',
    resizeFiles: 'Resize file list',
    aheadBehind: (ahead, behind) => `ahead ${ahead} / behind ${behind}`,
    dirtyCount: (count) => `${count} changes`,
    stashCount: (count) => `${count} stashes`,
    stage: 'Stage',
    unstage: 'Unstage',
    selectedCount: (count) => `${count} sel.`,
    selectAllChanges: 'Select all changes',
    stageSelected: 'Stage selected',
    unstageSelected: 'Unstage selected',
    commitSelected: 'Commit selected',
    commitSelectedDescription: (count) => `Only the ${count} selected files will be committed. Other staged files remain staged.`,
    loadMore: 'Load more',
    split: 'Split',
    unified: 'Unified',
    noDiff: 'No diff to display',
    binaryDiff: 'Binary diff cannot be displayed',
    truncatedDiff: 'Diff is large and has been truncated.',
    commitMessage: 'Commit message',
    commitPlaceholder: 'Describe this commit',
    branchName: 'Branch name',
    stashMessage: 'Stash message',
    optional: 'Optional',
    cancel: 'Cancel',
    confirm: 'Confirm',
    errorDetails: 'Error details',
    viewError: 'Details',
    closeError: 'Dismiss',
    deleteBranch: 'Delete branch',
    switchBranch: 'Switch branch',
    apply: 'Apply',
    pop: 'Pop',
    drop: 'Drop',
    remote: 'Remote',
    local: 'Local',
    current: 'Current',
    byAuthor: (author) => `by ${author}`,
    confirmPull: 'Run git pull --ff-only for the current branch.',
    confirmPush: 'Push the current branch using the configured Git remote.',
    confirmSwitchBranch: (name, remote) => (remote ? `Create a tracking branch from ${name}.` : `Switch to ${name}.`),
    confirmDeleteBranch: (name) => `Delete local branch ${name} with git branch -d.`,
    confirmApplyStash: (ref) => `Apply ${ref}.`,
    confirmPopStash: (ref) => `Pop ${ref}.`,
    confirmDropStash: (ref) => `Drop ${ref}.`
  }
}

const HISTORY_LIMIT = 200
const SPLITTER_SIZE = 8
const DEFAULT_SIDEBAR_WIDTH = 320
const MIN_SIDEBAR_WIDTH = 260
const MAX_SIDEBAR_WIDTH = 560
const MIN_DETAIL_WIDTH = 520
const DEFAULT_FILE_RAIL_WIDTH = 280
const MIN_FILE_RAIL_WIDTH = 220
const MAX_FILE_RAIL_WIDTH = 420
const MIN_DIFF_WIDTH = 420

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function statusLabel(status: GitChangedFile['status'] | GitCommitFile['status']): string {
  if (status === 'added') return 'A'
  if (status === 'copied') return 'C'
  if (status === 'deleted') return 'D'
  if (status === 'renamed') return 'R'
  if (status === 'typechange') return 'T'
  if (status === 'untracked') return '?'
  if (status === 'conflicted') return '!'
  return 'M'
}

function formatDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function fileKey(file: Pick<GitChangedFile | GitCommitFile, 'path' | 'oldPath'>, prefix: string): string {
  return `${prefix}:${file.oldPath ?? ''}:${file.path}`
}

function pathListForChange(file: GitChangedFile): string[] {
  return [file.path, file.oldPath].filter((path): path is string => Boolean(path))
}

function pathListForChanges(files: GitChangedFile[]): string[] {
  return [...new Set(files.flatMap(pathListForChange))]
}

function filePathParts(path: string): { directory: string; name: string } {
  const normalized = path.replace(/\\/g, '/')
  const slashIndex = normalized.lastIndexOf('/')
  if (slashIndex === -1) return { directory: '', name: normalized }
  return {
    directory: normalized.slice(0, slashIndex),
    name: normalized.slice(slashIndex + 1)
  }
}

function groupChanges(files: GitChangedFile[]): Record<GitChangedFile['area'], GitChangedFile[]> {
  return files.reduce<Record<GitChangedFile['area'], GitChangedFile[]>>(
    (groups, file) => {
      groups[file.area].push(file)
      return groups
    },
    {
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: []
    }
  )
}

function branchLogRef(branch: GitBranchSummary): string {
  return branch.remote ? branch.name : branch.fullName
}

function ActionButton({
  children,
  disabled,
  onClick,
  title
}: {
  children: ReactNode
  disabled?: boolean
  onClick: () => void
  title?: string
}): JSX.Element {
  return (
    <button type="button" className="tool-button git-manager-action" disabled={disabled} onClick={onClick} title={title}>
      {children}
    </button>
  )
}

function StatusPill({ children }: { children: ReactNode }): JSX.Element {
  return <span className="git-manager-pill">{children}</span>
}

function DiffRenderer({ diff, mode, copy }: { diff: GitDiffResult | null; mode: DiffMode; copy: GitManagerCopy }): JSX.Element {
  const files = useMemo(() => {
    if (!diff?.diff) return []
    try {
      return parseDiff(diff.diff)
    } catch {
      return []
    }
  }, [diff])

  if (diff?.binary) {
    return <div className="git-manager-diff-empty">{copy.binaryDiff}</div>
  }

  if (!diff?.diff || files.length === 0) {
    return (
      <div className="git-manager-diff-empty">
        {diff?.truncated ? copy.truncatedDiff : copy.noDiff}
      </div>
    )
  }

  return (
    <div className="git-manager-diff-view">
      {diff.truncated ? <div className="git-manager-diff-warning">{copy.truncatedDiff}</div> : null}
      {files.map((file, index) => (
        <section key={`${file.oldPath}-${file.newPath}-${index}`} className="git-manager-diff-file">
          <header>
            <span>{file.oldPath && file.oldPath !== file.newPath ? `${file.oldPath} -> ${file.newPath}` : file.newPath || file.oldPath}</span>
          </header>
          <Diff viewType={mode} diffType={file.type} hunks={file.hunks}>
            {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
          </Diff>
        </section>
      ))}
    </div>
  )
}

export function GitManagerComponent({ component, updateConfig, updateState }: AtlasComponentRendererProps): JSX.Element {
  const { locale, t } = useI18n()
  const copy = COPY[locale]
  const repoPath = asString(component.config.repoPath)
  const persistedActiveTab = (asString(component.state.activeTab, 'changes') as GitManagerTab) || 'changes'
  const persistedDiffMode = (asString(component.state.diffMode, 'split') as DiffMode) || 'split'
  const persistedBranch = asString(component.state.selectedBranch)
  const persistedSidebarWidth = asNumber(component.state.sidebarWidth, DEFAULT_SIDEBAR_WIDTH)
  const persistedFileRailWidth = asNumber(component.state.fileRailWidth, DEFAULT_FILE_RAIL_WIDTH)
  const [activeTab, setActiveTabState] = useState<GitManagerTab>(persistedActiveTab)
  const [diffMode, setDiffModeState] = useState<DiffMode>(persistedDiffMode)
  const [sidebarWidth, setSidebarWidth] = useState(() => clampNumber(persistedSidebarWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH))
  const [fileRailWidth, setFileRailWidth] = useState(() => clampNumber(persistedFileRailWidth, MIN_FILE_RAIL_WIDTH, MAX_FILE_RAIL_WIDTH))
  const [summary, setSummary] = useState<GitSummary | null>(null)
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null)
  const [branches, setBranches] = useState<GitBranchSummary[]>([])
  const [commits, setCommits] = useState<GitCommitSummary[]>([])
  const [stashes, setStashes] = useState<GitStashEntry[]>([])
  const [selectedBranch, setSelectedBranch] = useState<string>(persistedBranch)
  const [selectedCommit, setSelectedCommit] = useState<GitCommitSummary | null>(null)
  const [selectedDiff, setSelectedDiff] = useState<SelectedDiff | null>(null)
  const [selectedChangeIds, setSelectedChangeIds] = useState<string[]>([])
  const [diff, setDiff] = useState<GitDiffResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorDialogOpen, setErrorDialogOpen] = useState(false)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const [commitDialogOpen, setCommitDialogOpen] = useState(false)
  const [commitScope, setCommitScope] = useState<CommitScope>({ kind: 'staged' })
  const [commitMessage, setCommitMessage] = useState('')
  const [branchDialogOpen, setBranchDialogOpen] = useState(false)
  const [branchName, setBranchName] = useState('')
  const [stashDialogOpen, setStashDialogOpen] = useState(false)
  const [stashMessage, setStashMessage] = useState('')
  const mainRef = useRef<HTMLDivElement | null>(null)
  const detailContentRef = useRef<HTMLDivElement | null>(null)
  const selectAllChangesRef = useRef<HTMLInputElement | null>(null)
  const resizeSessionRef = useRef<{ pane: ResizePane; pointerId: number } | null>(null)
  const loadSeqRef = useRef(0)

  const currentBranch = status?.currentBranch ?? null
  const selectedLogRef = selectedBranch || currentBranch || undefined

  const setActiveTab = useCallback(
    (tab: GitManagerTab) => {
      setActiveTabState(tab)
      updateState({ activeTab: tab }, false)
    },
    [updateState]
  )

  const setDiffMode = useCallback(
    (mode: DiffMode) => {
      setDiffModeState(mode)
      updateState({ diffMode: mode }, false)
    },
    [updateState]
  )

  useEffect(() => {
    setActiveTabState(persistedActiveTab)
  }, [persistedActiveTab])

  useEffect(() => {
    setDiffModeState(persistedDiffMode)
  }, [persistedDiffMode])

  useEffect(() => {
    if (!error) setErrorDialogOpen(false)
  }, [error])

  useEffect(() => {
    setSelectedChangeIds([])
    setCommitScope({ kind: 'staged' })
  }, [repoPath])

  useEffect(() => {
    const validIds = new Set((status?.files ?? []).map((file) => fileKey(file, file.area)))
    setSelectedChangeIds((current) => {
      const next = current.filter((id) => validIds.has(id))
      return next.length === current.length ? current : next
    })
  }, [status?.files])

  useEffect(() => {
    setSidebarWidth(clampNumber(persistedSidebarWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH))
  }, [persistedSidebarWidth])

  useEffect(() => {
    setFileRailWidth(clampNumber(persistedFileRailWidth, MIN_FILE_RAIL_WIDTH, MAX_FILE_RAIL_WIDTH))
  }, [persistedFileRailWidth])

  const clampSidebarWidth = useCallback((value: number) => {
    const containerWidth = mainRef.current?.getBoundingClientRect().width
    const maxByContainer = containerWidth ? containerWidth - MIN_DETAIL_WIDTH - SPLITTER_SIZE : MAX_SIDEBAR_WIDTH
    return clampNumber(value, MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, maxByContainer))
  }, [])

  const clampFileRailWidth = useCallback((value: number) => {
    const containerWidth = detailContentRef.current?.getBoundingClientRect().width
    const maxByContainer = containerWidth ? containerWidth - MIN_DIFF_WIDTH - SPLITTER_SIZE : MAX_FILE_RAIL_WIDTH
    return clampNumber(value, MIN_FILE_RAIL_WIDTH, Math.min(MAX_FILE_RAIL_WIDTH, maxByContainer))
  }, [])

  const resizePaneFromPointer = useCallback(
    (pane: ResizePane, clientX: number) => {
      if (pane === 'sidebar') {
        const rect = mainRef.current?.getBoundingClientRect()
        if (!rect) return sidebarWidth
        const nextWidth = clampSidebarWidth(clientX - rect.left)
        setSidebarWidth(nextWidth)
        return nextWidth
      }

      const rect = detailContentRef.current?.getBoundingClientRect()
      if (!rect) return fileRailWidth
      const nextWidth = clampFileRailWidth(rect.right - clientX)
      setFileRailWidth(nextWidth)
      return nextWidth
    },
    [clampFileRailWidth, clampSidebarWidth, fileRailWidth, sidebarWidth]
  )

  const beginPaneResize = useCallback((pane: ResizePane, event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    resizeSessionRef.current = { pane, pointerId: event.pointerId }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is not implemented in every test DOM.
    }
  }, [])

  const movePaneResize = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const session = resizeSessionRef.current
      if (!session || session.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      resizePaneFromPointer(session.pane, event.clientX)
    },
    [resizePaneFromPointer]
  )

  const endPaneResize = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const session = resizeSessionRef.current
      if (!session || session.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const nextWidth = Math.round(resizePaneFromPointer(session.pane, event.clientX))
      resizeSessionRef.current = null
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Pointer capture is not implemented in every test DOM.
      }
      if (session.pane === 'sidebar') {
        updateState({ sidebarWidth: nextWidth }, false)
      } else {
        updateState({ fileRailWidth: nextWidth }, false)
      }
    },
    [resizePaneFromPointer, updateState]
  )

  const nudgePaneResize = useCallback(
    (pane: ResizePane, event: KeyboardEvent<HTMLButtonElement>) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      const step = event.shiftKey ? 40 : 16
      let nextWidth = pane === 'sidebar' ? sidebarWidth : fileRailWidth

      if (event.key === 'Home') {
        nextWidth = pane === 'sidebar' ? MIN_SIDEBAR_WIDTH : MIN_FILE_RAIL_WIDTH
      } else if (event.key === 'End') {
        nextWidth = pane === 'sidebar' ? MAX_SIDEBAR_WIDTH : MAX_FILE_RAIL_WIDTH
      } else if (pane === 'sidebar') {
        nextWidth += event.key === 'ArrowRight' ? step : -step
      } else {
        nextWidth += event.key === 'ArrowLeft' ? step : -step
      }

      if (pane === 'sidebar') {
        const clamped = Math.round(clampSidebarWidth(nextWidth))
        setSidebarWidth(clamped)
        updateState({ sidebarWidth: clamped }, false)
      } else {
        const clamped = Math.round(clampFileRailWidth(nextWidth))
        setFileRailWidth(clamped)
        updateState({ fileRailWidth: clamped }, false)
      }
    },
    [clampFileRailWidth, clampSidebarWidth, fileRailWidth, sidebarWidth, updateState]
  )

  const clearDetailSelection = useCallback(() => {
    setSelectedCommit(null)
    setSelectedDiff(null)
    setDiff(null)
  }, [])

  const refreshStatus = useCallback(
    async (path = repoPath) => {
      if (!path) return null
      const nextStatus = await window.atlas.git.status(path)
      setStatus(nextStatus)
      setSummary((current) => (current ? { ...current, status: nextStatus } : current))
      return nextStatus
    },
    [repoPath]
  )

  const loadDiff = useCallback(
    async (selection: SelectedDiff | null, path = repoPath) => {
      if (!selection || !path) {
        clearDetailSelection()
        return
      }

      setSelectedDiff(selection)
      if (selection.target.kind !== 'commit') setSelectedCommit(null)

      try {
        const nextDiff = await window.atlas.git.diff(path, selection.target)
        setDiff(nextDiff)
        setError(null)
      } catch (nextError) {
        setDiff(null)
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      }
    },
    [clearDetailSelection, repoPath]
  )

  const loadSummary = useCallback(
    async (path = repoPath) => {
      if (!path) return
      const seq = loadSeqRef.current + 1
      loadSeqRef.current = seq
      setLoading(true)

      try {
        const nextSummary = await window.atlas.git.summary(path)
        if (loadSeqRef.current !== seq) return

        if (nextSummary.repoPath !== repoPath) updateConfig({ repoPath: nextSummary.repoPath }, true)
        setSummary(nextSummary)
        setStatus(nextSummary.status)
        setBranches(nextSummary.branches)
        setCommits(nextSummary.commits)
        setStashes(nextSummary.stashes)
        const nextBranch = selectedBranch || persistedBranch || nextSummary.status.currentBranch || ''
        setSelectedBranch(nextBranch)
        setError(null)

        const firstChange = nextSummary.status.files[0]
        if (firstChange) {
          void loadDiff(
            {
              id: fileKey(firstChange, firstChange.area),
              title: firstChange.path,
              detail: firstChange.area,
              target: {
                kind: firstChange.area === 'staged' ? 'staged' : 'worktree',
                filePath: firstChange.path
              }
            },
            nextSummary.repoPath
          )
        } else {
          clearDetailSelection()
        }
      } catch (nextError) {
        if (loadSeqRef.current !== seq) return
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        if (loadSeqRef.current === seq) setLoading(false)
      }
    },
    [clearDetailSelection, loadDiff, persistedBranch, repoPath, selectedBranch, updateConfig]
  )

  const loadLog = useCallback(
    async (ref = selectedLogRef, skip = 0, append = false) => {
      if (!repoPath) return
      setLoading(true)

      try {
        const nextCommits = await window.atlas.git.log(repoPath, { ref, limit: HISTORY_LIMIT, skip })
        setCommits((current) => (append ? [...current, ...nextCommits] : nextCommits))
        setError(null)
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        setLoading(false)
      }
    },
    [repoPath, selectedLogRef]
  )

  useEffect(() => {
    if (repoPath) void loadSummary(repoPath)
  }, [loadSummary, repoPath])

  const chooseRepository = useCallback(async () => {
    try {
      const selected = await window.atlas.git.chooseRepository(copy.bindRepo)
      if (!selected) return
      updateConfig({ repoPath: selected }, true)
      updateState({ activeTab: 'changes', selectedBranch: '', diffMode }, true)
      await loadSummary(selected)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    }
  }, [copy.bindRepo, diffMode, loadSummary, updateConfig, updateState])

  const applyOperation = useCallback(
    async (operation: Promise<GitOperationResult>) => {
      const result = await operation
      setStatus(result.status)
      setSummary((current) => (current ? { ...current, status: result.status } : current))
      const [nextBranches, nextStashes] = await Promise.all([window.atlas.git.branches(result.status.repoPath), window.atlas.git.stashes(result.status.repoPath)])
      setBranches(nextBranches)
      setStashes(nextStashes)
      setError(null)
    },
    []
  )

  const runConfirmed = useCallback(
    async (pending: PendingConfirm) => {
      setConfirm(null)
      setLoading(true)
      try {
        await pending.run()
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const runOperation = useCallback(
    async (operation: () => Promise<GitOperationResult>) => {
      setLoading(true)
      try {
        await applyOperation(operation())
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        setLoading(false)
      }
    },
    [applyOperation]
  )

  const stageFiles = useCallback(
    async (files: GitChangedFile[]) => {
      if (!repoPath) return
      const filePaths = pathListForChanges(files)
      if (!filePaths.length) return
      setLoading(true)
      try {
        await applyOperation(window.atlas.git.stage(repoPath, filePaths))
        await loadDiff(selectedDiff)
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        setLoading(false)
      }
    },
    [applyOperation, loadDiff, repoPath, selectedDiff]
  )

  const unstageFiles = useCallback(
    async (files: GitChangedFile[]) => {
      if (!repoPath) return
      const filePaths = pathListForChanges(files)
      if (!filePaths.length) return
      setLoading(true)
      try {
        await applyOperation(window.atlas.git.unstage(repoPath, filePaths))
        await loadDiff(selectedDiff)
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        setLoading(false)
      }
    },
    [applyOperation, loadDiff, repoPath, selectedDiff]
  )

  const stageFile = useCallback((file: GitChangedFile) => stageFiles([file]), [stageFiles])
  const unstageFile = useCallback((file: GitChangedFile) => unstageFiles([file]), [unstageFiles])

  const openCommit = useCallback(async (commit: GitCommitSummary) => {
    if (!repoPath) return
    setLoading(true)
    try {
      const detail = await window.atlas.git.commitDetail(repoPath, commit.hash)
      setSelectedCommit(detail)
      const firstFile = detail.files?.[0]
      if (firstFile) {
        await loadDiff({
          id: fileKey(firstFile, detail.hash),
          title: firstFile.path,
          detail: detail.shortHash,
          target: {
            kind: 'commit',
            commitHash: detail.hash,
            filePath: firstFile.path,
            oldPath: firstFile.oldPath
          }
        })
      } else {
        setSelectedDiff(null)
        setDiff(null)
      }
      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setLoading(false)
    }
  }, [loadDiff, repoPath])

  const submitCommit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!repoPath || !commitMessage.trim()) return

      setCommitDialogOpen(false)
      setLoading(true)
      try {
        await applyOperation(window.atlas.git.commit(repoPath, commitMessage.trim(), commitScope.kind === 'selected' ? commitScope.filePaths : undefined))
        clearDetailSelection()
        setCommitMessage('')
        setSelectedChangeIds([])
        setCommitScope({ kind: 'staged' })
        await loadLog(selectedLogRef, 0, false)
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        setLoading(false)
      }
    },
    [applyOperation, clearDetailSelection, commitMessage, commitScope, loadLog, repoPath, selectedLogRef]
  )

  const submitBranch = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!repoPath || !branchName.trim()) return

      setBranchDialogOpen(false)
      setLoading(true)
      try {
        await applyOperation(window.atlas.git.createBranch(repoPath, branchName.trim(), selectedLogRef))
        setBranchName('')
        const nextBranches = await window.atlas.git.branches(repoPath)
        setBranches(nextBranches)
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        setLoading(false)
      }
    },
    [applyOperation, branchName, repoPath, selectedLogRef]
  )

  const submitStash = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!repoPath) return

      setStashDialogOpen(false)
      setLoading(true)
      try {
        await applyOperation(window.atlas.git.pushStash(repoPath, stashMessage.trim() || undefined))
        setStashMessage('')
        await refreshStatus(repoPath)
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        setLoading(false)
      }
    },
    [applyOperation, refreshStatus, repoPath, stashMessage]
  )

  const changeGroups = useMemo(() => groupChanges(status?.files ?? []), [status?.files])
  const selectableChanges = useMemo(() => (status?.files ?? []).filter((file) => file.area !== 'conflicted'), [status?.files])
  const selectedChangeIdSet = useMemo(() => new Set(selectedChangeIds), [selectedChangeIds])
  const selectedChanges = useMemo(() => (status?.files ?? []).filter((file) => selectedChangeIdSet.has(fileKey(file, file.area))), [selectedChangeIdSet, status?.files])
  const selectedStageableChanges = selectedChanges.filter((file) => file.area !== 'staged' && file.area !== 'conflicted')
  const selectedUnstageableChanges = selectedChanges.filter((file) => file.area === 'staged')
  const selectedCommittableChanges = selectedChanges.filter((file) => file.area !== 'conflicted')
  const selectedCommitPaths = useMemo(() => pathListForChanges(selectedCommittableChanges), [selectedCommittableChanges])
  const selectableChangeIds = useMemo(() => selectableChanges.map((file) => fileKey(file, file.area)), [selectableChanges])
  const allSelectableChangesSelected = selectableChangeIds.length > 0 && selectableChangeIds.every((id) => selectedChangeIdSet.has(id))
  const hasMoreCommits = commits.length > 0 && commits.length % HISTORY_LIMIT === 0
  const currentBranchSummary = branches.find((branch) => branch.current)
  const mainStyle = useMemo(
    () =>
      ({
        '--git-sidebar-width': `${Math.round(sidebarWidth)}px`
      }) as CSSProperties,
    [sidebarWidth]
  )
  const detailContentStyle = useMemo(
    () =>
      ({
        '--git-file-rail-width': `${Math.round(fileRailWidth)}px`
      }) as CSSProperties,
    [fileRailWidth]
  )

  const toggleChangeSelection = useCallback((id: string, checked: boolean) => {
    setSelectedChangeIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id]
      return current.filter((item) => item !== id)
    })
  }, [])

  const toggleAllChanges = useCallback(
    (checked: boolean) => {
      setSelectedChangeIds((current) => {
        const selectable = new Set(selectableChangeIds)
        if (!checked) return current.filter((id) => !selectable.has(id))
        const next = [...current]
        selectableChangeIds.forEach((id) => {
          if (!next.includes(id)) next.push(id)
        })
        return next
      })
    },
    [selectableChangeIds]
  )

  const openCommitDialog = useCallback((scope: CommitScope) => {
    setCommitScope(scope)
    setCommitDialogOpen(true)
  }, [])

  const stageSelectedChanges = useCallback(() => stageFiles(selectedStageableChanges), [selectedStageableChanges, stageFiles])
  const unstageSelectedChanges = useCallback(() => unstageFiles(selectedUnstageableChanges), [selectedUnstageableChanges, unstageFiles])
  const openSelectedCommit = useCallback(() => {
    if (!selectedCommitPaths.length) return
    openCommitDialog({ kind: 'selected', filePaths: selectedCommitPaths })
  }, [openCommitDialog, selectedCommitPaths])

  useEffect(() => {
    if (!selectAllChangesRef.current) return
    selectAllChangesRef.current.indeterminate = selectedChangeIds.length > 0 && !allSelectableChangesSelected
  }, [allSelectableChangesSelected, selectedChangeIds.length])

  if (!repoPath) {
    return (
      <div className="empty-module git-manager-empty">
        <GitBranch size={30} />
        <strong>{copy.bindRepo}</strong>
        <span>{copy.noRepo}</span>
        <button className="primary-button" onClick={() => void chooseRepository()}>
          {copy.chooseRepo}
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="git-manager-module">
        <header className="git-manager-header">
          <div className="git-manager-repo">
            <span className="git-manager-repo__icon" aria-hidden="true">
              <GitBranch size={16} />
            </span>
            <div>
              <strong>{currentBranch ?? t('component.gitManager')}</strong>
              <span title={repoPath}>{repoPath}</span>
            </div>
          </div>
          <div className="git-manager-header__meta">
            {status ? <StatusPill>{status.isClean ? copy.clean : copy.dirtyCount(status.files.length)}</StatusPill> : null}
            {status?.upstream ? <StatusPill>{status.upstream}</StatusPill> : null}
            {status ? <StatusPill>{copy.aheadBehind(status.ahead, status.behind)}</StatusPill> : null}
            {status?.stashCount ? <StatusPill>{copy.stashCount(status.stashCount)}</StatusPill> : null}
          </div>
          <div className="git-manager-header__actions">
            <button type="button" className="icon-button" title={copy.chooseRepo} aria-label={copy.chooseRepo} onClick={() => void chooseRepository()}>
              <Box size={15} />
            </button>
            <button type="button" className="icon-button" title={copy.refresh} aria-label={copy.refresh} onClick={() => void loadSummary()}>
              <RefreshCw size={15} />
            </button>
          </div>
        </header>

        <div className="git-manager-toolbar">
          <div className="git-manager-tabs" role="tablist" aria-label={t('component.gitManager')}>
            {(['changes', 'log', 'branches', 'stashes'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={cn('segmented', activeTab === tab && 'segmented--active')}
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'changes' ? <GitCompare size={14} /> : tab === 'log' ? <History size={14} /> : tab === 'branches' ? <GitBranch size={14} /> : <Layers size={14} />}
                <span>{copy[tab]}</span>
              </button>
            ))}
          </div>
          <div className="git-manager-toolbar__actions">
            <ActionButton disabled={loading} onClick={() => void runOperation(() => window.atlas.git.fetch(repoPath))}>
              <GitPullRequestArrow size={14} />
              <span>{copy.fetch}</span>
            </ActionButton>
            <ActionButton
              disabled={loading}
              onClick={() =>
                setConfirm({
                  title: copy.pull,
                  description: copy.confirmPull,
                  actionLabel: copy.pull,
                  run: () => applyOperation(window.atlas.git.pull(repoPath))
                })
              }
            >
              <GitPullRequest size={14} />
              <span>{copy.pull}</span>
            </ActionButton>
            <ActionButton
              disabled={loading}
              onClick={() =>
                setConfirm({
                  title: copy.push,
                  description: copy.confirmPush,
                  actionLabel: copy.push,
                  run: () => applyOperation(window.atlas.git.push(repoPath))
                })
              }
            >
              <Send size={14} />
              <span>{copy.push}</span>
            </ActionButton>
            <ActionButton disabled={loading || !status?.files.some((file) => file.area === 'staged')} onClick={() => openCommitDialog({ kind: 'staged' })}>
              <GitCommitHorizontal size={14} />
              <span>{copy.commit}</span>
            </ActionButton>
            <ActionButton disabled={loading || !status?.files.length} onClick={() => setStashDialogOpen(true)}>
              <Upload size={14} />
              <span>{copy.stash}</span>
            </ActionButton>
          </div>
        </div>

        {error ? (
          <div className="module-error git-manager-error" role="alert">
            <span className="git-manager-error__message">{error}</span>
            <div className="git-manager-error__actions">
              <button type="button" className="git-manager-inline-action" onClick={() => setErrorDialogOpen(true)}>
                {copy.viewError}
              </button>
              <button
                type="button"
                className="icon-button git-manager-error__close"
                aria-label={copy.closeError}
                title={copy.closeError}
                onClick={() => {
                  setError(null)
                  setErrorDialogOpen(false)
                }}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        ) : null}

        <div className="git-manager-main" ref={mainRef} style={mainStyle}>
          <aside className="git-manager-sidebar">
            {activeTab === 'changes' ? (
              <div className="git-manager-list">
                {status?.files.length ? (
                  <div className="git-manager-list-toolbar git-manager-changes-toolbar">
                    <label className="git-manager-change-select-all">
                      <input
                        ref={selectAllChangesRef}
                        type="checkbox"
                        aria-label={copy.selectAllChanges}
                        checked={allSelectableChangesSelected}
                        disabled={!selectableChangeIds.length}
                        onChange={(event) => toggleAllChanges(event.currentTarget.checked)}
                      />
                      <span>{selectedChanges.length ? copy.selectedCount(selectedChanges.length) : copy.files}</span>
                    </label>
                    <div className="git-manager-change-actions">
                      <button type="button" className="git-manager-inline-action" disabled={loading || !selectedStageableChanges.length} onClick={() => void stageSelectedChanges()}>
                        {copy.stageSelected}
                      </button>
                      <button type="button" className="git-manager-inline-action" disabled={loading || !selectedUnstageableChanges.length} onClick={() => void unstageSelectedChanges()}>
                        {copy.unstageSelected}
                      </button>
                      <button type="button" className="git-manager-inline-action" disabled={loading || !selectedCommitPaths.length} onClick={openSelectedCommit}>
                        {copy.commitSelected}
                      </button>
                    </div>
                  </div>
                ) : null}
                {(['conflicted', 'staged', 'unstaged', 'untracked'] as const).map((area) =>
                  changeGroups[area].length ? (
                    <section key={area} className="git-manager-section">
                      <h3>{copy[area]}</h3>
                      {changeGroups[area].map((file) => {
                        const id = fileKey(file, area)
                        return (
                          <div
                            key={id}
                            className={cn('git-manager-file-row', selectedDiff?.id === id && 'git-manager-row--selected', selectedChangeIdSet.has(id) && 'git-manager-row--checked')}
                          >
                            <input
                              type="checkbox"
                              className="git-manager-file-row__check"
                              aria-label={file.path}
                              checked={selectedChangeIdSet.has(id)}
                              disabled={area === 'conflicted'}
                              onChange={(event) => toggleChangeSelection(id, event.currentTarget.checked)}
                            />
                            <button
                              type="button"
                              className="git-manager-file-row__main"
                              onClick={() =>
                                void loadDiff({
                                  id,
                                  title: file.path,
                                  detail: area,
                                  target: {
                                    kind: area === 'staged' ? 'staged' : 'worktree',
                                    filePath: file.path
                                  }
                                })
                              }
                            >
                              <span className={`git-manager-status git-manager-status--${file.status}`}>{statusLabel(file.status)}</span>
                              <span>{file.path}</span>
                            </button>
                            {area === 'staged' ? (
                              <button
                                type="button"
                                className="git-manager-inline-action"
                                onClick={() => void unstageFile(file)}
                              >
                                {copy.unstage}
                              </button>
                            ) : area !== 'conflicted' ? (
                              <button
                                type="button"
                                className="git-manager-inline-action"
                                onClick={() => void stageFile(file)}
                              >
                                {copy.stage}
                              </button>
                            ) : null}
                          </div>
                        )
                      })}
                    </section>
                  ) : null
                )}
                {status?.files.length === 0 ? <div className="git-manager-empty-list">{copy.noChanges}</div> : null}
              </div>
            ) : null}

            {activeTab === 'log' ? (
              <div className="git-manager-list">
                <div className="git-manager-list-toolbar">
                  <span>{selectedLogRef ?? currentBranchSummary?.name ?? copy.log}</span>
                  <button type="button" className="icon-button" onClick={() => void loadLog(selectedLogRef, 0, false)} aria-label={copy.refresh} title={copy.refresh}>
                    <RefreshCw size={14} />
                  </button>
                </div>
                {commits.map((commit) => (
                  <button
                    key={commit.hash}
                    type="button"
                    className={cn('git-manager-commit-row', selectedCommit?.hash === commit.hash && 'git-manager-row--selected')}
                    onClick={() => void openCommit(commit)}
                  >
                    <span className="git-manager-commit-row__hash">{commit.shortHash}</span>
                    <strong>{commit.subject}</strong>
                    <span>{copy.byAuthor(commit.authorName)} · {formatDate(commit.authoredAt)}</span>
                  </button>
                ))}
                {hasMoreCommits ? (
                  <button type="button" className="tool-button git-manager-load-more" onClick={() => void loadLog(selectedLogRef, commits.length, true)}>
                    {copy.loadMore}
                  </button>
                ) : null}
                {commits.length === 0 ? <div className="git-manager-empty-list">{copy.noCommits}</div> : null}
              </div>
            ) : null}

            {activeTab === 'branches' ? (
              <div className="git-manager-list">
                <div className="git-manager-list-toolbar">
                  <span>{copy.branches}</span>
                  <button type="button" className="tool-button git-manager-action" onClick={() => setBranchDialogOpen(true)}>
                    <Plus size={14} />
                    <span>{copy.createBranch}</span>
                  </button>
                </div>
                {branches.map((branch) => (
                  <div
                    key={branch.fullName}
                    className={cn('git-manager-branch-row', selectedBranch === branchLogRef(branch) && 'git-manager-row--selected')}
                  >
                    <button
                      type="button"
                      className="git-manager-branch-row__main"
                      onClick={() => {
                        const ref = branchLogRef(branch)
                        setSelectedBranch(ref)
                        setActiveTabState('log')
                        updateState({ selectedBranch: ref, activeTab: 'log' }, false)
                        void loadLog(ref, 0, false)
                      }}
                    >
                      <span className="git-manager-branch-row__icon">{branch.current ? <Check size={14} /> : <ChevronRight size={14} />}</span>
                      <span>
                        <strong>{branch.name}</strong>
                        <small>{branch.remote ? copy.remote : copy.local}{branch.current ? ` · ${copy.current}` : ''}</small>
                      </span>
                    </button>
                    <span className="git-manager-branch-row__actions">
                      {!branch.current ? (
                        <button
                          type="button"
                          className="git-manager-inline-action"
                          onClick={(event) => {
                            event.stopPropagation()
                            setConfirm({
                              title: copy.switchBranch,
                              description: copy.confirmSwitchBranch(branch.name, branch.remote),
                              actionLabel: copy.switchBranch,
                              run: () => applyOperation(window.atlas.git.switchBranch(repoPath, branch.name, branch.remote))
                            })
                          }}
                        >
                          {copy.switchBranch}
                        </button>
                      ) : null}
                      {!branch.remote && !branch.current ? (
                        <button
                          type="button"
                          className="git-manager-inline-action git-manager-inline-action--danger"
                          onClick={(event) => {
                            event.stopPropagation()
                            setConfirm({
                              title: copy.deleteBranch,
                              description: copy.confirmDeleteBranch(branch.name),
                              actionLabel: copy.deleteBranch,
                              danger: true,
                              run: () => applyOperation(window.atlas.git.deleteBranch(repoPath, branch.name))
                            })
                          }}
                        >
                          {copy.deleteBranch}
                        </button>
                      ) : null}
                    </span>
                  </div>
                ))}
                {branches.length === 0 ? <div className="git-manager-empty-list">{copy.noBranches}</div> : null}
              </div>
            ) : null}

            {activeTab === 'stashes' ? (
              <div className="git-manager-list">
                {stashes.map((stash) => (
                  <article key={stash.ref} className="git-manager-stash-row">
                    <button
                      type="button"
                      onClick={() =>
                        setConfirm({
                          title: copy.apply,
                          description: copy.confirmApplyStash(stash.ref),
                          actionLabel: copy.apply,
                          run: () => applyOperation(window.atlas.git.applyStash(repoPath, stash.ref))
                        })
                      }
                    >
                      <strong>{stash.ref}</strong>
                      <span>{stash.message}</span>
                    </button>
                    <div>
                      <button
                        type="button"
                        className="git-manager-inline-action"
                        onClick={() =>
                          setConfirm({
                            title: copy.pop,
                            description: copy.confirmPopStash(stash.ref),
                            actionLabel: copy.pop,
                            run: () => applyOperation(window.atlas.git.popStash(repoPath, stash.ref))
                          })
                        }
                      >
                        {copy.pop}
                      </button>
                      <button
                        type="button"
                        className="git-manager-inline-action git-manager-inline-action--danger"
                        onClick={() =>
                          setConfirm({
                            title: copy.drop,
                            description: copy.confirmDropStash(stash.ref),
                            actionLabel: copy.drop,
                            danger: true,
                            run: () => applyOperation(window.atlas.git.dropStash(repoPath, stash.ref))
                          })
                        }
                      >
                        {copy.drop}
                      </button>
                    </div>
                  </article>
                ))}
                {stashes.length === 0 ? <div className="git-manager-empty-list">{copy.noStashes}</div> : null}
              </div>
            ) : null}
          </aside>

          <button
            type="button"
            className="git-manager-splitter git-manager-splitter--sidebar"
            role="separator"
            aria-label={copy.resizeLog}
            aria-orientation="vertical"
            onPointerDown={(event) => beginPaneResize('sidebar', event)}
            onPointerMove={movePaneResize}
            onPointerUp={endPaneResize}
            onPointerCancel={endPaneResize}
            onKeyDown={(event) => nudgePaneResize('sidebar', event)}
          />

          <section className="git-manager-detail">
            <header className="git-manager-detail__header">
              <div>
                <strong>{selectedCommit ? selectedCommit.subject : selectedDiff?.title ?? copy.noDiff}</strong>
                <span>{selectedCommit ? `${selectedCommit.shortHash} · ${formatDate(selectedCommit.authoredAt)}` : selectedDiff?.detail}</span>
              </div>
              <div className="git-manager-diff-toggle">
                <button type="button" className={cn('segmented', diffMode === 'split' && 'segmented--active')} onClick={() => setDiffMode('split')}>
                  {copy.split}
                </button>
                <button type="button" className={cn('segmented', diffMode === 'unified' && 'segmented--active')} onClick={() => setDiffMode('unified')}>
                  {copy.unified}
                </button>
              </div>
            </header>

            {selectedCommit?.body ? <pre className="git-manager-commit-body">{selectedCommit.body}</pre> : null}

            <div
              ref={detailContentRef}
              style={detailContentStyle}
              className={cn('git-manager-detail__content', selectedCommit?.files?.length && 'git-manager-detail__content--with-files')}
            >
              <div className="git-manager-diff-pane">
                <DiffRenderer diff={diff} mode={diffMode} copy={copy} />
              </div>
              {selectedCommit?.files?.length ? (
                <>
                  <button
                    type="button"
                    className="git-manager-splitter git-manager-splitter--files"
                    role="separator"
                    aria-label={copy.resizeFiles}
                    aria-orientation="vertical"
                    onPointerDown={(event) => beginPaneResize('fileRail', event)}
                    onPointerMove={movePaneResize}
                    onPointerUp={endPaneResize}
                    onPointerCancel={endPaneResize}
                    onKeyDown={(event) => nudgePaneResize('fileRail', event)}
                  />
                  <aside className="git-manager-commit-files" aria-label={copy.files}>
                    <header className="git-manager-commit-files__header">
                      <span>{copy.files}</span>
                      <strong>{selectedCommit.files.length}</strong>
                    </header>
                    <div className="git-manager-commit-file-list">
                      {selectedCommit.files.map((file) => {
                        const id = fileKey(file, selectedCommit.hash)
                        const pathParts = filePathParts(file.path)
                        return (
                          <button
                            key={id}
                            type="button"
                            className={cn('git-manager-commit-file-row', selectedDiff?.id === id && 'git-manager-row--selected')}
                            onClick={() =>
                              void loadDiff({
                                id,
                                title: file.path,
                                detail: selectedCommit.shortHash,
                                target: {
                                  kind: 'commit',
                                  commitHash: selectedCommit.hash,
                                  filePath: file.path,
                                  oldPath: file.oldPath
                                }
                              })
                            }
                          >
                            <span className={`git-manager-status git-manager-status--${file.status}`}>{statusLabel(file.status)}</span>
                            <span className="git-manager-commit-file-row__text">
                              <strong>{pathParts.name}</strong>
                              {file.oldPath || pathParts.directory ? <small>{file.oldPath ? `${file.oldPath} -> ${file.path}` : pathParts.directory}</small> : null}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </aside>
                </>
              ) : null}
            </div>
          </section>
        </div>
      </div>

      <Dialog.Root open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title className="dialog-title">{confirm?.title}</Dialog.Title>
            <Dialog.Description className="dialog-description">{confirm?.description}</Dialog.Description>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="tool-button">
                  <X size={15} />
                  <span>{copy.cancel}</span>
                </button>
              </Dialog.Close>
              <button type="button" className={cn('tool-button', confirm?.danger && 'danger')} onClick={() => confirm && void runConfirmed(confirm)}>
                <span>{confirm?.actionLabel ?? copy.confirm}</span>
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={errorDialogOpen && Boolean(error)} onOpenChange={setErrorDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content git-manager-error-dialog">
            <Dialog.Title className="dialog-title">{copy.errorDetails}</Dialog.Title>
            <Dialog.Description className="sr-only">{copy.errorDetails}</Dialog.Description>
            <pre className="git-manager-error-dialog__message">{error}</pre>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="tool-button">
                  {copy.closeError}
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={commitDialogOpen}
        onOpenChange={(open) => {
          setCommitDialogOpen(open)
          if (!open) setCommitScope({ kind: 'staged' })
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content git-manager-dialog">
            <Dialog.Title className="dialog-title">{commitScope.kind === 'selected' ? copy.commitSelected : copy.commit}</Dialog.Title>
            {commitScope.kind === 'selected' ? (
              <Dialog.Description className="dialog-description">{copy.commitSelectedDescription(commitScope.filePaths.length)}</Dialog.Description>
            ) : null}
            <form onSubmit={submitCommit}>
              <label className="git-manager-dialog-field">
                <span>{copy.commitMessage}</span>
                <textarea value={commitMessage} autoFocus placeholder={copy.commitPlaceholder} onChange={(event) => setCommitMessage(event.target.value)} />
              </label>
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button type="button" className="tool-button">
                    {copy.cancel}
                  </button>
                </Dialog.Close>
                <button type="submit" className="tool-button" disabled={!commitMessage.trim()}>
                  {commitScope.kind === 'selected' ? copy.commitSelected : copy.commit}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={branchDialogOpen} onOpenChange={setBranchDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content git-manager-dialog">
            <Dialog.Title className="dialog-title">{copy.createBranch}</Dialog.Title>
            <form onSubmit={submitBranch}>
              <label className="git-manager-dialog-field">
                <span>{copy.branchName}</span>
                <input value={branchName} autoFocus onChange={(event) => setBranchName(event.target.value)} />
              </label>
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button type="button" className="tool-button">
                    {copy.cancel}
                  </button>
                </Dialog.Close>
                <button type="submit" className="tool-button" disabled={!branchName.trim()}>
                  <Plus size={15} />
                  <span>{copy.createBranch}</span>
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={stashDialogOpen} onOpenChange={setStashDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content git-manager-dialog">
            <Dialog.Title className="dialog-title">{copy.stash}</Dialog.Title>
            <form onSubmit={submitStash}>
              <label className="git-manager-dialog-field">
                <span>{copy.stashMessage} · {copy.optional}</span>
                <input value={stashMessage} autoFocus onChange={(event) => setStashMessage(event.target.value)} />
              </label>
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button type="button" className="tool-button">
                    {copy.cancel}
                  </button>
                </Dialog.Close>
                <button type="submit" className="tool-button">
                  <Upload size={15} />
                  <span>{copy.stash}</span>
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

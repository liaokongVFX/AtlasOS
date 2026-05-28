export type GitChangeArea = 'staged' | 'unstaged' | 'untracked' | 'conflicted'

export type GitFileStatus =
  | 'added'
  | 'copied'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'typechange'
  | 'untracked'
  | 'conflicted'

export type GitChangedFile = {
  path: string
  oldPath?: string
  area: GitChangeArea
  status: GitFileStatus
  indexStatus: string
  worktreeStatus: string
}

export type GitStatusSnapshot = {
  repoPath: string
  headOid: string | null
  currentBranch: string | null
  upstream: string | null
  ahead: number
  behind: number
  stashCount: number
  isClean: boolean
  hasConflicts: boolean
  files: GitChangedFile[]
}

export type GitBranchSummary = {
  name: string
  fullName: string
  current: boolean
  remote: boolean
  upstream: string | null
  headOid: string
  lastCommitDate: string | null
  lastCommitSubject: string
}

export type GitCommitFile = {
  path: string
  oldPath?: string
  status: GitFileStatus
}

export type GitCommitSummary = {
  hash: string
  shortHash: string
  parents: string[]
  authorName: string
  authorEmail: string
  authoredAt: string
  refs: string[]
  subject: string
  body?: string
  files?: GitCommitFile[]
}

export type GitStashEntry = {
  ref: string
  hash: string
  message: string
}

export type GitDiffTarget =
  | {
      kind: 'worktree'
      filePath?: string
    }
  | {
      kind: 'staged'
      filePath?: string
    }
  | {
      kind: 'commit'
      commitHash: string
      filePath?: string
      oldPath?: string
    }

export type GitDiffResult = {
  repoPath: string
  target: GitDiffTarget
  diff: string
  binary: boolean
  truncated: boolean
}

export type GitSummary = {
  repoPath: string
  status: GitStatusSnapshot
  branches: GitBranchSummary[]
  commits: GitCommitSummary[]
  stashes: GitStashEntry[]
}

export type GitOperationResult = {
  ok: true
  message: string
  status: GitStatusSnapshot
}

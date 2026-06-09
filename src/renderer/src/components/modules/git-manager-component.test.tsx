import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import type { GitSummary } from '@shared/git'
import { I18nProvider } from '../../i18n'
import { GitManagerComponent } from './git-manager-component'

const gitApi = vi.hoisted(() => ({
  applyStash: vi.fn(),
  branches: vi.fn(),
  chooseRepository: vi.fn(),
  commit: vi.fn(),
  commitDetail: vi.fn(),
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
  diff: vi.fn(),
  dropStash: vi.fn(),
  fetch: vi.fn(),
  log: vi.fn(),
  popStash: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  pushStash: vi.fn(),
  stage: vi.fn(),
  stashes: vi.fn(),
  status: vi.fn(),
  summary: vi.fn(),
  switchBranch: vi.fn(),
  unstage: vi.fn()
}))

const diffText = [
  'diff --git a/README.md b/README.md',
  'index ce01362..b37e70a 100644',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1,2 @@',
  ' hello',
  '+changed'
].join('\n')

function createSummary(): GitSummary {
  return {
    repoPath: 'D:\\repo',
    status: {
      repoPath: 'D:\\repo',
      headOid: 'abcdef123456',
      currentBranch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: 0,
      stashCount: 1,
      isClean: false,
      hasConflicts: false,
      files: [
        {
          path: 'README.md',
          area: 'unstaged',
          status: 'modified',
          indexStatus: '.',
          worktreeStatus: 'M'
        }
      ]
    },
    branches: [
      {
        name: 'main',
        fullName: 'refs/heads/main',
        current: true,
        remote: false,
        upstream: 'origin/main',
        headOid: 'abcdef123456',
        lastCommitDate: '2026-05-28T00:00:00.000Z',
        lastCommitSubject: 'Initial'
      },
      {
        name: 'feature/git',
        fullName: 'refs/heads/feature/git',
        current: false,
        remote: false,
        upstream: null,
        headOid: '123456abcdef',
        lastCommitDate: '2026-05-27T00:00:00.000Z',
        lastCommitSubject: 'Feature'
      }
    ],
    commits: [
      {
        hash: 'abcdef123456',
        shortHash: 'abcdef1',
        parents: [],
        authorName: 'Atlas',
        authorEmail: 'atlas@example.test',
        authoredAt: '2026-05-28T00:00:00.000Z',
        refs: ['HEAD -> main'],
        subject: 'Initial'
      }
    ],
    stashes: [
      {
        ref: 'stash@{0}',
        hash: 'fedcba654321',
        message: 'WIP on main'
      }
    ]
  }
}

function createComponent(repoPath = 'D:\\repo'): CanvasComponent {
  const timestamp = '2026-05-28T00:00:00.000Z'
  return {
    id: 'git-manager-1',
    type: 'git-manager',
    title: 'Git Manager',
    frame: { x: 120, y: 80, width: 980, height: 680 },
    zIndex: 1,
    config: repoPath ? { repoPath } : {},
    state: {},
    bindings: {},
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function renderGitManager(component = createComponent()) {
  const props = {
    updateConfig: vi.fn(),
    updateState: vi.fn(),
    setTitle: vi.fn()
  }

  const view = render(
    <I18nProvider locale="en-US">
      <GitManagerComponent canvasId="canvas-1" component={component} {...props} />
    </I18nProvider>
  )

  return { ...props, ...view }
}

function testRect(left: number, width: number): DOMRect {
  return {
    x: left,
    y: 0,
    left,
    right: left + width,
    top: 0,
    bottom: 600,
    width,
    height: 600,
    toJSON: () => ({})
  } as DOMRect
}

describe('GitManagerComponent', () => {
  beforeEach(() => {
    const summary = createSummary()
    Object.values(gitApi).forEach((fn) => fn.mockReset())
    gitApi.summary.mockResolvedValue(summary)
    gitApi.status.mockResolvedValue(summary.status)
    gitApi.branches.mockResolvedValue(summary.branches)
    gitApi.log.mockResolvedValue(summary.commits)
    gitApi.stashes.mockResolvedValue(summary.stashes)
    gitApi.diff.mockResolvedValue({
      repoPath: 'D:\\repo',
      target: { kind: 'worktree', filePath: 'README.md' },
      diff: diffText,
      binary: false,
      truncated: false
    })
    gitApi.commitDetail.mockResolvedValue({
      ...summary.commits[0],
      body: 'Initial body',
      files: [{ path: 'README.md', status: 'modified' }]
    })
    gitApi.commit.mockResolvedValue({ ok: true, message: 'committed', status: summary.status })
    gitApi.fetch.mockResolvedValue({ ok: true, message: 'fetched', status: summary.status })
    gitApi.stage.mockResolvedValue({ ok: true, message: 'staged', status: summary.status })
    gitApi.switchBranch.mockResolvedValue({ ok: true, message: 'switched', status: summary.status })
    gitApi.chooseRepository.mockResolvedValue('D:\\repo')

    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: {
        git: gitApi
      }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('binds an empty node to a selected repository', async () => {
    const props = renderGitManager(createComponent(''))

    expect(screen.getByText('Choose a local Git repository to inspect status, branches, commits, and diffs.')).toBeVisible()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose repository' }))
    })

    await waitFor(() => {
      expect(gitApi.chooseRepository).toHaveBeenCalledWith('Bind Git repository')
      expect(props.updateConfig).toHaveBeenCalledWith({ repoPath: 'D:\\repo' }, true)
    })
  })

  it('renders status groups, loads a diff, and stages a changed file', async () => {
    renderGitManager()

    expect(await screen.findByRole('button', { name: /README\.md/ })).toBeVisible()
    await waitFor(() => expect(gitApi.diff).toHaveBeenCalledWith('D:\\repo', { kind: 'worktree', filePath: 'README.md' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stage' }))
    })

    await waitFor(() => {
      expect(gitApi.stage).toHaveBeenCalledWith('D:\\repo', ['README.md'])
    })
  })

  it('selects multiple changed files and commits only the selected paths', async () => {
    const summary = createSummary()
    summary.status.files = [
      {
        path: 'README.md',
        area: 'unstaged',
        status: 'modified',
        indexStatus: '.',
        worktreeStatus: 'M'
      },
      {
        path: 'notes.txt',
        area: 'untracked',
        status: 'untracked',
        indexStatus: '?',
        worktreeStatus: '?'
      },
      {
        path: 'staged-only.ts',
        area: 'staged',
        status: 'added',
        indexStatus: 'A',
        worktreeStatus: '.'
      }
    ]
    gitApi.summary.mockResolvedValue(summary)
    gitApi.commit.mockResolvedValue({ ok: true, message: 'committed', status: summary.status })
    renderGitManager()

    expect(await screen.findByRole('button', { name: /README\.md/ })).toBeVisible()

    await act(async () => {
      fireEvent.click(screen.getByLabelText('README.md'))
      fireEvent.click(screen.getByLabelText('notes.txt'))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Commit selected' }))
    })

    const dialog = screen.getByRole('dialog')
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText('Commit message'), { target: { value: 'selected commit' } })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Commit selected' }))
    })

    await waitFor(() => {
      expect(gitApi.commit).toHaveBeenCalledWith('D:\\repo', 'selected commit', ['README.md', 'notes.txt'])
    })
  })

  it('clears the selected change detail after committing selected files', async () => {
    const summary = createSummary()
    const cleanStatus = { ...summary.status, files: [], isClean: true, ahead: 2 }
    gitApi.commit.mockResolvedValue({ ok: true, message: 'committed', status: cleanStatus })
    const view = renderGitManager()

    expect(await screen.findByRole('button', { name: /README\.md/ })).toBeVisible()
    const detail = view.container.querySelector('.git-manager-detail')
    expect(detail).not.toBeNull()
    expect(within(detail as HTMLElement).getAllByText('README.md').length).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.click(screen.getByLabelText('README.md'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Commit selected' }))
    })

    const dialog = screen.getByRole('dialog')
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText('Commit message'), { target: { value: 'selected commit' } })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Commit selected' }))
    })

    await waitFor(() => {
      expect(gitApi.commit).toHaveBeenCalledWith('D:\\repo', 'selected commit', ['README.md'])
      expect(screen.getByText('No file changes')).toBeVisible()
      expect(within(detail as HTMLElement).queryByText('README.md')).toBeNull()
      expect(within(detail as HTMLElement).getAllByText('No diff to display').length).toBeGreaterThan(0)
    })
  })

  it('opens error details from the error banner and dismisses it', async () => {
    gitApi.fetch.mockRejectedValue(new Error('There is no tracking information for the current branch.'))
    renderGitManager()

    expect(await screen.findByRole('button', { name: /README\.md/ })).toBeVisible()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('There is no tracking information')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    })

    const dialog = screen.getByRole('dialog', { name: 'Error details' })
    expect(within(dialog).getByText('There is no tracking information for the current branch.')).toBeVisible()

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }))
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Error details' })).toBeNull())

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('opens commit details and switches between split and unified diff modes', async () => {
    const props = renderGitManager()

    await act(async () => {
      fireEvent.click(await screen.findByRole('tab', { name: 'Log' }))
    })
    await act(async () => {
      fireEvent.click(await screen.findByText('Initial'))
    })

    await waitFor(() => {
      expect(gitApi.commitDetail).toHaveBeenCalledWith('D:\\repo', 'abcdef123456')
      expect(gitApi.diff).toHaveBeenCalledWith('D:\\repo', {
        kind: 'commit',
        commitHash: 'abcdef123456',
        filePath: 'README.md',
        oldPath: undefined
      })
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unified' }))
    })

    expect(props.updateState).toHaveBeenCalledWith({ diffMode: 'unified' }, false)
  })

  it('resizes the log sidebar and commit file rail with splitters', async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('git-manager-main')) return testRect(0, 1200)
      if (this.classList.contains('git-manager-detail__content')) return testRect(400, 800)
      return testRect(0, 300)
    })
    const props = renderGitManager()

    try {
      await act(async () => {
        fireEvent.click(await screen.findByRole('tab', { name: 'Log' }))
      })
      await act(async () => {
        fireEvent.click(await screen.findByText('Initial'))
      })

      await waitFor(() => {
        expect(gitApi.commitDetail).toHaveBeenCalledWith('D:\\repo', 'abcdef123456')
      })

      const logSplitter = screen.getByRole('separator', { name: 'Resize log list' })
      await act(async () => {
        fireEvent.pointerDown(logSplitter, { pointerId: 1, clientX: 320 })
        fireEvent.pointerMove(logSplitter, { pointerId: 1, clientX: 360 })
        fireEvent.pointerUp(logSplitter, { pointerId: 1, clientX: 360 })
      })

      const fileSplitter = screen.getByRole('separator', { name: 'Resize file list' })
      await act(async () => {
        fireEvent.pointerDown(fileSplitter, { pointerId: 2, clientX: 900 })
        fireEvent.pointerMove(fileSplitter, { pointerId: 2, clientX: 860 })
        fireEvent.pointerUp(fileSplitter, { pointerId: 2, clientX: 860 })
      })

      expect(props.updateState).toHaveBeenCalledWith({ sidebarWidth: 360 }, false)
      expect(props.updateState).toHaveBeenCalledWith({ fileRailWidth: 340 }, false)
    } finally {
      rectSpy.mockRestore()
    }
  })

  it('confirms a branch switch before running it', async () => {
    renderGitManager()

    await act(async () => {
      fireEvent.click(await screen.findByRole('tab', { name: 'Branches' }))
    })

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Switch branch' })[0])
    })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Switch branch' }).at(-1)!)
    })

    await waitFor(() => {
      expect(gitApi.switchBranch).toHaveBeenCalledWith('D:\\repo', 'feature/git', false)
    })
  })
})

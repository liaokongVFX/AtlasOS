import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitService, parseGitLog, parseGitStatus } from './git-service'

const execFileAsync = promisify(execFile)

const electronMocks = vi.hoisted(() => ({
  ipcHandle: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn()
  },
  ipcMain: {
    handle: electronMocks.ipcHandle
  }
}))

const testRoot = join(process.cwd(), '.atlasos-dev', 'git-service-test')

async function hasGit(): Promise<boolean> {
  try {
    await execFileAsync('git', ['--version'])
    return true
  } catch {
    return false
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

async function createRepo(): Promise<string | null> {
  if (!(await hasGit())) return null

  await rm(testRoot, { recursive: true, force: true })
  await mkdir(testRoot, { recursive: true })
  await git(testRoot, ['init'])
  await git(testRoot, ['config', 'user.email', 'atlas@example.test'])
  await git(testRoot, ['config', 'user.name', 'Atlas'])
  await writeFile(join(testRoot, 'README.md'), 'hello\n')
  await git(testRoot, ['add', 'README.md'])
  await git(testRoot, ['commit', '-m', 'initial commit'])
  return testRoot
}

describe('GitService parsers', () => {
  it('parses porcelain v2 status with branch metadata, staged changes, untracked files, renames, and conflicts', () => {
    const output = [
      '# branch.oid abc123',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +1 -2',
      '# stash 3',
      '1 .M N... 100644 100644 100644 abc def src/app.ts',
      '? notes.txt',
      '2 R. N... 100644 100644 100644 abc def R100 src/new.ts',
      'src/old.ts',
      'u UU N... 100644 100644 100644 100644 a b c src/conflict.ts',
      ''
    ].join('\0')

    const status = parseGitStatus('/repo', output)

    expect(status).toMatchObject({
      repoPath: '/repo',
      headOid: 'abc123',
      currentBranch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: 2,
      stashCount: 3,
      isClean: false,
      hasConflicts: true
    })
    expect(status.files).toEqual([
      expect.objectContaining({ path: 'src/app.ts', area: 'unstaged', status: 'modified' }),
      expect.objectContaining({ path: 'notes.txt', area: 'untracked', status: 'untracked' }),
      expect.objectContaining({ path: 'src/new.ts', oldPath: 'src/old.ts', area: 'staged', status: 'renamed' }),
      expect.objectContaining({ path: 'src/conflict.ts', area: 'conflicted', status: 'conflicted' })
    ])
  })

  it('parses record-separated commit logs', () => {
    const output = [
      '',
      'abcdef123456\x1fabcdef1\x1fparent1 parent2\x1fAda\x1fada@example.test\x1f2026-05-28T00:00:00.000Z\x1fHEAD -> main, origin/main\x1fShip git manager',
      '123456abcdef\x1f123456a\x1f\x1fLinus\x1flinus@example.test\x1f2026-05-27T00:00:00.000Z\x1f\x1fInitial'
    ].join('\x1e')

    expect(parseGitLog(output)).toEqual([
      {
        hash: 'abcdef123456',
        shortHash: 'abcdef1',
        parents: ['parent1', 'parent2'],
        authorName: 'Ada',
        authorEmail: 'ada@example.test',
        authoredAt: '2026-05-28T00:00:00.000Z',
        refs: ['HEAD -> main', 'origin/main'],
        subject: 'Ship git manager'
      },
      expect.objectContaining({
        hash: '123456abcdef',
        parents: [],
        subject: 'Initial'
      })
    ])
  })
})

describe('GitService', () => {
  beforeEach(() => {
    electronMocks.ipcHandle.mockClear()
  })

  it('registers the Git IPC channels', () => {
    new GitService().registerIpc()

    expect(electronMocks.ipcHandle).toHaveBeenCalledWith('git:summary', expect.any(Function))
    expect(electronMocks.ipcHandle).toHaveBeenCalledWith('git:diff', expect.any(Function))
    expect(electronMocks.ipcHandle).toHaveBeenCalledWith('git:branch-switch', expect.any(Function))
    expect(electronMocks.ipcHandle).toHaveBeenCalledWith('git:stash-pop', expect.any(Function))
  })

  it('reads and mutates a real repository through whitelisted operations', async () => {
    const repoPath = await createRepo()
    if (!repoPath) return

    const service = new GitService()

    await writeFile(join(repoPath, 'README.md'), 'hello\nchanged\n')
    await writeFile(join(repoPath, 'notes.txt'), 'new note\n')

    const dirtyStatus = await service.getStatus(repoPath)
    expect(dirtyStatus.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'README.md', area: 'unstaged', status: 'modified' }),
        expect.objectContaining({ path: 'notes.txt', area: 'untracked', status: 'untracked' })
      ])
    )

    await service.stage(repoPath, ['notes.txt'])
    const stagedStatus = await service.getStatus(repoPath)
    expect(stagedStatus.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'notes.txt', area: 'staged', status: 'added' })]))

    await service.commit(repoPath, 'add notes')
    const commits = await service.getLog(repoPath)
    expect(commits[0]?.subject).toBe('add notes')

    await writeFile(join(repoPath, 'extra.txt'), 'extra\n')
    await service.stage(repoPath, ['extra.txt'])
    await service.commit(repoPath, 'commit selected readme', ['README.md'])
    expect((await git(repoPath, ['show', '--name-only', '--format=', 'HEAD'])).trim()).toBe('README.md')
    expect((await service.getStatus(repoPath)).files).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'extra.txt', area: 'staged', status: 'added' })]))
    await service.commit(repoPath, 'add extra')

    await service.createBranch(repoPath, 'feature/git-manager')
    await service.switchBranch(repoPath, 'feature/git-manager')
    expect((await service.getStatus(repoPath)).currentBranch).toBe('feature/git-manager')
    await service.switchBranch(repoPath, 'main').catch(async () => {
      await service.switchBranch(repoPath, 'master')
    })
    await service.deleteBranch(repoPath, 'feature/git-manager')

    await writeFile(join(repoPath, 'stash.txt'), 'stash me\n')
    await service.pushStash(repoPath, 'test stash')
    const stashes = await service.getStashes(repoPath)
    expect(stashes[0]?.ref).toBe('stash@{0}')
    await service.applyStash(repoPath, 'stash@{0}')
    await service.dropStash(repoPath, 'stash@{0}')
    await expect(service.stage(repoPath, ['..\\outside.txt'])).rejects.toThrow('Path is outside the selected root')
  }, 60_000)
})

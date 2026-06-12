import { describe, expect, it } from 'vitest'
import {
  createDefaultTerminalCommandLibrary,
  createTerminalCommand,
  createTerminalCommandCategory,
  deleteTerminalCommandCategory,
  moveTerminalCommand,
  moveTerminalCommandCategory,
  normalizeTerminalCommandLibrary
} from './terminal-commands'

const TIMESTAMP = '2026-06-13T00:00:00.000Z'

describe('terminal command library', () => {
  it('normalizes invalid references while preserving empty categories', () => {
    const parsed = normalizeTerminalCommandLibrary(
      {
        categories: [
          {
            id: 'work',
            name: 'Work',
            commandIds: ['dev', 'missing'],
            createdAt: TIMESTAMP,
            updatedAt: TIMESTAMP
          },
          {
            id: 'empty',
            name: 'Empty',
            commandIds: [],
            createdAt: TIMESTAMP,
            updatedAt: TIMESTAMP
          }
        ],
        commands: {
          dev: {
            id: 'dev',
            name: 'Dev',
            command: 'npm run dev',
            createdAt: TIMESTAMP,
            updatedAt: TIMESTAMP
          },
          orphan: {
            id: 'orphan',
            name: 'Orphan',
            command: 'npm test',
            createdAt: TIMESTAMP,
            updatedAt: TIMESTAMP
          },
          blank: {
            id: 'blank',
            name: 'Blank',
            command: '   ',
            createdAt: TIMESTAMP,
            updatedAt: TIMESTAMP
          }
        },
        activeCategoryId: 'missing'
      },
      TIMESTAMP
    )

    expect(parsed.categories.map((category) => ({ id: category.id, commandIds: category.commandIds }))).toEqual([
      { id: 'work', commandIds: ['dev'] },
      { id: 'empty', commandIds: [] }
    ])
    expect(Object.keys(parsed.commands)).toEqual(['dev'])
    expect(parsed.activeCategoryId).toBe('work')
  })

  it('deletes commands owned by a removed category', () => {
    let library = createDefaultTerminalCommandLibrary()
    library = createTerminalCommandCategory(library, 'work', { name: 'Work' }, TIMESTAMP)
    library = createTerminalCommand(library, 'work', 'dev', { name: 'Dev', command: 'npm run dev' }, TIMESTAMP)

    const next = deleteTerminalCommandCategory(library, 'work')

    expect(next.categories).toEqual([])
    expect(next.commands).toEqual({})
    expect(next.activeCategoryId).toBe('')
  })

  it('moves categories and commands by target index', () => {
    let library = createDefaultTerminalCommandLibrary()
    library = createTerminalCommandCategory(library, 'one', { name: 'One' }, TIMESTAMP)
    library = createTerminalCommandCategory(library, 'two', { name: 'Two' }, TIMESTAMP)
    library = createTerminalCommand(library, 'one', 'a', { name: 'A', command: 'echo a' }, TIMESTAMP)
    library = createTerminalCommand(library, 'one', 'b', { name: 'B', command: 'echo b' }, TIMESTAMP)

    expect(moveTerminalCommandCategory(library, 'two', 0).categories.map((category) => category.id)).toEqual(['two', 'one'])
    expect(moveTerminalCommand(library, 'one', 'b', 0).categories[0].commandIds).toEqual(['b', 'a'])
  })
})

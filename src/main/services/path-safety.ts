import { basename, isAbsolute, relative, resolve } from 'node:path'

const WINDOWS_FORBIDDEN_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g

export function sanitizeFileName(name: string): string {
  const safeName = basename(name).replace(WINDOWS_FORBIDDEN_NAME_CHARS, '').trim()
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new Error('Invalid file name')
  }
  return safeName
}

export function assertInsideRoot(rootPath: string, targetPath: string): string {
  if (!isAbsolute(rootPath) || !isAbsolute(targetPath)) {
    throw new Error('File operations require absolute paths')
  }

  const root = resolve(rootPath)
  const target = resolve(targetPath)
  const relativePath = relative(root, target)
  const insideRoot = relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))

  if (!insideRoot) {
    throw new Error('Path is outside the selected root')
  }

  return target
}

export function childPath(rootPath: string, parentPath: string, name: string): string {
  const parent = assertInsideRoot(rootPath, parentPath)
  return assertInsideRoot(rootPath, resolve(parent, sanitizeFileName(name)))
}

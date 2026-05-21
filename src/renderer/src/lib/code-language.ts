import { LanguageDescription, type LanguageSupport } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { fileExtension, fileName } from './file-types'

const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  ['.astro', 'HTML'],
  ['.cmd', 'Shell'],
  ['.dockerfile', 'Dockerfile'],
  ['.env', 'Properties files'],
  ['.jsonc', 'JSON'],
  ['.mdx', 'Markdown'],
  ['.svelte', 'HTML'],
  ['.zsh', 'Shell']
])

const LANGUAGE_BY_MIME_TYPE = new Map<string, string>([
  ['application/javascript', 'JavaScript'],
  ['application/json', 'JSON'],
  ['application/ld+json', 'JSON-LD'],
  ['application/typescript', 'TypeScript'],
  ['application/x-httpd-php', 'PHP'],
  ['application/x-javascript', 'JavaScript'],
  ['application/xml', 'XML'],
  ['image/svg+xml', 'XML'],
  ['text/css', 'CSS'],
  ['text/html', 'HTML'],
  ['text/javascript', 'JavaScript'],
  ['text/jsx', 'JSX'],
  ['text/markdown', 'Markdown'],
  ['text/tsx', 'TSX'],
  ['text/typescript', 'TypeScript'],
  ['text/x-python', 'Python'],
  ['text/xml', 'XML'],
  ['text/yaml', 'YAML']
])

function matchLanguageName(name: string): LanguageDescription | null {
  return LanguageDescription.matchLanguageName(languages, name, false)
}

export function codeLanguageDescriptionForFile(pathOrName: string, mimeType?: string): LanguageDescription | null {
  const baseName = fileName(pathOrName)
  const byFilename = LanguageDescription.matchFilename(languages, baseName)
  if (byFilename) return byFilename

  const byExtension = LANGUAGE_BY_EXTENSION.get(fileExtension(baseName))
  if (byExtension) return matchLanguageName(byExtension)

  const byMimeType = mimeType ? LANGUAGE_BY_MIME_TYPE.get(mimeType.trim().toLowerCase()) : null
  if (byMimeType) return matchLanguageName(byMimeType)

  return null
}

export async function loadCodeLanguageForFile(pathOrName: string, mimeType?: string): Promise<LanguageSupport | null> {
  return (await codeLanguageDescriptionForFile(pathOrName, mimeType)?.load()) ?? null
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.ico'])
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.ogg', '.avi', '.mkv'])

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.text',
  '.log',
  '.csv',
  '.tsv',
  '.json',
  '.jsonc',
  '.json5',
  '.jsonld',
  '.ndjson',
  '.map',
  '.md',
  '.markdown',
  '.mdx',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.htm',
  '.xml',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.env',
  '.py',
  '.pyw',
  '.bzl',
  '.rb',
  '.r',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.c',
  '.h',
  '.cpp',
  '.cc',
  '.cxx',
  '.hpp',
  '.hh',
  '.hxx',
  '.cs',
  '.php',
  '.phtml',
  '.swift',
  '.dart',
  '.lua',
  '.scala',
  '.clj',
  '.cljs',
  '.erl',
  '.ex',
  '.exs',
  '.fs',
  '.fsx',
  '.vb',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ksh',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.graphql',
  '.gql',
  '.vue',
  '.svelte',
  '.astro',
  '.proto',
  '.diff',
  '.patch',
  '.cmake',
  '.conf',
  '.properties',
  '.tex',
  '.dockerfile',
  '.gitignore',
  '.gitattributes',
  '.editorconfig'
])

const TEXT_FILE_NAMES = new Set([
  'dockerfile',
  'makefile',
  'rakefile',
  'gemfile',
  'cmakelists.txt',
  'license',
  'readme',
  'changelog',
  'authors',
  'contributors'
])

export type FilePreviewKind = 'image' | 'video' | 'text' | 'unsupported'

export function fileExtension(pathOrName: string): string {
  const match = pathOrName.toLowerCase().match(/\.[^.\\/]+$/)
  return match?.[0] ?? ''
}

export function fileName(pathOrName: string): string {
  return pathOrName.split(/[\\/]/).at(-1) ?? pathOrName
}

function normalizedMimeType(mimeType?: string): string {
  return mimeType?.trim().toLowerCase() ?? ''
}

export function isMarkdownFile(pathOrName: string, mimeType?: string): boolean {
  const type = normalizedMimeType(mimeType)
  return MARKDOWN_EXTENSIONS.has(fileExtension(pathOrName)) || type === 'text/markdown'
}

export function getFilePreviewKind(pathOrName: string, mimeType?: string): FilePreviewKind {
  const type = normalizedMimeType(mimeType)
  const ext = fileExtension(pathOrName)
  const baseName = fileName(pathOrName).toLowerCase()

  if (type.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (type.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (type.startsWith('text/') || TEXT_EXTENSIONS.has(ext) || TEXT_FILE_NAMES.has(baseName)) return 'text'

  return 'unsupported'
}

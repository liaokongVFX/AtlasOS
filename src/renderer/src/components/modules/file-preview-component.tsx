import { FileWarning, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { asString, fileUrl } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.yml', '.yaml', '.toml'])

function extension(path: string): string {
  const match = path.toLowerCase().match(/\.[^.\\/]+$/)
  return match?.[0] ?? ''
}

export function FilePreviewComponent({ component, updateState }: AtlasComponentRendererProps): JSX.Element {
  const rootPath = asString(component.bindings.rootPath)
  const path = asString(component.bindings.path)
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ext = useMemo(() => extension(path), [path])

  const load = useCallback(async () => {
    if (!rootPath || !path || IMAGE_EXTENSIONS.has(ext)) return
    try {
      const text = (await window.atlas.filesystem.readFile(rootPath, path)) as string
      setContent(text)
      setError(null)
      updateState({ status: 'live' }, false)
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : 'Failed to read file')
      updateState({ status: 'missing' }, true)
    }
  }, [ext, path, rootPath, updateState])

  useEffect(() => {
    void load()
  }, [load])

  if (!path) {
    return (
      <div className="empty-module">
        <FileWarning size={28} />
        <span>No file bound</span>
      </div>
    )
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    return (
      <div className="file-preview-module">
        <img src={fileUrl(path)} alt={path} />
      </div>
    )
  }

  if (!TEXT_EXTENSIONS.has(ext)) {
    return (
      <div className="empty-module">
        <FileWarning size={28} />
        <span>Preview is not available for this file type.</span>
      </div>
    )
  }

  return (
    <div className="file-preview-module">
      <div className="file-preview-toolbar">
        <span>{path}</span>
        <button className="icon-button" onClick={() => void load()} title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>
      {error ? <div className="module-error">{error}</div> : <pre>{content}</pre>}
    </div>
  )
}

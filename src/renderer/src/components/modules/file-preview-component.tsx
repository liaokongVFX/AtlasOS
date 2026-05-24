import type { Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import CodeMirror from '@uiw/react-codemirror'
import { FileWarning, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { localAssetUrl } from '@shared/local-assets'
import { useI18n } from '../../i18n'
import { codeLanguageDescriptionForFile, loadCodeLanguageForFile } from '../../lib/code-language'
import { getFilePreviewKind } from '../../lib/file-types'
import {
  fitMediaFrameToAspectRatio,
  mediaAspectRatioFromConfig,
  mediaAspectRatioFromDimensions,
  mediaAspectRatiosEqual,
  type MediaDimensions
} from '../../lib/media-frame'
import { asString } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'

const MAX_HIGHLIGHTED_TEXT_LENGTH = 1_500_000

export function FilePreviewComponent({
  component,
  updateConfig,
  updateFrame = () => undefined,
  updateState
}: AtlasComponentRendererProps): JSX.Element {
  const { t } = useI18n()
  const configuredRootPath = asString(component.bindings.rootPath)
  const path = asString(component.bindings.path)
  const rootPath = configuredRootPath || path
  const mimeType = asString(component.config.mimeType)
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [languageExtension, setLanguageExtension] = useState<Extension | null>(null)
  const previewKind = useMemo(() => getFilePreviewKind(path, mimeType), [mimeType, path])
  const mediaSrc = useMemo(() => (rootPath && path ? localAssetUrl(rootPath, path) : ''), [path, rootPath])
  const configuredMediaAspectRatio = useMemo(() => mediaAspectRatioFromConfig(component.config), [component.config])
  const languageDescription = useMemo(
    () => (previewKind === 'text' ? codeLanguageDescriptionForFile(path, mimeType) : null),
    [mimeType, path, previewKind]
  )
  const editorExtensions = useMemo(() => (languageExtension ? [languageExtension] : []), [languageExtension])

  const load = useCallback(async () => {
    if (!rootPath || !path || previewKind !== 'text') return
    try {
      const text = (await window.atlas.filesystem.readFile(rootPath, path)) as string
      setContent(text)
      setError(null)
      updateState({ status: 'live' }, false)
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : t('filePreview.failedRead'))
      updateState({ status: 'missing' }, true)
    }
  }, [path, previewKind, rootPath, t, updateState])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setMediaError(null)
  }, [mediaSrc, previewKind])

  useEffect(() => {
    let cancelled = false

    setLanguageExtension(null)

    if (!path || previewKind !== 'text' || content.length > MAX_HIGHLIGHTED_TEXT_LENGTH) return

    void loadCodeLanguageForFile(path, mimeType)
      .then((language) => {
        if (!cancelled) setLanguageExtension(language?.extension ?? null)
      })
      .catch(() => {
        if (!cancelled) setLanguageExtension(null)
      })

    return () => {
      cancelled = true
    }
  }, [content.length, mimeType, path, previewKind])

  const rememberMediaDimensions = useCallback(
    (dimensions: MediaDimensions) => {
      const aspectRatio = mediaAspectRatioFromDimensions(dimensions)
      updateState({ status: 'live' }, false)

      if (!aspectRatio) return

      if (!mediaAspectRatiosEqual(configuredMediaAspectRatio, aspectRatio)) {
        updateConfig(
          {
            mediaAspectRatio: aspectRatio,
            mediaWidth: Math.round(dimensions.width),
            mediaHeight: Math.round(dimensions.height)
          },
          false
        )
      }

      if (!configuredMediaAspectRatio) {
        updateFrame(fitMediaFrameToAspectRatio(component.frame, aspectRatio), false)
      }
    },
    [component.frame, configuredMediaAspectRatio, updateConfig, updateFrame, updateState]
  )

  if (!path) {
    return (
      <div className="empty-module">
        <FileWarning size={28} />
        <span>{t('filePreview.noFileBound')}</span>
      </div>
    )
  }

  if (previewKind === 'image') {
    return (
      <div className="file-preview-module file-preview-module--media">
        {mediaError ? (
          <div className="module-error">{mediaError}</div>
        ) : (
          <img
            src={mediaSrc}
            alt={path}
            onLoad={(event) => {
              rememberMediaDimensions({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight
              })
            }}
            onError={() => {
              setMediaError(t('filePreview.failedImagePreview'))
              updateState({ status: 'missing' }, true)
            }}
          />
        )}
      </div>
    )
  }

  if (previewKind === 'video') {
    return (
      <div className="file-preview-module file-preview-module--media">
        {mediaError ? (
          <div className="module-error">{mediaError}</div>
        ) : (
          <video
            src={mediaSrc}
            controls
            preload="metadata"
            playsInline
            onLoadedMetadata={(event) => {
              rememberMediaDimensions({
                width: event.currentTarget.videoWidth,
                height: event.currentTarget.videoHeight
              })
            }}
            onError={() => {
              setMediaError(t('filePreview.failedVideoPreview'))
              updateState({ status: 'missing' }, true)
            }}
          />
        )}
      </div>
    )
  }

  if (previewKind !== 'text') {
    return (
      <div className="empty-module">
        <FileWarning size={28} />
        <span>{t('filePreview.unsupported')}</span>
      </div>
    )
  }

  return (
    <div className="file-preview-module">
      <div className="file-preview-toolbar">
        <div className="file-preview-toolbar__title">
          <span>{path}</span>
          {languageDescription && content.length <= MAX_HIGHLIGHTED_TEXT_LENGTH ? <strong>{languageDescription.name}</strong> : null}
        </div>
        <button className="icon-button" onClick={() => void load()} title={t('filePreview.refresh')} aria-label={t('filePreview.refresh')}>
          <RefreshCw size={14} />
        </button>
      </div>
      {error ? (
        <div className="module-error">{error}</div>
      ) : (
        <CodeMirror
          className="file-preview-code"
          value={content}
          height="100%"
          theme={oneDark}
          editable={false}
          readOnly
          extensions={editorExtensions}
          basicSetup={{
            autocompletion: false,
            closeBrackets: false,
            foldGutter: true,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
            searchKeymap: true
          }}
        />
      )}
    </div>
  )
}

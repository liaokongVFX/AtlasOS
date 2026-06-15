import type { Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import CodeMirror from '@uiw/react-codemirror'
import { FileWarning, RefreshCw, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
const FILE_PREVIEW_CODE_BASIC_SETUP = {
  autocompletion: false,
  closeBrackets: false,
  foldGutter: true,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  searchKeymap: true
}

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
  const [lastSavedContent, setLastSavedContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [languageExtension, setLanguageExtension] = useState<Extension | null>(null)
  const saveInFlightRef = useRef(false)
  const previewKind = useMemo(() => getFilePreviewKind(path, mimeType), [mimeType, path])
  const mediaSrc = useMemo(() => (rootPath && path ? localAssetUrl(rootPath, path) : ''), [path, rootPath])
  const configuredMediaAspectRatio = useMemo(() => mediaAspectRatioFromConfig(component.config), [component.config])
  const languageDescription = useMemo(
    () => (previewKind === 'text' ? codeLanguageDescriptionForFile(path, mimeType) : null),
    [mimeType, path, previewKind]
  )
  const editorExtensions = useMemo(() => (languageExtension ? [languageExtension] : []), [languageExtension])
  const isDirty = content !== lastSavedContent

  const load = useCallback(async () => {
    if (!rootPath || !path || previewKind !== 'text') return
    try {
      const text = (await window.atlas.filesystem.readFile(rootPath, path)) as string
      setContent(text)
      setLastSavedContent(text)
      setError(null)
      setSaveError(null)
      updateState({ status: 'live' }, false)
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : t('filePreview.failedRead'))
      updateState({ status: 'missing' }, true)
    }
  }, [path, previewKind, rootPath, t, updateState])

  const save = useCallback(
    async (nextContent = content) => {
      if (!rootPath || !path || previewKind !== 'text' || nextContent === lastSavedContent) return
      if (saveInFlightRef.current) return

      saveInFlightRef.current = true
      setIsSaving(true)
      try {
        await window.atlas.filesystem.writeFile(rootPath, path, nextContent)
        setLastSavedContent(nextContent)
        setSaveError(null)
        updateState({ status: 'live' }, false)
      } catch (writeError) {
        setSaveError(writeError instanceof Error ? writeError.message : t('filePreview.failedWrite'))
      } finally {
        saveInFlightRef.current = false
        setIsSaving(false)
      }
    },
    [content, lastSavedContent, path, previewKind, rootPath, t, updateState]
  )

  const updateContent = useCallback((value: string) => {
    setContent(value)
    setSaveError(null)
  }, [])

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
            draggable={false}
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
        <div className="file-preview-toolbar__actions">
          <button className="icon-button" onClick={() => void load()} title={t('filePreview.refresh')} aria-label={t('filePreview.refresh')}>
            <RefreshCw size={14} />
          </button>
          <button className="icon-button" onClick={() => void save()} title={t('common.save')} aria-label={t('common.save')} disabled={!isDirty || isSaving}>
            <Save size={14} />
          </button>
        </div>
      </div>
      {error ? (
        <div className="module-error">{error}</div>
      ) : (
        <>
          {saveError ? <div className="module-error">{saveError}</div> : null}
          <CodeMirror
            className="file-preview-code"
            value={content}
            height="100%"
            theme={oneDark}
            extensions={editorExtensions}
            basicSetup={FILE_PREVIEW_CODE_BASIC_SETUP}
            onChange={updateContent}
            onBlur={() => void save()}
          />
        </>
      )}
    </div>
  )
}

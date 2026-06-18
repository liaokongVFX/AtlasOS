import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CircleAlert, Download, Loader2, PackageOpen, RefreshCcw, RotateCw, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AtlasUpdateState } from '@shared/updates'
import { useI18n, type I18nKey } from './i18n'

const HTML_RELEASE_NOTE_PATTERN =
  /<\/?(?:a|b|blockquote|br|code|del|div|em|h[1-6]|hr|i|img|li|ol|p|pre|s|span|strong|table|tbody|td|th|thead|tr|ul)(?:\s|>|\/)/i
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function safeLinkHref(href: string | null): string | undefined {
  if (!href?.trim()) return undefined

  try {
    const url = new URL(href, 'https://github.com')
    return SAFE_LINK_PROTOCOLS.has(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}

function renderHtmlReleaseNoteNode(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (node.nodeType !== Node.ELEMENT_NODE) return null

  const element = node as Element
  const tag = element.tagName.toLowerCase()
  const children = Array.from(element.childNodes).map((child, index) => renderHtmlReleaseNoteNode(child, `${key}.${index}`))

  switch (tag) {
    case 'a': {
      const href = safeLinkHref(element.getAttribute('href'))
      return href ? (
        <a key={key} href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      ) : (
        <Fragment key={key}>{children}</Fragment>
      )
    }
    case 'blockquote':
      return <blockquote key={key}>{children}</blockquote>
    case 'br':
      return <br key={key} />
    case 'b':
      return <strong key={key}>{children}</strong>
    case 'code':
      return <code key={key}>{children}</code>
    case 'p':
      return <p key={key}>{children}</p>
    case 'del':
    case 's':
      return <del key={key}>{children}</del>
    case 'div':
      return <Fragment key={key}>{children}</Fragment>
    case 'em':
      return <em key={key}>{children}</em>
    case 'hr':
      return <hr key={key} />
    case 'i':
      return <em key={key}>{children}</em>
    case 'img': {
      const alt = element.getAttribute('alt')?.trim()
      return alt ? <span key={key}>{alt}</span> : null
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return (
        <p key={key}>
          <strong>{children}</strong>
        </p>
      )
    case 'strong':
      return <strong key={key}>{children}</strong>
    case 'li':
      return <li key={key}>{children}</li>
    case 'ol':
      return <ol key={key}>{children}</ol>
    case 'pre':
      return <pre key={key}>{children}</pre>
    case 'script':
    case 'style':
      return null
    case 'span':
      return <Fragment key={key}>{children}</Fragment>
    case 'table':
      return <table key={key}>{children}</table>
    case 'tbody':
      return <tbody key={key}>{children}</tbody>
    case 'td':
      return <td key={key}>{children}</td>
    case 'th':
      return <th key={key}>{children}</th>
    case 'thead':
      return <thead key={key}>{children}</thead>
    case 'tr':
      return <tr key={key}>{children}</tr>
    case 'ul':
      return <ul key={key}>{children}</ul>
    default:
      return <Fragment key={key}>{children}</Fragment>
  }
}

function ReleaseNotesContent({ notes }: { notes: string }): JSX.Element {
  const trimmed = notes.trim()
  const htmlContent = useMemo(() => {
    if (!HTML_RELEASE_NOTE_PATTERN.test(trimmed)) return null
    const parsed = new DOMParser().parseFromString(trimmed, 'text/html')
    return Array.from(parsed.body.childNodes).map((node, index) => renderHtmlReleaseNoteNode(node, String(index)))
  }, [trimmed])

  if (htmlContent) return <>{htmlContent}</>

  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{trimmed}</ReactMarkdown>
}

function statusTitleKey(state: AtlasUpdateState | null): I18nKey {
  if (!state) return 'update.checkingTitle'

  switch (state.status) {
    case 'available':
      return 'update.availableTitle'
    case 'downloaded':
      return 'update.downloadedTitle'
    case 'downloading':
      return 'update.downloadingTitle'
    case 'error':
      return 'update.errorTitle'
    case 'not-available':
      return 'update.upToDate'
    default:
      return 'update.checkingTitle'
  }
}

function statusBodyKey(state: AtlasUpdateState | null): I18nKey {
  if (!state) return 'update.checkingBody'

  switch (state.status) {
    case 'available':
      return 'update.availableBody'
    case 'downloaded':
      return 'update.downloadedBody'
    case 'downloading':
      return 'update.downloadingBody'
    case 'error':
      return 'update.errorBody'
    case 'not-available':
      return 'update.upToDate'
    default:
      return 'update.checkingBody'
  }
}

function UpdateIcon({ status }: { status: AtlasUpdateState['status'] | 'loading' }): JSX.Element {
  if (status === 'available') return <Download size={20} aria-hidden="true" />
  if (status === 'downloaded') return <PackageOpen size={20} aria-hidden="true" />
  if (status === 'error') return <CircleAlert size={20} aria-hidden="true" />
  return <Loader2 size={20} aria-hidden="true" className="update-window__spin" />
}

export function UpdateApp(): JSX.Element {
  const { t } = useI18n()
  const [state, setState] = useState<AtlasUpdateState | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const progress = state?.progress
  const percent = Math.round(progress?.percent ?? 0)
  const availableVersion = state?.availableVersion ?? state?.currentVersion ?? ''
  const body = t(statusBodyKey(state), { version: availableVersion })
  const releaseNotes = useMemo(() => state?.releaseNotes?.trim() || t('update.noNotes'), [state?.releaseNotes, t])

  const closeWindow = (): void => {
    void window.atlas.updates.dismissWindow()
    window.close()
  }

  useEffect(() => {
    let active = true

    void window.atlas.updates.getState().then((nextState) => {
      if (active) setState(nextState)
    })

    const dispose = window.atlas.updates.onStateUpdated((nextState) => {
      setState(nextState)
      setActionPending(false)
    })

    return () => {
      active = false
      dispose()
    }
  }, [])

  const download = async (): Promise<void> => {
    setActionPending(true)
    try {
      setState(await window.atlas.updates.download())
    } finally {
      setActionPending(false)
    }
  }

  const retry = async (): Promise<void> => {
    setActionPending(true)
    try {
      setState(await window.atlas.updates.check())
    } finally {
      setActionPending(false)
    }
  }

  const installAndRestart = async (): Promise<void> => {
    setActionPending(true)
    try {
      await window.atlas.updates.installAndRestart()
    } finally {
      setActionPending(false)
    }
  }

  return (
    <main className="update-window" aria-live="polite">
      <div className="update-window__drag-region" aria-hidden="true" />
      <button type="button" className="update-window__close" aria-label={t('update.close')} onClick={closeWindow}>
        <X size={15} aria-hidden="true" />
      </button>

      <section className="update-window__body" aria-labelledby="update-window-title">
        <div className={`update-window__icon update-window__icon--${state?.status ?? 'loading'}`}>
          <UpdateIcon status={state?.status ?? 'loading'} />
        </div>
        <div className="update-window__content">
          <p className="update-window__eyebrow">AtlasOS</p>
          <h1 id="update-window-title">{t(statusTitleKey(state))}</h1>
          <p className="update-window__message">{body}</p>
        </div>
      </section>

      {state?.status === 'downloading' ? (
        <div className="update-window__progress" aria-label={t('update.downloadingTitle')}>
          <div className="update-window__progress-track">
            <div className="update-window__progress-bar" style={{ width: `${percent}%` }} />
          </div>
          <div className="update-window__progress-meta">
            <span>{percent}%</span>
            <span>
              {formatBytes(progress?.transferred ?? 0)} / {formatBytes(progress?.total ?? 0)}
            </span>
            <span>{formatBytes(progress?.bytesPerSecond ?? 0)}/s</span>
          </div>
        </div>
      ) : null}

      {state?.status === 'available' || state?.status === 'downloaded' || state?.status === 'error' ? (
        <div className="update-window__notes">
          <strong className="update-window__notes-version">{state.availableVersion ?? state.currentVersion}</strong>
          <div className="update-window__notes-body">
            {state.status === 'error' ? <p>{state.error ?? t('update.errorBody')}</p> : <ReleaseNotesContent notes={releaseNotes} />}
          </div>
        </div>
      ) : null}

      <div className="update-window__actions">
        {state?.status === 'available' ? (
          <button type="button" className="primary-button" disabled={actionPending} onClick={() => void download()}>
            <Download size={15} aria-hidden="true" />
            <span>{t('update.download')}</span>
          </button>
        ) : null}
        {state?.status === 'downloaded' ? (
          <button type="button" className="primary-button" disabled={actionPending} onClick={() => void installAndRestart()}>
            <RotateCw size={15} aria-hidden="true" />
            <span>{t('update.installAndRestart')}</span>
          </button>
        ) : null}
        {state?.status === 'error' ? (
          <button type="button" className="primary-button" disabled={actionPending} onClick={() => void retry()}>
            <RefreshCcw size={15} aria-hidden="true" />
            <span>{t('update.retry')}</span>
          </button>
        ) : null}
        <button type="button" className="tool-button" onClick={closeWindow}>
          <span>{t('update.later')}</span>
        </button>
      </div>
    </main>
  )
}

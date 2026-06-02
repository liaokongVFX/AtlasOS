import { useEffect, useMemo, useState } from 'react'
import { CircleAlert, Download, Loader2, PackageOpen, RefreshCcw, RotateCw, X } from 'lucide-react'
import type { AtlasUpdateState } from '@shared/updates'
import { useI18n, type I18nKey } from './i18n'

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
      <button type="button" className="update-window__close" aria-label={t('update.close')} onClick={() => window.close()}>
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
          <strong>{state.availableVersion ?? state.currentVersion}</strong>
          <p>{state.status === 'error' ? state.error ?? t('update.errorBody') : releaseNotes}</p>
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
        <button type="button" className="tool-button" onClick={() => window.close()}>
          <span>{t('update.later')}</span>
        </button>
      </div>
    </main>
  )
}

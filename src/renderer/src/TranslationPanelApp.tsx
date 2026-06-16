import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Loader2, RotateCcw, X } from 'lucide-react'
import { isAiAutoTargetLanguage, type AiTranslationRequest } from '@shared/ai'
import { useI18n } from './i18n'
import { writeClipboardText } from './lib/clipboard'

type TranslationStatus = 'idle' | 'loading' | 'ready' | 'error'

export function TranslationPanelApp(): JSX.Element {
  const { t } = useI18n()
  const [request, setRequest] = useState<AiTranslationRequest | null>(null)
  const [status, setStatus] = useState<TranslationStatus>('idle')
  const [translatedText, setTranslatedText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyToastVisible, setCopyToastVisible] = useState(false)
  const activeRequestIdRef = useRef<string | null>(null)
  const autoStartedRequestIdRef = useRef<string | null>(null)
  const copyToastTimerRef = useRef<number | null>(null)
  const targetLanguageLabel =
    request?.targetLanguage && isAiAutoTargetLanguage(request.targetLanguage)
      ? t('translation.targetLanguageAuto')
      : request?.targetLanguage ?? '-'

  const runTranslation = useCallback(async (nextRequest: AiTranslationRequest) => {
    activeRequestIdRef.current = nextRequest.id
    setTranslatedText('')
    setCopied(false)
    setCopyToastVisible(false)
    if (copyToastTimerRef.current !== null) {
      window.clearTimeout(copyToastTimerRef.current)
      copyToastTimerRef.current = null
    }

    if (nextRequest.error) {
      setStatus('error')
      setError(nextRequest.error)
      return
    }

    if (!nextRequest.text.trim()) {
      setStatus('error')
      setError(t('translation.noSelection'))
      return
    }

    setStatus('loading')
    setError(null)

    try {
      const result = await window.atlas.ai.translate({
        text: nextRequest.text,
        profileId: nextRequest.profileId ?? undefined,
        targetLanguage: nextRequest.targetLanguage
      })
      if (activeRequestIdRef.current !== nextRequest.id) return

      setTranslatedText(result.text)
      setStatus('ready')
    } catch (nextError) {
      if (activeRequestIdRef.current !== nextRequest.id) return

      setError(nextError instanceof Error ? nextError.message : String(nextError))
      setStatus('error')
    }
  }, [t])

  const startRequest = useCallback((nextRequest: AiTranslationRequest) => {
    setRequest(nextRequest)
    if (autoStartedRequestIdRef.current === nextRequest.id) return

    autoStartedRequestIdRef.current = nextRequest.id
    void runTranslation(nextRequest)
  }, [runTranslation])

  useEffect(() => {
    const dispose = window.atlas.ai.onTranslationRequest((nextRequest) => {
      startRequest(nextRequest)
    })

    void window.atlas.ai.getActiveTranslationRequest().then((nextRequest) => {
      if (!nextRequest) return
      startRequest(nextRequest)
    })

    return dispose
  }, [startRequest])

  useEffect(() => {
    return () => {
      if (copyToastTimerRef.current !== null) window.clearTimeout(copyToastTimerRef.current)
    }
  }, [])

  const retry = () => {
    if (request) void runTranslation(request)
  }

  const copyTranslation = async () => {
    if (!translatedText) return
    const copiedText = await writeClipboardText(translatedText)
    if (!copiedText) return

    if (copyToastTimerRef.current !== null) window.clearTimeout(copyToastTimerRef.current)
    setCopied(true)
    setCopyToastVisible(true)
    copyToastTimerRef.current = window.setTimeout(() => {
      setCopyToastVisible(false)
      copyToastTimerRef.current = null
    }, 1400)
  }

  return (
    <main className="translation-panel" aria-label={t('translation.panel')}>
      <header className="translation-panel__header">
        <div className="translation-panel__title">
          <h1>{t('translation.panel')}</h1>
          <span className="translation-panel__language">{targetLanguageLabel}</span>
        </div>
        <div className="translation-panel__header-actions">
          <button
            type="button"
            className="icon-button"
            disabled={!request || status === 'loading'}
            title={t('translation.retry')}
            aria-label={t('translation.retry')}
            onClick={retry}
          >
            <RotateCcw size={15} />
          </button>
          <button
            type="button"
            className="icon-button primary"
            disabled={!translatedText || status !== 'ready'}
            title={copied ? t('translation.copied') : t('translation.copy')}
            aria-label={copied ? t('translation.copied') : t('translation.copy')}
            onClick={() => void copyTranslation()}
          >
            <Copy size={15} />
          </button>
          <button type="button" className="icon-button" title={t('common.close')} aria-label={t('common.close')} onClick={() => void window.atlas.ai.closeTranslator()}>
            <X size={16} />
          </button>
        </div>
      </header>

      {copyToastVisible ? (
        <div className="translation-panel__toast" role="status" aria-live="polite">
          {t('translation.copied')}
        </div>
      ) : null}

      <section className="translation-panel__section" aria-label={t('translation.sourceText')}>
        <div className="translation-panel__text translation-panel__text--source">{request?.text || t('translation.noSelection')}</div>
      </section>

      <section className="translation-panel__section translation-panel__section--result" aria-label={t('translation.resultText')}>
        {status === 'loading' ? (
          <div className="translation-panel__state">
            <Loader2 size={16} className="translation-panel__spinner" />
            <span>{t('translation.translating')}</span>
          </div>
        ) : status === 'error' ? (
          <div className="translation-panel__error">{error ?? t('translation.failed')}</div>
        ) : (
          <div className="translation-panel__text">{translatedText || t('translation.waiting')}</div>
        )}
      </section>

    </main>
  )
}

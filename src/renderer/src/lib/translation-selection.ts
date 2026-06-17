export type TranslationSelectionProvider = () => string

const selectionProviders = new Set<TranslationSelectionProvider>()

function selectedInputText(element: Element | null): string {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return ''
  if (element instanceof HTMLInputElement && element.type === 'password') return ''

  const start = element.selectionStart ?? 0
  const end = element.selectionEnd ?? 0
  if (end <= start) return ''

  return element.value.slice(start, end).trim()
}

function selectedProvidedText(): string {
  for (const provider of selectionProviders) {
    const text = provider().trim()
    if (text) return text
  }

  return ''
}

export function registerTranslationSelectionProvider(provider: TranslationSelectionProvider): () => void {
  selectionProviders.add(provider)
  return () => {
    selectionProviders.delete(provider)
  }
}

export function selectedAppText(): string {
  const inputSelection = selectedInputText(document.activeElement)
  if (inputSelection) return inputSelection

  const providerSelection = selectedProvidedText()
  if (providerSelection) return providerSelection

  return window.getSelection()?.toString().trim() ?? ''
}

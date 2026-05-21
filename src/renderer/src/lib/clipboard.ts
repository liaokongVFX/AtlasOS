type ClipboardApi = {
  readText?: () => string | Promise<string>
  writeText?: (text: string) => void | Promise<void>
}

function getClipboardApi(): ClipboardApi | undefined {
  return (window as unknown as { atlas?: { clipboard?: ClipboardApi } }).atlas?.clipboard
}

function copyTextWithTextArea(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false

  const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', 'true')
  textArea.style.position = 'fixed'
  textArea.style.left = '-9999px'
  textArea.style.top = '0'
  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textArea.remove()
    previousActiveElement?.focus({ preventScroll: true })
  }
}

export async function writeClipboardText(text: string): Promise<boolean> {
  const preloadWriteText = getClipboardApi()?.writeText

  if (typeof preloadWriteText === 'function') {
    try {
      await preloadWriteText(text)
      return true
    } catch {
      // Fall through to the legacy selection copy path.
    }
  }

  return copyTextWithTextArea(text)
}

export function readClipboardText(): Promise<string> | undefined {
  const preloadReadText = getClipboardApi()?.readText

  if (typeof preloadReadText === 'function') {
    try {
      return Promise.resolve(preloadReadText())
    } catch {
      return undefined
    }
  }

  return undefined
}

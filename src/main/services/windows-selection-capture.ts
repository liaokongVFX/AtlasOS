import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void
type ExecFileLike = (
  file: string,
  args: string[],
  options: { timeout: number; windowsHide: boolean; maxBuffer: number },
  callback: ExecFileCallback
) => void

type TextClipboard = {
  readText: (type?: 'clipboard') => string
  writeText: (text: string, type?: 'clipboard') => void
}

type CaptureOptions = {
  clipboard: TextClipboard
  copyCommand?: () => Promise<void>
  execFileImpl?: ExecFileLike
  platform?: NodeJS.Platform
  pollIntervalMs?: number
  timeoutMs?: number
}

const COPY_COMMAND_TIMEOUT_MS = 1200
const COPY_CAPTURE_TIMEOUT_MS = 700
const COPY_CAPTURE_POLL_INTERVAL_MS = 35

const SEND_COPY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class AtlasCopyKeys {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

$KEYEVENTF_KEYUP = 0x0002
[AtlasCopyKeys]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
[AtlasCopyKeys]::keybd_event(0x43, 0, 0, [UIntPtr]::Zero)
[AtlasCopyKeys]::keybd_event(0x43, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
[AtlasCopyKeys]::keybd_event(0x11, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
`.trim()

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function execFileAsync(execFileImpl: ExecFileLike, file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFileImpl(
      file,
      args,
      {
        timeout: COPY_COMMAND_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 32 * 1024
      },
      (error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      }
    )
  })
}

async function sendCopyCommand(execFileImpl: ExecFileLike): Promise<void> {
  await execFileAsync(execFileImpl, 'powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    SEND_COPY_SCRIPT
  ])
}

export async function captureWindowsSelectedText({
  clipboard,
  copyCommand,
  execFileImpl = execFile,
  platform = process.platform,
  pollIntervalMs = COPY_CAPTURE_POLL_INTERVAL_MS,
  timeoutMs = COPY_CAPTURE_TIMEOUT_MS
}: CaptureOptions): Promise<string> {
  if (platform !== 'win32') {
    throw new Error('System selection translation is only available on Windows in this version')
  }

  const originalText = clipboard.readText('clipboard')
  const sentinel = `atlas-selection-${randomUUID()}`
  clipboard.writeText(sentinel, 'clipboard')

  try {
    if (copyCommand) {
      await copyCommand()
    } else {
      await sendCopyCommand(execFileImpl)
    }

    const startedAt = Date.now()
    while (Date.now() - startedAt <= timeoutMs) {
      const copiedText = clipboard.readText('clipboard')
      if (copiedText && copiedText !== sentinel) return copiedText
      await wait(pollIntervalMs)
    }

    throw new Error('No selected text was copied')
  } finally {
    clipboard.writeText(originalText, 'clipboard')
  }
}

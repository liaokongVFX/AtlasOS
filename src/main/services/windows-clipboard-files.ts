import { execFile } from 'node:child_process'

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void
type ExecFileLike = (
  file: string,
  args: string[],
  options: { timeout: number; windowsHide: boolean; maxBuffer: number },
  callback: ExecFileCallback
) => void

export type WindowsClipboardFileDropDiagnostic = {
  attempted: boolean
  stdoutLength?: number
  stderrLength?: number
  error?: string
}

export type WindowsClipboardFileDropResult = {
  paths: string[]
  nativeFormats: string[]
  diagnostic: WindowsClipboardFileDropDiagnostic
}

const WINDOWS_CLIPBOARD_TIMEOUT_MS = 1800
const WINDOWS_CLIPBOARD_MAX_BUFFER_BYTES = 128 * 1024

const WINDOWS_FILE_DROP_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms

$paths = New-Object System.Collections.Generic.List[string]

function Add-ClipboardPathText([string] $text) {
  if ([string]::IsNullOrWhiteSpace($text)) {
    return
  }

  foreach ($line in ($text -split '(\r\n|\n|\x00)')) {
    $candidate = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($candidate) -or $candidate.StartsWith('#')) {
      continue
    }

    if ($candidate.StartsWith('file:', [System.StringComparison]::OrdinalIgnoreCase)) {
      try {
        $candidate = ([System.Uri] $candidate).LocalPath
      } catch {
        continue
      }
    }

    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      [void] $paths.Add($candidate)
    }
  }
}

function Add-ClipboardValue([object] $value) {
  if ($null -eq $value) {
    return
  }

  if ($value -is [System.IO.Stream]) {
    if ($value.CanSeek) {
      $value.Position = 0
    }

    $reader = New-Object System.IO.StreamReader($value, [System.Text.Encoding]::UTF8, $true)
    Add-ClipboardPathText $reader.ReadToEnd()
    return
  }

  if (($value -is [System.Collections.IEnumerable]) -and -not ($value -is [string])) {
    foreach ($item in $value) {
      Add-ClipboardValue $item
    }
    return
  }

  Add-ClipboardPathText ([string] $value)
}

$fileDropList = [System.Windows.Forms.Clipboard]::GetFileDropList()
Add-ClipboardValue $fileDropList

$dataObject = [System.Windows.Forms.Clipboard]::GetDataObject()
$formats = @()
if ($null -ne $dataObject) {
  $formats = @($dataObject.GetFormats())
  foreach ($format in @([System.Windows.Forms.DataFormats]::FileDrop, 'FileNameW', 'FileName', 'text/uri-list', 'UniformResourceLocatorW', 'UniformResourceLocator')) {
    if ($dataObject.GetDataPresent($format)) {
      Add-ClipboardValue ($dataObject.GetData($format))
    }
  }
}

$uniquePaths = @($paths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
$payload = [pscustomobject] @{
  paths = $uniquePaths
  nativeFormats = $formats
}

[Console]::WriteLine((ConvertTo-Json -InputObject $payload -Compress -Depth 3))
`.trim()

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}

export function parseWindowsFileDropPowerShellOutput(stdout: string): Pick<WindowsClipboardFileDropResult, 'paths' | 'nativeFormats'> {
  const trimmed = stdout.trim()
  if (!trimmed) return { paths: [], nativeFormats: [] }

  const parsed = JSON.parse(trimmed) as { paths?: unknown; nativeFormats?: unknown }
  const rawPaths = Array.isArray(parsed.paths) ? parsed.paths : typeof parsed.paths === 'string' ? [parsed.paths] : []
  const rawFormats = Array.isArray(parsed.nativeFormats)
    ? parsed.nativeFormats
    : typeof parsed.nativeFormats === 'string'
      ? [parsed.nativeFormats]
      : []

  return {
    paths: uniqueStrings(rawPaths.filter((path): path is string => typeof path === 'string')),
    nativeFormats: uniqueStrings(rawFormats.filter((format): format is string => typeof format === 'string'))
  }
}

function execFileAsync(execFileImpl: ExecFileLike, file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileImpl(
      file,
      args,
      {
        timeout: WINDOWS_CLIPBOARD_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: WINDOWS_CLIPBOARD_MAX_BUFFER_BYTES
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }))
          return
        }

        resolve({ stdout, stderr })
      }
    )
  })
}

export async function readWindowsClipboardFileDropPaths(
  execFileImpl: ExecFileLike = execFile,
  platform: NodeJS.Platform = process.platform
): Promise<WindowsClipboardFileDropResult> {
  if (platform !== 'win32') {
    return {
      paths: [],
      nativeFormats: [],
      diagnostic: { attempted: false }
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync(execFileImpl, 'powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Sta',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      WINDOWS_FILE_DROP_SCRIPT
    ])
    const parsed = parseWindowsFileDropPowerShellOutput(stdout)

    return {
      ...parsed,
      diagnostic: {
        attempted: true,
        stdoutLength: stdout.length,
        stderrLength: stderr.length
      }
    }
  } catch (error) {
    const withOutput = error as Error & { stdout?: string; stderr?: string }

    return {
      paths: [],
      nativeFormats: [],
      diagnostic: {
        attempted: true,
        stdoutLength: withOutput.stdout?.length ?? 0,
        stderrLength: withOutput.stderr?.length ?? 0,
        error: withOutput.message
      }
    }
  }
}

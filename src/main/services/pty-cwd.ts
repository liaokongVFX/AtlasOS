const CWD_MARKER_PREFIX = '\u001b]1337;CurrentDir='
const CWD_MARKER_SUFFIX = '\u0007'
const CWD_MARKER_REGEX = /\u001b]1337;CurrentDir=([A-Za-z0-9+/=]+)\u0007/g

export function encodeCwdMarker(cwd: string): string {
  return `${CWD_MARKER_PREFIX}${Buffer.from(cwd, 'utf8').toString('base64')}${CWD_MARKER_SUFFIX}`
}

export function extractCwdMarkers(data: string): string[] {
  const markers: string[] = []
  CWD_MARKER_REGEX.lastIndex = 0

  for (const match of data.matchAll(CWD_MARKER_REGEX)) {
    try {
      markers.push(Buffer.from(match[1], 'base64').toString('utf8'))
    } catch {
      // Ignore malformed marker payloads.
    }
  }

  return markers
}

export function buildPowerShellBootstrapScript(): string {
  return [
    '$__atlasSetPSReadLineKeyHandler = Get-Command Set-PSReadLineKeyHandler -ErrorAction SilentlyContinue',
    'if ($__atlasSetPSReadLineKeyHandler) {',
    '  try {',
    '    Import-Module PSReadLine -ErrorAction Stop',
    '    Set-PSReadLineKeyHandler -Key UpArrow -ScriptBlock {',
    '      param($key, $arg)',
    '      $line = $null',
    '      $cursor = 0',
    '      [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref] $line, [ref] $cursor)',
    '      [Microsoft.PowerShell.PSConsoleReadLine]::PreviousLine($key, $arg)',
    '      $nextLine = $null',
    '      $nextCursor = 0',
    '      [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref] $nextLine, [ref] $nextCursor)',
    '      if ($nextLine -eq $line -and $nextCursor -eq $cursor) {',
    '        [Microsoft.PowerShell.PSConsoleReadLine]::PreviousHistory($key, $arg)',
    '      }',
    '    }',
    '    Set-PSReadLineKeyHandler -Key DownArrow -ScriptBlock {',
    '      param($key, $arg)',
    '      $line = $null',
    '      $cursor = 0',
    '      [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref] $line, [ref] $cursor)',
    '      [Microsoft.PowerShell.PSConsoleReadLine]::NextLine($key, $arg)',
    '      $nextLine = $null',
    '      $nextCursor = 0',
    '      [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref] $nextLine, [ref] $nextCursor)',
    '      if ($nextLine -eq $line -and $nextCursor -eq $cursor) {',
    '        [Microsoft.PowerShell.PSConsoleReadLine]::NextHistory($key, $arg)',
    '      }',
    '    }',
    '  } catch {',
    '    # Keep terminal startup working if PSReadLine is unavailable or older than expected.',
    '  }',
    '}',
    '$__atlasOriginalPrompt = (Get-Command prompt).ScriptBlock',
    'function prompt {',
    '  $cwd = (Get-Location).Path',
    '  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cwd))',
    `  [Console]::Write("${CWD_MARKER_PREFIX}$encoded${CWD_MARKER_SUFFIX}")`,
    '  & $__atlasOriginalPrompt',
    '}'
  ].join('\n')
}

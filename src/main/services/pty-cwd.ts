const CWD_MARKER_PREFIX = '\u001b]1337;CurrentDir='
const CWD_MARKER_SUFFIX = '\u0007'
export const CODEX_COMMAND_MARKER = '\u001b]1337;SetUserVar=AtlasCodex=MQ==\u0007'
export const CODEX_WIN32_INPUT_CONFIG = 'disable_paste_burst=true'
const CWD_MARKER_REGEX = /\u001b]1337;CurrentDir=([A-Za-z0-9+/=]+)\u0007/g

export function encodeCwdMarker(cwd: string): string {
  return `${CWD_MARKER_PREFIX}${Buffer.from(cwd, 'utf8').toString('base64')}${CWD_MARKER_SUFFIX}`
}

export function extractCwdMarkers(data: string, newDataStart = 0): string[] {
  const markers: string[] = []
  CWD_MARKER_REGEX.lastIndex = 0

  for (const match of data.matchAll(CWD_MARKER_REGEX)) {
    if (match.index + match[0].length <= newDataStart) continue
    try {
      markers.push(Buffer.from(match[1], 'base64').toString('utf8'))
    } catch {
      // Ignore malformed marker payloads.
    }
  }

  return markers
}

export function buildPowerShellBootstrapScript(useWin32Input = false): string {
  return [
    '$__atlasSetPSReadLineKeyHandler = Get-Command Set-PSReadLineKeyHandler -ErrorAction SilentlyContinue',
    'if ($__atlasSetPSReadLineKeyHandler) {',
    '  try {',
    '    Import-Module PSReadLine -ErrorAction Stop',
    // PSReadLine owns history recall and editing. Only report the executable
    // it actually accepted, without putting command arguments in an OSC.
    '    $__atlasReadLine = (Get-Command PSConsoleHostReadLine).ScriptBlock',
    '    if ($env:OS -eq "Windows_NT" -and $__atlasReadLine) {',
    '      function global:PSConsoleHostReadLine {',
    '        $line = & $__atlasReadLine',
    '        if ($line -match "codex") {',
    '          $ast = [System.Management.Automation.Language.Parser]::ParseInput($line, [ref]$null, [ref]$null)',
    '          $commands = @($ast.FindAll({',
    '            param($node)',
    '            $node -is [System.Management.Automation.Language.CommandAst] -and $node.Parent.Parent -eq $ast.EndBlock -and',
    '              $node.GetCommandName() -match "(?:^|[\\\\/])codex(?:\\.(?:exe|cmd|ps1|bat))?$"',
    '          }, $false))',
    '          if ($commands.Count) {',
    // The accepted command includes recalled/edited input. Insert after the
    // executable so quoted paths and the precedence of explicit -c flags survive.
    ...(useWin32Input ? [
      '            for ($i = $commands.Count - 1; $i -ge 0; $i--) {',
      `              $line = $line.Insert($commands[$i].CommandElements[0].Extent.EndOffset, ' -c ${CODEX_WIN32_INPUT_CONFIG}')`,
      '            }'
    ] : []),
    `            [Console]::Write("${CODEX_COMMAND_MARKER}")`,
    '          }',
    '        }',
    '        $line',
    '      }',
    '    }',
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

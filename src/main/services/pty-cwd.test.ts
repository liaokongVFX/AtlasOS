import { describe, expect, it } from 'vitest'
import { buildPowerShellBootstrapScript, encodeCwdMarker, extractCwdMarkers } from './pty-cwd'

describe('pty cwd markers', () => {
  it('encodes and extracts cwd markers', () => {
    const marker = encodeCwdMarker('C:\\Users\\xhwz2')

    expect(extractCwdMarkers(`before${marker}after`)).toEqual(['C:\\Users\\xhwz2'])
  })

  it('returns the markers in order', () => {
    const first = encodeCwdMarker('C:\\')
    const second = encodeCwdMarker('D:\\Projects')

    expect(extractCwdMarkers(`start${first}middle${second}end`)).toEqual(['C:\\', 'D:\\Projects'])
  })

  it('wraps the existing PowerShell prompt', () => {
    const script = buildPowerShellBootstrapScript()

    expect(script).toContain('Get-Location')
    expect(script).toContain('CurrentDir=')
    expect(script).toContain('ScriptBlock')
  })

  it('binds PowerShell arrows to move within multiline input before history', () => {
    const script = buildPowerShellBootstrapScript()
    const previousLineIndex = script.indexOf('[Microsoft.PowerShell.PSConsoleReadLine]::PreviousLine($key, $arg)')
    const previousHistoryIndex = script.indexOf('[Microsoft.PowerShell.PSConsoleReadLine]::PreviousHistory($key, $arg)')
    const nextLineIndex = script.indexOf('[Microsoft.PowerShell.PSConsoleReadLine]::NextLine($key, $arg)')
    const nextHistoryIndex = script.indexOf('[Microsoft.PowerShell.PSConsoleReadLine]::NextHistory($key, $arg)')

    expect(script).toContain('Set-PSReadLineKeyHandler -Key UpArrow -ScriptBlock')
    expect(script).toContain('Set-PSReadLineKeyHandler -Key DownArrow -ScriptBlock')
    expect(script).toContain('Import-Module PSReadLine -ErrorAction Stop')
    expect(previousLineIndex).toBeGreaterThan(-1)
    expect(previousHistoryIndex).toBeGreaterThan(previousLineIndex)
    expect(nextLineIndex).toBeGreaterThan(-1)
    expect(nextHistoryIndex).toBeGreaterThan(nextLineIndex)
  })
})

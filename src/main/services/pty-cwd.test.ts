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
})

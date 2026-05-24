import { describe, expect, it } from 'vitest'
import { parseWindowsFileDropPowerShellOutput, readWindowsClipboardFileDropPaths } from './windows-clipboard-files'

describe('Windows clipboard file drop fallback', () => {
  it('parses PowerShell clipboard file drop JSON output', () => {
    expect(
      parseWindowsFileDropPowerShellOutput(
        JSON.stringify({
          paths: ['C:\\Users\\xhwz2\\Desktop\\one.txt', 'C:\\Users\\xhwz2\\Desktop\\one.txt', 'D:\\Projects\\AtlasOS\\README.md'],
          nativeFormats: ['FileDrop', 'FileDrop', 'Shell IDList Array']
        })
      )
    ).toEqual({
      paths: ['C:\\Users\\xhwz2\\Desktop\\one.txt', 'D:\\Projects\\AtlasOS\\README.md'],
      nativeFormats: ['FileDrop', 'Shell IDList Array']
    })
  })

  it('handles the single string shape emitted by ConvertTo-Json', () => {
    expect(
      parseWindowsFileDropPowerShellOutput(
        JSON.stringify({
          paths: 'C:\\Users\\xhwz2\\Desktop\\one.txt',
          nativeFormats: 'FileDrop'
        })
      )
    ).toEqual({
      paths: ['C:\\Users\\xhwz2\\Desktop\\one.txt'],
      nativeFormats: ['FileDrop']
    })
  })

  it('runs the fixed STA PowerShell command on Windows', async () => {
    const execFile = (
      file: string,
      args: string[],
      options: { timeout: number; windowsHide: boolean; maxBuffer: number },
      callback: (error: Error | null, stdout: string, stderr: string) => void
    ): void => {
      callback(
        null,
        JSON.stringify({
          paths: ['C:\\Users\\xhwz2\\Desktop\\one.txt'],
          nativeFormats: ['FileDrop']
        }),
        ''
      )

      expect(file).toBe('powershell.exe')
      expect(args).toContain('-Sta')
      expect(args).toContain('-NonInteractive')
      expect(options.windowsHide).toBe(true)
    }

    await expect(readWindowsClipboardFileDropPaths(execFile, 'win32')).resolves.toMatchObject({
      paths: ['C:\\Users\\xhwz2\\Desktop\\one.txt'],
      nativeFormats: ['FileDrop'],
      diagnostic: {
        attempted: true,
        stderrLength: 0
      }
    })
  })

  it('does not run the fallback outside Windows', async () => {
    const execFile = (): void => {
      throw new Error('should not run')
    }

    await expect(readWindowsClipboardFileDropPaths(execFile, 'linux')).resolves.toEqual({
      paths: [],
      nativeFormats: [],
      diagnostic: { attempted: false }
    })
  })
})

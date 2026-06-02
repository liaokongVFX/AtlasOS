import { describe, expect, it } from 'vitest'
import { detectTerminalAgentCommand, parseTerminalAgentResumeCommand, terminalAgentResumeCommand } from './terminal-agent'

describe('terminal agent command helpers', () => {
  it('detects Claude and Codex agent commands without treating help as a running agent', () => {
    expect(detectTerminalAgentCommand('codex')).toMatchObject({ source: 'codex', command: 'codex' })
    expect(detectTerminalAgentCommand('& "C:\\Users\\xhwz2\\AppData\\Roaming\\npm\\claude.cmd" --resume alpha')).toMatchObject({
      source: 'claude'
    })
    expect(detectTerminalAgentCommand('codex --help')).toBeNull()
    expect(detectTerminalAgentCommand('echo codex')).toBeNull()
  })

  it('extracts stable resume targets from supported agent resume commands', () => {
    expect(parseTerminalAgentResumeCommand('claude --resume alpha-session')).toMatchObject({
      source: 'claude',
      sessionId: 'alpha-session',
      command: 'claude --resume alpha-session'
    })
    expect(parseTerminalAgentResumeCommand('claude --resume=alpha-session')).toMatchObject({
      source: 'claude',
      sessionId: 'alpha-session'
    })
    expect(parseTerminalAgentResumeCommand('codex resume codex-session')).toMatchObject({
      source: 'codex',
      sessionId: 'codex-session',
      command: 'codex resume codex-session'
    })
    expect(parseTerminalAgentResumeCommand('codex')).toBeNull()
  })

  it('builds safe provider resume commands', () => {
    expect(terminalAgentResumeCommand('codex', '019e8407-5fbf-7f53-94da-b95c110a8110')).toBe('codex resume 019e8407-5fbf-7f53-94da-b95c110a8110')
    expect(terminalAgentResumeCommand('claude', 'alpha-session')).toBe('claude --resume alpha-session')
    expect(terminalAgentResumeCommand('codex', 'thread name with spaces')).toBeNull()
  })
})

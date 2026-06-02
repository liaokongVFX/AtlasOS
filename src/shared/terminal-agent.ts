import { z } from 'zod'

export const terminalAgentSourceSchema = z.enum(['codex', 'claude'])

export const terminalAgentRestoreSchema = z.object({
  source: terminalAgentSourceSchema,
  sessionId: z.string().trim().min(1).max(300),
  command: z.string().trim().min(1).max(8192),
  cwd: z.string().trim().min(1).optional(),
  updatedAt: z.string().optional()
})

export const terminalAgentCommandEventSchema = z.object({
  sessionId: z.string().min(1),
  componentId: z.string().min(1),
  canvasId: z.string().min(1).optional(),
  source: terminalAgentSourceSchema,
  cwd: z.string().min(1).optional(),
  command: z.string().trim().min(1).max(8192)
})

export type TerminalAgentSource = z.infer<typeof terminalAgentSourceSchema>
export type TerminalAgentRestore = z.infer<typeof terminalAgentRestoreSchema>
export type TerminalAgentCommandEvent = z.infer<typeof terminalAgentCommandEventSchema>

type ShellToken = {
  token: string
  rest: string
}

export type TerminalAgentCommand = {
  source: TerminalAgentSource
  command: string
}

function safeShellToken(value: string): string | null {
  return /^[A-Za-z0-9._:@/-]+$/.test(value) ? value : null
}

function readShellToken(input: string): ShellToken | null {
  const value = input.trimStart()
  if (!value) return null

  const quote = value[0]
  if (quote === '"' || quote === "'") {
    let token = ''
    for (let index = 1; index < value.length; index += 1) {
      const char = value[index]
      if (char === quote) return { token, rest: value.slice(index + 1) }
      token += char
    }
    return { token, rest: '' }
  }

  const match = /^[^\s;&|<>]+/.exec(value)
  if (!match) return null
  return { token: match[0], rest: value.slice(match[0].length) }
}

function readCommandExecutable(command: string): ShellToken | null {
  let remaining = command.trim()
  if (!remaining) return null
  if (remaining.startsWith('&')) remaining = remaining.slice(1).trimStart()
  return readShellToken(remaining)
}

function commandArguments(command: string): string[] {
  const executable = readCommandExecutable(command)
  if (!executable) return []

  const args: string[] = []
  let remaining = executable.rest

  while (args.length < 32) {
    const next = readShellToken(remaining)
    if (!next) break
    args.push(next.token)
    remaining = next.rest
  }

  return args
}

function agentSourceFromExecutable(token: string): TerminalAgentSource | null {
  const baseName = token.split(/[\\/]/).at(-1)?.toLowerCase()
  if (!baseName) return null

  const command = baseName.replace(/\.(cmd|exe|bat|ps1)$/i, '')
  if (command === 'codex') return 'codex'
  if (command === 'claude') return 'claude'
  return null
}

function isHelpOrVersionArgument(argument: string | undefined): boolean {
  if (!argument) return false
  return ['-h', '--help', 'help', '-v', '--version', 'version'].includes(argument.toLowerCase())
}

function nonFlagSessionId(value: string | undefined): string | null {
  const sessionId = value?.trim()
  if (!sessionId || sessionId.startsWith('-')) return null
  return sessionId
}

function codexResumeSessionId(args: string[]): string | null {
  const resumeIndex = args.findIndex((argument) => argument.toLowerCase() === 'resume')
  if (resumeIndex < 0) return null
  return nonFlagSessionId(args[resumeIndex + 1])
}

function claudeResumeSessionId(args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    const lower = argument.toLowerCase()

    if (lower === '--resume' || lower === '-r') {
      return nonFlagSessionId(args[index + 1])
    }

    if (lower.startsWith('--resume=')) {
      return nonFlagSessionId(argument.slice('--resume='.length))
    }
  }

  return null
}

export function detectTerminalAgentCommand(command: string): TerminalAgentCommand | null {
  const normalizedCommand = command.trim()
  const executable = readCommandExecutable(normalizedCommand)
  if (!executable) return null

  const source = agentSourceFromExecutable(executable.token)
  if (!source) return null

  const firstArgument = readShellToken(executable.rest)?.token
  if (isHelpOrVersionArgument(firstArgument)) return null

  return {
    source,
    command: normalizedCommand
  }
}

export function parseTerminalAgentResumeCommand(command: string): TerminalAgentRestore | null {
  const agentCommand = detectTerminalAgentCommand(command)
  if (!agentCommand) return null

  const args = commandArguments(command)
  const sessionId = agentCommand.source === 'codex' ? codexResumeSessionId(args) : claudeResumeSessionId(args)
  if (!sessionId) return null

  return {
    source: agentCommand.source,
    sessionId,
    command: agentCommand.command
  }
}

export function createTerminalAgentRestore(command: string, cwd?: string): TerminalAgentRestore | null {
  const restore = parseTerminalAgentResumeCommand(command)
  if (!restore) return null

  const normalizedCwd = cwd?.trim()
  return {
    ...restore,
    cwd: normalizedCwd || undefined,
    updatedAt: new Date().toISOString()
  }
}

export function terminalAgentResumeCommand(source: TerminalAgentSource, sessionId: string): string | null {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) return null

  const sessionArgument = safeShellToken(normalizedSessionId)
  if (!sessionArgument) return null

  return source === 'codex' ? `codex resume ${sessionArgument}` : `claude --resume ${sessionArgument}`
}

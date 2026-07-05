export const DEFAULT_RENDERER_DEV_PORT = 0

export function resolveRendererDevPort(input: string | undefined): number {
  const value = input?.trim()
  if (!value) return DEFAULT_RENDERER_DEV_PORT

  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) return DEFAULT_RENDERER_DEV_PORT

  return port
}

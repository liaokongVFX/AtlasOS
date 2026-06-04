export function createContentSecurityPolicy(isDev: boolean): string {
  return isDev
    ? "default-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* data: blob:; script-src 'self' 'unsafe-inline' http://localhost:* http://127.0.0.1:* atlas-plugin:; style-src 'self' 'unsafe-inline' atlas-plugin:; img-src 'self' data: blob: atlas-file: atlas-plugin: https:; media-src 'self' data: blob: atlas-file: atlas-plugin:; font-src 'self' data: blob:; frame-src http: https:;"
    : "default-src 'self' data: blob:; script-src 'self' atlas-plugin:; style-src 'self' 'unsafe-inline' atlas-plugin:; img-src 'self' data: blob: atlas-file: atlas-plugin: https:; media-src 'self' data: blob: atlas-file: atlas-plugin:; font-src 'self' data: blob:; frame-src http: https:;"
}

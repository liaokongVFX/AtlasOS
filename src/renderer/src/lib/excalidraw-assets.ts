const EXCALIDRAW_ASSET_PATH = 'excalidraw-assets/'

export function getExcalidrawAssetPath(pageHref: string = window.location.href): string {
  return new URL(EXCALIDRAW_ASSET_PATH, pageHref).toString()
}

window.EXCALIDRAW_ASSET_PATH = getExcalidrawAssetPath()

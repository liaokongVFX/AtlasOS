import type { AtlasApi } from '../../preload'
import type { JSX as ReactJSX } from 'react'

declare global {
  namespace JSX {
    type Element = ReactJSX.Element
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
  }

  interface Window {
    atlas: AtlasApi
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

export {}

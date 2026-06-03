import '@testing-library/jest-dom/vitest'
import { createElement, type ReactNode } from 'react'
import { vi } from 'vitest'

function createExcalidrawApiMock() {
  return {
    getSceneElementsIncludingDeleted: vi.fn(() => []),
    getFiles: vi.fn(() => ({})),
    getAppState: vi.fn(() => ({})),
    updateScene: vi.fn()
  }
}

vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: (props: { children?: ReactNode; excalidrawAPI?: (api: ReturnType<typeof createExcalidrawApiMock>) => void }) => {
    props.excalidrawAPI?.(createExcalidrawApiMock())
    return createElement('div', { 'data-testid': 'excalidraw' }, props.children)
  },
  convertToExcalidrawElements: (skeletons: Array<Record<string, unknown>>, options?: { regenerateIds?: boolean }) =>
    skeletons.map((skeleton, index) => ({
      ...skeleton,
      id: options?.regenerateIds ? `generated-${index}` : skeleton.id,
      width: Number(skeleton.width ?? 0),
      height: Number(skeleton.height ?? 0),
      isDeleted: false
    }))
}))

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverMock

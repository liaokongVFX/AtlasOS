import { useLayoutEffect, useState } from 'react'

export type ElementSize = {
  width: number
  height: number
}

export function useElementSize<T extends HTMLElement>(ref: React.RefObject<T | null>): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    if (!ref.current) return

    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height)
      })
    })

    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [ref])

  return size
}

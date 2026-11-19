import type { Terminal } from '@xterm/xterm'

type MouseReportService = {
  getMouseReportCoords(
    point: Pick<MouseEvent, 'clientX' | 'clientY'>,
    screen: HTMLElement
  ): { col: number; row: number; x: number; y: number } | undefined
}

export function installTerminalScrollCompatibility(terminal: Terminal): () => void {
  // xterm 6 exposes mouse tracking modes but no public hook for mapping coordinates.
  // Its hit test subtracts a screen-space origin, then divides by unscaled cell sizes.
  const { _core } = terminal as Terminal & { _core?: { _mouseService?: MouseReportService } }
  const mouse = _core?._mouseService
  const originalCoords = mouse?.getMouseReportCoords
  if (mouse && originalCoords) {
    mouse.getMouseReportCoords = function (point, screen) {
      const rect = screen.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0 && screen.offsetWidth > 0 && screen.offsetHeight > 0) {
        point = {
          clientX: rect.left + (point.clientX - rect.left) * screen.offsetWidth / rect.width,
          clientY: rect.top + (point.clientY - rect.top) * screen.offsetHeight / rect.height
        }
      }
      return originalCoords.call(this, point, screen)
    }
  }

  // xterm's DOM scrollbar also uses unscaled pointer deltas. Map a drag on a
  // transformed rail directly to scrollback lines using its displayed bounds.
  const rail = terminal.element?.querySelector<HTMLElement>('.xterm-scrollable-element > .scrollbar.vertical')
  const slider = rail?.querySelector<HTMLElement>('.slider')
  let drag: { pointerId: number; grabOffset: number } | undefined

  function scrollToPointer(event: PointerEvent): void {
    if (!rail || !slider || drag?.pointerId !== event.pointerId) return
    const track = rail.getBoundingClientRect()
    const travel = track.height - slider.getBoundingClientRect().height
    if (travel <= 0) return
    const fraction = Math.max(0, Math.min(1, (event.clientY - track.top - drag.grabOffset) / travel))
    terminal.scrollToLine(Math.round(fraction * terminal.buffer.active.baseY))
  }

  function startDrag(event: PointerEvent): void {
    if (!rail || !slider || drag || event.button !== 0 || !terminal.buffer.active.baseY) return
    if (Math.abs(rail.getBoundingClientRect().height - rail.offsetHeight) < 1) return
    const thumb = slider.getBoundingClientRect()
    drag = { pointerId: event.pointerId, grabOffset: event.target === slider ? event.clientY - thumb.top : thumb.height / 2 }
    event.preventDefault()
    event.stopImmediatePropagation()
    rail.setPointerCapture(event.pointerId)
    scrollToPointer(event)
  }

  function endDrag(event: PointerEvent): void {
    if (drag?.pointerId === event.pointerId) drag = undefined
  }

  rail?.addEventListener('pointerdown', startDrag, true)
  rail?.addEventListener('pointermove', scrollToPointer)
  rail?.addEventListener('lostpointercapture', endDrag)
  return () => {
    if (mouse && originalCoords) mouse.getMouseReportCoords = originalCoords
    rail?.removeEventListener('pointerdown', startDrag, true)
    rail?.removeEventListener('pointermove', scrollToPointer)
    rail?.removeEventListener('lostpointercapture', endDrag)
    if (drag && rail?.hasPointerCapture(drag.pointerId)) rail.releasePointerCapture(drag.pointerId)
  }
}

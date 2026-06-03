import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { I18nProvider, type Locale } from '../../i18n'
import { CalendarComponent } from './calendar-component'

const TIMESTAMP = '2026-05-27T00:00:00.000Z'

function createComponent(state: Record<string, unknown> = {}): CanvasComponent {
  return {
    id: 'calendar-1',
    type: 'calendar',
    title: 'Calendar',
    frame: { x: 0, y: 0, width: 560, height: 460 },
    zIndex: 1,
    config: {},
    state,
    bindings: {},
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP
  }
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date)
}

function formatShortTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function renderCalendar(component = createComponent(), updateState = vi.fn(), locale: Locale = 'en-US') {
  render(
    <I18nProvider locale={locale}>
      <CalendarComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={vi.fn()}
        updateState={updateState}
        setTitle={vi.fn()}
      />
    </I18nProvider>
  )

  return updateState
}

function getGridDates(): string[] {
  return screen.getAllByRole('gridcell').map((day) => day.getAttribute('datetime') ?? '')
}

describe('CalendarComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders the current local time, date, and highlighted day', () => {
    const current = new Date(2026, 4, 27, 8, 9, 10)
    vi.setSystemTime(current)

    renderCalendar()

    expect(screen.getByText(formatTime(current))).toBeInTheDocument()
    expect(screen.getByText(formatShortTime(current))).toBeInTheDocument()
    expect(screen.getByText(new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(current))).toBeInTheDocument()
    expect(
      screen.getAllByText(
        new Intl.DateTimeFormat('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        }).format(current)
      ).length
    ).toBeGreaterThan(0)

    const today = document.querySelector('[aria-current="date"]')
    expect(today).toHaveTextContent(new Intl.DateTimeFormat('en-US', { day: 'numeric' }).format(current))
  })

  it('keeps the clock current without persisting component state', async () => {
    const current = new Date(2026, 4, 27, 8, 9, 10)
    const nextSecond = new Date(2026, 4, 27, 8, 9, 11)
    vi.setSystemTime(current)

    renderCalendar()
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByText(formatTime(nextSecond))).toBeInTheDocument()
  })

  it('renders only the complete weeks needed for a five-week month', () => {
    vi.setSystemTime(new Date(2026, 5, 3, 21, 52, 17))

    renderCalendar(createComponent(), vi.fn(), 'zh-CN')

    const dates = getGridDates()
    expect(dates).toHaveLength(35)
    expect(dates[0]).toBe('2026-06-01')
    expect(dates[dates.length - 1]).toBe('2026-07-05')
    expect(dates).not.toContain('2026-07-06')
  })

  it('keeps six complete weeks when the month requires them', () => {
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0))

    renderCalendar(createComponent(), vi.fn(), 'zh-CN')

    const dates = getGridDates()
    expect(dates).toHaveLength(42)
    expect(dates[0]).toBe('2026-07-27')
    expect(dates[dates.length - 1]).toBe('2026-09-06')
  })

  it('persists compact mode from the collapse control', () => {
    vi.setSystemTime(new Date(2026, 4, 27, 8, 9, 10))
    const updateState = renderCalendar()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse calendar' }))

    expect(updateState).toHaveBeenCalledWith({ compact: true }, true)
  })

  it('renders compact mode as a time-only surface with an expand control', () => {
    const current = new Date(2026, 4, 27, 8, 9, 10)
    vi.setSystemTime(current)
    const updateState = renderCalendar(createComponent({ compact: true }))

    expect(screen.getByText(formatTime(current))).toBeInTheDocument()
    expect(screen.getByText(formatShortTime(current))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand calendar' })).toBeInTheDocument()
    expect(screen.queryByText('Current time')).not.toBeInTheDocument()
    expect(screen.queryByText('May 2026')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand calendar' }))
    expect(updateState).toHaveBeenCalledWith({ compact: false }, true)
  })
})

import { Clock3, Globe2, Maximize2, Minimize2 } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useI18n, type Locale } from '../../i18n'
import { asBoolean } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'

type CalendarDay = {
  date: Date
  isCurrentMonth: boolean
  isToday: boolean
}

const DAYS_PER_WEEK = 7
const SUNDAY = 0
const MONDAY = 1

function sameLocalDate(first: Date, second: Date): boolean {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  )
}

function getFirstDayOfWeek(locale: Locale): number {
  return locale === 'en-US' ? SUNDAY : MONDAY
}

function calendarDaysForMonth(date: Date, firstDayOfWeek: number): CalendarDay[] {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
  const startOffset = (monthStart.getDay() - firstDayOfWeek + 7) % 7
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  const weekCount = Math.ceil((startOffset + daysInMonth) / DAYS_PER_WEEK)
  const gridStart = new Date(monthStart)
  gridStart.setDate(monthStart.getDate() - startOffset)

  return Array.from({ length: weekCount * DAYS_PER_WEEK }, (_, index) => {
    const day = new Date(gridStart)
    day.setDate(gridStart.getDate() + index)

    return {
      date: day,
      isCurrentMonth: day.getMonth() === date.getMonth(),
      isToday: sameLocalDate(day, date)
    }
  })
}

function weekdayLabels(locale: Locale, firstDayOfWeek: number): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  const knownSunday = new Date(2023, 0, 1)

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(knownSunday)
    day.setDate(knownSunday.getDate() + firstDayOfWeek + index)
    return formatter.format(day)
  })
}

function formatTimeZone(date: Date, locale: Locale): string {
  const parts = new Intl.DateTimeFormat(locale, { timeZoneName: 'short' }).formatToParts(date)
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
}

function formatDateAttribute(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateTimeAttribute(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${formatDateAttribute(date)}T${hours}:${minutes}:${seconds}`
}

export function CalendarComponent({ component, updateState, setHeaderActions }: AtlasComponentRendererProps): JSX.Element {
  const { locale, t } = useI18n()
  const [now, setNow] = useState(() => new Date())
  const currentTimeId = useId()
  const currentMonthId = useId()
  const compact = asBoolean(component.state.compact)

  useEffect(() => {
    let timer: number | null = null
    let disposed = false

    const scheduleTick = (): void => {
      const delay = 1000 - (Date.now() % 1000)
      timer = window.setTimeout(() => {
        if (disposed) return
        setNow(new Date())
        scheduleTick()
      }, delay)
    }

    scheduleTick()

    return () => {
      disposed = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  const firstDayOfWeek = getFirstDayOfWeek(locale)
  const formatters = useMemo(
    () => ({
      day: new Intl.DateTimeFormat(locale, { day: 'numeric' }),
      fullDate: new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      month: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
      monthDay: new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }),
      shortTime: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'long' })
    }),
    [locale]
  )
  const days = useMemo(() => calendarDaysForMonth(now, firstDayOfWeek), [firstDayOfWeek, now])
  const weekdayNames = useMemo(() => weekdayLabels(locale, firstDayOfWeek), [firstDayOfWeek, locale])
  const currentTime = formatters.time.format(now)
  const currentShortTime = formatters.shortTime.format(now)
  const currentDate = formatters.fullDate.format(now)
  const currentMonth = formatters.month.format(now)
  const currentWeekday = formatters.weekday.format(now)
  const timeZone = formatTimeZone(now, locale)
  const toggleCompact = useCallback((): void => updateState({ compact: !compact }, true), [compact, updateState])
  const headerActions = useMemo(
    () => (
      <button
        type="button"
        className="icon-button component-node__header-action-button"
        onClick={toggleCompact}
        title={compact ? t('calendar.expand') : t('calendar.collapse')}
        aria-label={compact ? t('calendar.expand') : t('calendar.collapse')}
        aria-pressed={compact ? 'true' : 'false'}
      >
        {compact ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
      </button>
    ),
    [compact, t, toggleCompact]
  )

  useEffect(() => {
    if (!setHeaderActions) return undefined

    setHeaderActions(headerActions)
    return () => setHeaderActions(null)
  }, [headerActions, setHeaderActions])

  const timeContent = (
    <>
      <span className="calendar-time-value calendar-time-value--wide">{currentTime}</span>
      <span className="calendar-time-value calendar-time-value--narrow">{currentShortTime}</span>
    </>
  )

  if (compact) {
    return (
      <div className="calendar-module calendar-module--compact" aria-label={t('calendar.aria', { date: currentDate, time: currentTime })}>
        <time className="calendar-compact-time" dateTime={formatDateTimeAttribute(now)} aria-live="polite">
          {timeContent}
        </time>
      </div>
    )
  }

  return (
    <div className="calendar-module" aria-label={t('calendar.aria', { date: currentDate, time: currentTime })}>
      <div className="calendar-body">
        <section className="calendar-clock-panel" aria-labelledby={currentTimeId}>
          <div className="calendar-panel-label" id={currentTimeId}>
            <Clock3 size={16} />
            <span>{t('calendar.currentTime')}</span>
          </div>
          <div className="calendar-clock" aria-live="polite">
            <time dateTime={formatDateTimeAttribute(now)}>{timeContent}</time>
            <strong>{currentWeekday}</strong>
            <span>{currentDate}</span>
          </div>
          <div className="calendar-timezone">
            <Globe2 size={14} />
            <span>{t('calendar.timezone')}</span>
            <strong>{timeZone}</strong>
          </div>
        </section>

        <section className="calendar-month-panel" aria-labelledby={currentMonthId}>
          <div className="calendar-month-header">
            <div>
              <span>{t('calendar.localTime')}</span>
              <strong id={currentMonthId}>{currentMonth}</strong>
            </div>
            <time dateTime={formatDateAttribute(now)}>{t('calendar.today')}</time>
          </div>
          <div className="calendar-weekdays" role="row">
            {weekdayNames.map((weekday) => (
              <span key={weekday} role="columnheader">
                {weekday}
              </span>
            ))}
          </div>
          <div className="calendar-grid" role="grid" aria-label={t('calendar.monthGrid', { month: currentMonth })}>
            {days.map((day) => {
              const dayLabel = formatters.monthDay.format(day.date)
              const className = [
                'calendar-day',
                day.isCurrentMonth ? '' : 'calendar-day--outside',
                day.isToday ? 'calendar-day--today' : ''
              ]
                .filter(Boolean)
                .join(' ')

              return (
                <time
                  key={formatDateAttribute(day.date)}
                  className={className}
                  dateTime={formatDateAttribute(day.date)}
                  role="gridcell"
                  aria-current={day.isToday ? 'date' : undefined}
                  aria-label={day.isToday ? t('calendar.todayLabel', { date: dayLabel }) : dayLabel}
                >
                  {formatters.day.format(day.date)}
                </time>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

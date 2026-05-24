import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Bell, CheckCircle2, CircleAlert, MonitorDot } from 'lucide-react'
import type { PetAgentSession, PetAlert, PetRuntimeState } from '@shared/pet'

const PANEL_CLOSE_DELAY_MS = 140

type DragState = {
  startScreenX: number
  startScreenY: number
  startX: number
  startY: number
}

function isVisibleAlert(alert: PetAlert): boolean {
  if (alert.readAt) return false
  if (!alert.snoozedUntil) return true
  return new Date(alert.snoozedUntil).getTime() <= Date.now()
}

function sourceLabel(session: PetAgentSession): string {
  return session.source === 'codex' ? 'Codex' : 'Claude Code'
}

function statusLabel(status: PetAgentSession['status']): string {
  if (status === 'waiting_for_confirmation') return 'waiting'
  if (status === 'completed') return 'done'
  if (status === 'error') return 'error'
  if (status === 'idle_unknown') return 'idle'
  return 'running'
}

function alertIcon(alert: PetAlert): JSX.Element {
  if (alert.severity === 'danger') return <CircleAlert size={15} />
  if (alert.kind === 'agent_completed') return <CheckCircle2 size={15} />
  return <Bell size={15} />
}

function mediaElement(src: string, kind: 'image' | 'video', label: string): JSX.Element | null {
  if (!src) return null
  if (kind === 'video') {
    return <video className="pet-orb__media" src={src} aria-label={label} autoPlay loop muted playsInline />
  }
  return <img className="pet-orb__media" src={src} alt={label} draggable={false} />
}

export function PetApp(): JSX.Element {
  const [state, setState] = useState<PetRuntimeState | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const dragStateRef = useRef<DragState | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const pointerInsideRef = useRef(false)
  const latestPositionRef = useRef({ x: 36, y: 120 })
  const positionRequestRef = useRef(0)

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  useEffect(() => {
    void window.atlas.pet.getState().then((nextState) => {
      latestPositionRef.current = nextState.settings.position
      setState(nextState)
    })

    return window.atlas.pet.onStateUpdated((nextState) => {
      latestPositionRef.current = nextState.settings.position
      setState(nextState)
    })
  }, [])

  useEffect(() => {
    return () => clearCloseTimer()
  }, [clearCloseTimer])

  const alerts = useMemo(() => (state?.alerts ?? []).filter(isVisibleAlert), [state?.alerts])
  const agentSessions = useMemo(
    () => (state?.settings.showRunningAgents ? state.agentSessions.filter((session) => session.status !== 'completed') : []),
    [state]
  )
  const attentionCount = alerts.length + agentSessions.filter((session) => session.status === 'waiting_for_confirmation' || session.status === 'error').length
  const panelSide = state?.window.panelSide ?? 'right'
  const petMedia = state
    ? attentionCount > 0 && state.settings.assetPack.attentionSrc
      ? mediaElement(state.settings.assetPack.attentionSrc, state.settings.assetPack.attentionKind, state.settings.assetPack.name)
      : mediaElement(state.settings.assetPack.idleSrc, state.settings.assetPack.idleKind, state.settings.assetPack.name)
    : null
  const motion = attentionCount > 0 ? state?.settings.actionMap.attention : state?.settings.actionMap.idle

  const setInteractive = useCallback((interactive: boolean) => {
    void window.atlas.pet.setInteractive(interactive).catch(() => undefined)
  }, [])

  const closePanel = useCallback(() => {
    clearCloseTimer()
    setPanelOpen(false)
    setInteractive(false)
  }, [clearCloseTimer, setInteractive])

  const scheduleClosePanel = useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      if (pointerInsideRef.current || dragStateRef.current) return
      closePanel()
    }, PANEL_CLOSE_DELAY_MS)
  }, [clearCloseTimer, closePanel])

  const handlePointerEnter = useCallback(() => {
    pointerInsideRef.current = true
    clearCloseTimer()
    setInteractive(true)
    setPanelOpen(true)
  }, [clearCloseTimer, setInteractive])

  const handlePointerLeave = useCallback(() => {
    pointerInsideRef.current = false
    if (!dragStateRef.current) scheduleClosePanel()
  }, [scheduleClosePanel])

  const openAlert = useCallback(async (alert: PetAlert) => {
    await window.atlas.pet.ackAlert(alert.id)
    await window.atlas.pet.openTarget(alert.target)
    closePanel()
  }, [closePanel])

  const openAgent = useCallback(async (session: PetAgentSession) => {
    await window.atlas.pet.openTarget({
      canvasId: session.canvasId,
      componentId: session.componentId,
      sessionId: session.id
    })
    closePanel()
  }, [closePanel])

  const beginDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    clearCloseTimer()
    setPanelOpen(false)
    setInteractive(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStateRef.current = {
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      startX: latestPositionRef.current.x,
      startY: latestPositionRef.current.y
    }
  }, [clearCloseTimer, setInteractive])

  const moveDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current
    if (!drag) return

    const position = {
      x: Math.round(drag.startX + event.screenX - drag.startScreenX),
      y: Math.round(drag.startY + event.screenY - drag.startScreenY)
    }
    latestPositionRef.current = position
    const requestId = positionRequestRef.current + 1
    positionRequestRef.current = requestId
    void window.atlas.pet
      .setPosition(position)
      .then((savedPosition) => {
        if (positionRequestRef.current !== requestId) return
        latestPositionRef.current = savedPosition
      })
      .catch(() => undefined)
  }, [])

  const endDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (dragStateRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragStateRef.current = null
    if (pointerInsideRef.current) {
      setPanelOpen(true)
      return
    }
    scheduleClosePanel()
  }, [scheduleClosePanel])

  return (
    <main className="pet-shell">
      <div className={`pet-hitbox pet-hitbox--panel-${panelSide}`} onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
        <button
          type="button"
          className={['pet-orb', attentionCount > 0 ? 'pet-orb--attention' : '', motion ? `pet-orb--motion-${motion}` : ''].filter(Boolean).join(' ')}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-label="AtlasOS pet"
        >
          <span className="pet-orb__core">
            {petMedia ?? <MonitorDot size={28} />}
          </span>
          {attentionCount > 0 ? <span className="pet-orb__badge">{attentionCount}</span> : null}
        </button>

        {panelOpen ? (
          <section className="pet-panel" aria-label="AtlasOS pet panel">
            <header className="pet-panel__header">
              <strong>Atlas Pet</strong>
              <span>{state?.bridge.port ? `hooks :${state.bridge.port}` : 'hooks off'}</span>
            </header>

            <div className="pet-panel__section">
              <div className="pet-panel__section-title">Running agents</div>
              {agentSessions.length > 0 ? (
                agentSessions.map((session) => (
                  <button key={session.id} type="button" className="pet-row" onClick={() => void openAgent(session)}>
                    <span className={`pet-row__dot pet-row__dot--${session.status}`} />
                    <span className="pet-row__main">
                      <strong>{sourceLabel(session)}</strong>
                      <span>{session.title}</span>
                      {session.cwd ? <small>{session.cwd}</small> : null}
                    </span>
                    <span className="pet-row__status">{statusLabel(session.status)}</span>
                  </button>
                ))
              ) : (
                <p className="pet-empty">No Codex or Claude sessions.</p>
              )}
            </div>

            <div className="pet-panel__section">
              <div className="pet-panel__section-title">Alerts</div>
              {alerts.length > 0 ? (
                alerts.map((alert) => (
                  <button key={alert.id} type="button" className="pet-row" onClick={() => void openAlert(alert)}>
                    <span className={`pet-row__icon pet-row__icon--${alert.severity}`}>{alertIcon(alert)}</span>
                    <span className="pet-row__main">
                      <strong>{alert.title}</strong>
                      {alert.body ? <span>{alert.body}</span> : null}
                    </span>
                  </button>
                ))
              ) : (
                <p className="pet-empty">Nothing needs attention.</p>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}

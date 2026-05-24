import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { AtlasPluginNodeProps, AtlasRendererPluginApi } from '@atlasos/plugin-sdk'
import { defineNode, definePlugin, readState } from '@atlasos/plugin-sdk'

type Operator = '+' | '-' | '*' | '/'
type CalculatorKeyEvent = {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

type CalculatorState = {
  display: string
  expression: string
  storedValue: number | null
  operator: Operator | null
  waitingForOperand: boolean
}

const DEFAULT_STATE: CalculatorState = {
  display: '0',
  expression: '',
  storedValue: null,
  operator: null,
  waitingForOperand: false
}

const DEFAULT_PRECISION = 12
const OPERATORS = new Set(['+', '-', '*', '/'])
const GLOBAL_KEYBOARD_BLOCKLIST_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[role="textbox"]',
  '.cm-editor',
  '.dialog-content',
  '.popover-content',
  '.menu-content',
  '.top-bar'
].join(',')

function isOperator(value: unknown): value is Operator {
  return typeof value === 'string' && OPERATORS.has(value)
}

function normalizeState(component: AtlasPluginNodeProps<{}, CalculatorState>['component']): CalculatorState {
  const state = readState(component, DEFAULT_STATE)

  return {
    display: typeof state.display === 'string' && state.display ? state.display : DEFAULT_STATE.display,
    expression: typeof state.expression === 'string' ? state.expression : DEFAULT_STATE.expression,
    storedValue: typeof state.storedValue === 'number' && Number.isFinite(state.storedValue) ? state.storedValue : null,
    operator: isOperator(state.operator) ? state.operator : null,
    waitingForOperand: state.waitingForOperand === true
  }
}

function normalizePrecision(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(16, Math.max(4, Math.round(value))) : DEFAULT_PRECISION
}

function formatNumber(value: number, precision = DEFAULT_PRECISION): string {
  if (!Number.isFinite(value)) return 'Error'

  const rounded = Number.parseFloat(value.toPrecision(precision))
  if (Math.abs(rounded) >= 1e12 || (Math.abs(rounded) > 0 && Math.abs(rounded) < 1e-8)) {
    return rounded.toExponential(8).replace(/\.?0+e/, 'e')
  }

  return String(rounded)
}

function calculate(first: number, operator: Operator, second: number, precision: number): string {
  switch (operator) {
    case '+':
      return formatNumber(first + second, precision)
    case '-':
      return formatNumber(first - second, precision)
    case '*':
      return formatNumber(first * second, precision)
    case '/':
      return second === 0 ? 'Error' : formatNumber(first / second, precision)
  }
}

function expressionOperand(value: number, precision: number): string {
  return formatNumber(value, precision)
}

function pendingExpression(state: CalculatorState): string {
  if (!state.expression) return ''
  if (state.operator && !state.waitingForOperand && state.display !== 'Error') return `${state.expression}${state.display}`
  return state.expression
}

function nextDigitState(state: CalculatorState, digit: string): CalculatorState {
  if (state.display === 'Error') {
    return { ...DEFAULT_STATE, display: digit }
  }

  if (state.waitingForOperand) {
    return {
      ...state,
      display: digit,
      expression: state.operator ? state.expression : '',
      waitingForOperand: false
    }
  }

  return {
    ...state,
    display: state.display === '0' ? digit : `${state.display}${digit}`
  }
}

function nextDecimalState(state: CalculatorState): CalculatorState {
  if (state.display === 'Error') {
    return { ...DEFAULT_STATE, display: '0.' }
  }

  if (state.waitingForOperand) {
    return {
      ...state,
      display: '0.',
      expression: state.operator ? state.expression : '',
      waitingForOperand: false
    }
  }

  return state.display.includes('.') ? state : { ...state, display: `${state.display}.` }
}

function nextOperatorState(state: CalculatorState, operator: Operator | '=', precision: number): CalculatorState {
  const inputValue = Number(state.display)

  if (!Number.isFinite(inputValue)) {
    return { ...DEFAULT_STATE, operator: operator === '=' ? null : operator }
  }

  if (state.storedValue === null || state.operator === null) {
    if (operator === '=') {
      return {
        ...state,
        expression: '',
        storedValue: null,
        operator: null,
        waitingForOperand: true
      }
    }

    return {
      ...state,
      storedValue: inputValue,
      operator,
      expression: `${expressionOperand(inputValue, precision)}${operator}`,
      waitingForOperand: true
    }
  }

  if (state.waitingForOperand) {
    if (operator === '=') return state
    return {
      ...state,
      operator,
      expression: `${expressionOperand(state.storedValue, precision)}${operator}`
    }
  }

  const display = calculate(state.storedValue, state.operator, inputValue, precision)
  const result = Number(display)
  const expression = `${expressionOperand(state.storedValue, precision)}${state.operator}${expressionOperand(inputValue, precision)}${
    operator === '=' || !Number.isFinite(result) ? '=' : operator
  }`

  return {
    display,
    storedValue: operator === '=' || !Number.isFinite(result) ? null : result,
    operator: operator === '=' || !Number.isFinite(result) ? null : operator,
    expression: operator === '=' || !Number.isFinite(result) ? expression : `${display}${operator}`,
    waitingForOperand: true
  }
}

function nextButtonState(state: CalculatorState, label: string, precision: number): CalculatorState {
  if (/^\d$/.test(label)) return nextDigitState(state, label)

  if (label === '.') return nextDecimalState(state)
  if (label === 'C') return DEFAULT_STATE
  if (label === '<-') {
    if (state.display === 'Error') return DEFAULT_STATE
    if (state.waitingForOperand) return { ...state, display: '0', expression: state.operator ? state.expression : '', waitingForOperand: false }
    return { ...state, display: state.display.length > 1 ? state.display.slice(0, -1) : '0' }
  }
  if (label === '+/-') {
    if (state.display === '0' || state.display === 'Error') return state
    return { ...state, display: state.display.startsWith('-') ? state.display.slice(1) : `-${state.display}`, expression: state.operator ? state.expression : '' }
  }
  if (label === '%') {
    const value = Number(state.display)
    return Number.isFinite(value) ? { ...state, display: formatNumber(value / 100, precision), expression: state.operator ? state.expression : '' } : state
  }
  if (label === '=') return nextOperatorState(state, '=', precision)
  if (isOperator(label)) return nextOperatorState(state, label, precision)

  return state
}

function keyboardLabel(event: CalculatorKeyEvent): string | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null
  if (/^\d$/.test(event.key)) return event.key

  switch (event.key) {
    case '.':
    case 'Decimal':
      return '.'
    case '+':
    case '-':
    case '*':
    case '/':
    case '%':
      return event.key
    case '=':
    case 'Enter':
      return '='
    case 'Backspace':
      return '<-'
    case 'c':
    case 'C':
      return 'C'
    default:
      return null
  }
}

function shouldIgnoreGlobalKeyboardTarget(target: EventTarget | null, root: HTMLElement | null): boolean {
  if (!(target instanceof Element)) return false
  if (root && target instanceof Node && root.contains(target)) return false

  return Boolean(target.closest(GLOBAL_KEYBOARD_BLOCKLIST_SELECTOR))
}

export const registerPlugin = definePlugin((api: AtlasRendererPluginApi) => {
  const { React } = api
  const h = React.createElement
  const { Calculator } = api.icons
  const styles = {
    root: {
      display: 'grid',
      gridTemplateRows: 'minmax(92px, auto) 1fr',
      gap: '12px',
      height: '100%',
      padding: '12px',
      outline: 0,
      background: 'var(--color-canvas)',
      color: 'var(--color-ink)'
    },
    screen: {
      display: 'grid',
      alignContent: 'end',
      gap: '6px',
      minWidth: 0,
      border: '1px solid var(--color-hairline)',
      borderRadius: 'var(--radius-lg)',
      padding: '12px',
      overflow: 'hidden',
      background: 'var(--color-surface-1)',
      boxShadow: 'var(--edge-highlight)'
    },
    trail: {
      minHeight: '16px',
      overflow: 'hidden',
      color: 'var(--color-ink-tertiary)',
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
      textAlign: 'right',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    display: {
      overflow: 'hidden',
      color: 'var(--color-ink)',
      fontFamily: 'var(--font-mono)',
      fontSize: '32px',
      fontWeight: 600,
      lineHeight: 1.1,
      textAlign: 'right',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    keypad: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gridAutoRows: 'minmax(42px, 1fr)',
      gap: '8px',
      minHeight: 0
    },
    button: {
      minWidth: 0,
      border: '1px solid var(--color-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 0,
      background: 'var(--color-surface-2)',
      color: 'var(--color-ink-muted)',
      font: 'inherit',
      fontSize: '15px',
      fontWeight: 600,
      cursor: 'pointer'
    },
    operation: {
      borderColor: 'rgb(94 106 210 / 42%)',
      background: 'var(--color-primary-soft)',
      color: 'var(--color-primary-hover)'
    },
    equals: {
      borderColor: 'var(--color-primary-hover)',
      background: 'var(--color-primary)',
      color: '#fff'
    }
  } as const

  function CalculatorNode({ component, updateState, isCanvasInteracting = false, isNodeSelected = false }: AtlasPluginNodeProps<{}, CalculatorState>) {
    const rootRef = React.useRef<HTMLDivElement | null>(null)
    const state = normalizeState(component)
    const precision = normalizePrecision(api.plugin.config.precision)
    const trail = pendingExpression(state)
    const labels = ['C', '+/-', '%', '/', '7', '8', '9', '*', '4', '5', '6', '-', '1', '2', '3', '+', '<-', '0', '.', '=']
    const press = React.useCallback((label: string) => {
      updateState(nextButtonState(state, label, precision))
    }, [precision, state, updateState])

    React.useEffect(() => {
      if (!isNodeSelected || isCanvasInteracting) return undefined

      const frame = window.requestAnimationFrame(() => {
        rootRef.current?.focus({ preventScroll: true })
      })

      return () => window.cancelAnimationFrame(frame)
    }, [component.id, isCanvasInteracting, isNodeSelected])

    const handleKeyDownCapture = React.useCallback(
      (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.nativeEvent.isComposing) return
        if (!isNodeSelected || isCanvasInteracting) return

        const label = keyboardLabel(event)
        if (!label) return

        event.preventDefault()
        event.stopPropagation()
        press(label)
      },
      [isCanvasInteracting, isNodeSelected, press]
    )

    React.useEffect(() => {
      if (!isNodeSelected || isCanvasInteracting) return undefined

      const handleWindowKeyDown = (event: KeyboardEvent) => {
        if (event.defaultPrevented || event.isComposing) return
        if (shouldIgnoreGlobalKeyboardTarget(event.target, rootRef.current)) return

        const label = keyboardLabel(event)
        if (!label) return

        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        press(label)
      }

      window.addEventListener('keydown', handleWindowKeyDown, true)
      return () => window.removeEventListener('keydown', handleWindowKeyDown, true)
    }, [isCanvasInteracting, isNodeSelected, press])

    return h(
      'div',
      {
        ref: rootRef,
        style: styles.root,
        tabIndex: -1,
        onKeyDownCapture: handleKeyDownCapture,
        'aria-label': 'Calculator'
      },
      h('div', { style: styles.screen }, h('div', { style: styles.trail }, trail), h('div', { style: styles.display }, state.display)),
      h(
        'div',
        { style: styles.keypad, role: 'group', 'aria-label': 'Calculator keypad' },
        ...labels.map((label) =>
          h(
            'button',
            {
              key: label,
              type: 'button',
              style: {
                ...styles.button,
                ...(OPERATORS.has(label) || label === '%' || label === '+/-' ? styles.operation : {}),
                ...(label === '=' ? styles.equals : {})
              },
              onClick: () => press(label),
              'aria-label': label === '<-' ? 'Backspace' : label
            },
            label
          )
        )
      )
    )
  }

  api.registerNode(
    defineNode<{}, CalculatorState>({
      id: 'calculator',
      icon: Calculator,
      create: () => ({ state: DEFAULT_STATE }),
      getDetail: (component) => normalizeState(component as AtlasPluginNodeProps<{}, CalculatorState>['component']).display,
      getSubtitle: () => null,
      getSearchTokens: () => ['calculator', 'math', 'arithmetic'],
      Renderer: CalculatorNode
    })
  )
})

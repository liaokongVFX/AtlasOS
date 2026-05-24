import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { KanbanComponent } from './kanban-component'
import { createDefaultKanbanState, createKanbanCard, updateKanbanColumn, type KanbanState } from './kanban-model'

const TIMESTAMP = '2026-05-23T00:00:00.000Z'

function createComponent(kanban: KanbanState = createDefaultKanbanState(TIMESTAMP)): CanvasComponent {
  return {
    id: 'kanban-1',
    type: 'kanban',
    title: 'Kanban',
    frame: { x: 0, y: 0, width: 920, height: 620 },
    zIndex: 1,
    config: {},
    state: { kanban },
    bindings: {},
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP
  }
}

function renderKanban(component = createComponent(), updateState = vi.fn()) {
  render(
    <KanbanComponent
      canvasId="canvas-1"
      component={component}
      updateConfig={vi.fn()}
      updateState={updateState}
      setTitle={vi.fn()}
    />
  )

  return updateState
}

function lastKanbanState(updateState: ReturnType<typeof vi.fn>): KanbanState {
  const call = updateState.mock.calls.at(-1)
  expect(call).toBeDefined()
  return call?.[0].kanban as KanbanState
}

describe('KanbanComponent', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders default columns and hydrates missing state', async () => {
    const component = createComponent()
    component.state = {}
    const updateState = renderKanban(component)

    expect(screen.getByText('Backlog')).toBeInTheDocument()
    expect(screen.getByText('Doing')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    await waitFor(() => expect(updateState).toHaveBeenCalledWith(expect.objectContaining({ kanban: expect.any(Object) }), true))
  })

  it('creates a card with advanced fields', async () => {
    const updateState = renderKanban()

    fireEvent.click(screen.getByRole('button', { name: '在 Backlog 添加卡片' }))
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '修复渲染器' } })
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: '拖拽时保持稳定' } })
    fireEvent.pointerDown(screen.getByRole('button', { name: '优先级 无' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '高' }))
    fireEvent.click(screen.getByRole('button', { name: '截止日期 未设置' }))
    fireEvent.change(await screen.findByLabelText('选择截止日期'), { target: { value: '2026-05-24' } })
    fireEvent.change(screen.getByLabelText('负责人'), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'bug, renderer' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    const cards = Object.values(lastKanbanState(updateState).cards)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      title: '修复渲染器',
      description: '拖拽时保持稳定',
      labels: ['bug', 'renderer'],
      priority: 'high',
      assignee: 'Ada',
      dueDate: '2026-05-24'
    })
  })

  it('uses the whole card as the drag/open surface and renders priority colors', () => {
    let state = createDefaultKanbanState(TIMESTAMP)
    state = createKanbanCard(state, 'backlog', 'card-low', { title: 'Priority low', priority: 'low' }, TIMESTAMP)
    state = createKanbanCard(state, 'backlog', 'card-medium', { title: 'Priority medium', priority: 'medium' }, TIMESTAMP)
    state = createKanbanCard(state, 'backlog', 'card-high', { title: 'Priority high', priority: 'high' }, TIMESTAMP)
    state = createKanbanCard(state, 'backlog', 'card-urgent', { title: 'Priority urgent', priority: 'urgent' }, TIMESTAMP)
    renderKanban(createComponent(state))

    expect(screen.getByText('低')).toHaveClass('kanban-priority', 'kanban-priority--low')
    expect(screen.getByText('中')).toHaveClass('kanban-priority', 'kanban-priority--medium')
    expect(screen.getByText('高')).toHaveClass('kanban-priority', 'kanban-priority--high')
    expect(screen.getByText('紧急')).toHaveClass('kanban-priority', 'kanban-priority--urgent')

    const cardShell = screen.getByLabelText('打开或拖拽卡片 Priority high')
    expect(cardShell).toHaveClass('kanban-card-shell')
    expect(cardShell).toHaveAttribute('title', '拖拽卡片；点击打开详情')
    expect(cardShell.querySelector('.kanban-card__grip')).not.toBeInTheDocument()

    fireEvent.click(cardShell)
    expect(screen.getByLabelText('标题')).toHaveValue('Priority high')
  })

  it('edits and deletes an existing card from the detail dialog', () => {
    let state = createDefaultKanbanState(TIMESTAMP)
    state = createKanbanCard(state, 'backlog', 'card-1', { title: 'Fix renderer' }, TIMESTAMP)
    const updateState = renderKanban(createComponent(state))

    fireEvent.click(screen.getByText('Fix renderer'))
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '修复画布拖拽' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(lastKanbanState(updateState).cards['card-1'].title).toBe('修复画布拖拽')

    cleanup()
    const deleteState = renderKanban(createComponent(state))
    fireEvent.click(screen.getByText('Fix renderer'))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(lastKanbanState(deleteState).cards['card-1']).toBeUndefined()
  })

  it('creates and edits columns with WIP limits', async () => {
    const updateState = renderKanban()

    fireEvent.click(screen.getByRole('button', { name: '添加列' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Review' } })
    fireEvent.change(screen.getByLabelText('WIP 限制'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    let nextState = lastKanbanState(updateState)
    const review = nextState.columns.find((column) => column.title === 'Review')
    expect(review).toMatchObject({ title: 'Review', wipLimit: 2 })

    cleanup()
    nextState = updateKanbanColumn(nextState, 'doing', { wipLimit: 1 }, TIMESTAMP)
    const editState = renderKanban(createComponent(nextState))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Doing 设置' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '重命名与限制' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '进行中' } })
    fireEvent.change(screen.getByLabelText('WIP 限制'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(lastKanbanState(editState).columns.find((column) => column.id === 'doing')).toMatchObject({
      title: '进行中',
      wipLimit: 3
    })
  })

  it('updates search and filters in the persisted view', () => {
    let state = createDefaultKanbanState(TIMESTAMP)
    state = createKanbanCard(state, 'backlog', 'card-1', { title: 'Fix renderer', labels: ['bug'], priority: 'high', assignee: 'Ada' }, TIMESTAMP)
    state = createKanbanCard(state, 'backlog', 'card-2', { title: 'Write docs', labels: ['docs'], priority: 'low', assignee: 'Lin' }, TIMESTAMP)
    const updateState = renderKanban(createComponent(state))

    fireEvent.change(screen.getByLabelText('搜索卡片'), { target: { value: 'docs' } })
    expect(lastKanbanState(updateState).view.search).toBe('docs')

    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'bug' }))
    expect(lastKanbanState(updateState).view.labels).toEqual(['bug'])

    fireEvent.click(screen.getByRole('checkbox', { name: 'Ada' }))
    expect(lastKanbanState(updateState).view.assignees).toEqual(['Ada'])

    fireEvent.click(screen.getByRole('checkbox', { name: '高' }))
    expect(lastKanbanState(updateState).view.priorities).toEqual(['high'])
  })

  it('renders the drag preview outside the transformed canvas subtree', async () => {
    let state = createDefaultKanbanState(TIMESTAMP)
    state = createKanbanCard(state, 'doing', 'card-1', { title: 'Fix drag overlay', priority: 'high' }, TIMESTAMP)
    renderKanban(createComponent(state))

    const module = document.body.querySelector('.kanban-module')
    const dragHandle = document.body.querySelector<HTMLElement>('.kanban-card-shell')
    expect(module).toBeInTheDocument()
    expect(dragHandle).toBeInTheDocument()

    await act(async () => {
      fireEvent.mouseDown(dragHandle!, { clientX: 120, clientY: 120, button: 0 })
      fireEvent.mouseMove(document, { clientX: 148, clientY: 158, buttons: 1 })
    })

    await waitFor(() => {
      const overlay = document.body.querySelector('.kanban-drag-overlay')
      expect(overlay).toBeInTheDocument()
      expect(overlay?.querySelector('.kanban-card--overlay')).toHaveTextContent('Fix drag overlay')
      expect(module?.contains(overlay)).toBe(false)
    })

    await act(async () => {
      fireEvent.mouseUp(document)
    })
  })
})

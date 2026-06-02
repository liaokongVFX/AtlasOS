import type { ReactElement } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'

export function TopBarIconTooltip({ children, label }: { children: ReactElement; label: string }): JSX.Element {
  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Content className="tooltip-content">{label}</Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

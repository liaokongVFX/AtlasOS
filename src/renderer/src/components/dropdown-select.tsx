import { useId, type ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../lib/utils'

export type DropdownSelectOption<Value extends string = string> = {
  icon?: ReactNode
  label: string
  value: Value
}

export function DropdownSelect<Value extends string>({
  ariaLabel,
  ariaLabelledBy,
  className,
  disabled,
  menuClassName,
  onChange,
  options,
  value
}: {
  ariaLabel?: string
  ariaLabelledBy?: string
  className?: string
  disabled?: boolean
  menuClassName?: string
  onChange: (value: Value) => void
  options: DropdownSelectOption<Value>[]
  value: Value
}): JSX.Element {
  const valueId = useId()
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn('dropdown-select__trigger', className)}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy ? `${ariaLabelledBy} ${valueId}` : undefined}
        >
          <span id={valueId} className="dropdown-select__value">
            {selectedOption?.icon ? <span className="dropdown-select__icon">{selectedOption.icon}</span> : null}
            <span>{selectedOption?.label ?? ''}</span>
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={cn('menu-content dropdown-select__menu', menuClassName)} align="start" collisionPadding={12}>
          <DropdownMenu.RadioGroup value={value} onValueChange={(nextValue) => onChange(nextValue as Value)}>
            {options.map((option) => {
              const selected = option.value === value

              return (
                <DropdownMenu.RadioItem key={option.value} value={option.value} className={cn('menu-item dropdown-select__option', selected && 'dropdown-select__option--selected')}>
                  <span className="dropdown-select__option-value">
                    {option.icon ? <span className="dropdown-select__icon">{option.icon}</span> : null}
                    <span>{option.label}</span>
                  </span>
                  <span className="dropdown-select__option-check" aria-hidden="true">
                    {selected ? <Check size={13} /> : null}
                  </span>
                </DropdownMenu.RadioItem>
              )
            })}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

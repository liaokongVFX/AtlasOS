import { useId } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown } from 'lucide-react'

export type AiSettingsSelectOption = {
  label: string
  value: string
}

export function AiSettingsSelect({
  label,
  onChange,
  options,
  value
}: {
  label: string
  onChange: (value: string) => void
  options: AiSettingsSelectOption[]
  value: string
}): JSX.Element {
  const labelId = useId()
  const valueId = useId()
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  return (
    <div className="general-settings__field">
      <span id={labelId}>{label}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="ai-settings__menu-trigger" aria-labelledby={`${labelId} ${valueId}`}>
            <span id={valueId}>{selectedOption?.label ?? ''}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu-content ai-settings__menu" align="start" collisionPadding={12}>
            <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
              {options.map((option) => {
                const selected = option.value === value

                return (
                  <DropdownMenu.RadioItem
                    key={option.value}
                    value={option.value}
                    className={['menu-item ai-settings__menu-option', selected ? 'ai-settings__menu-option--selected' : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span>{option.label}</span>
                    <span className="ai-settings__menu-option-check" aria-hidden="true">
                      {selected ? <Check size={13} /> : null}
                    </span>
                  </DropdownMenu.RadioItem>
                )
              })}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

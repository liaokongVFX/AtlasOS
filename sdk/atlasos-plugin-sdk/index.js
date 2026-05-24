export function definePlugin(register) {
  return register
}

export function defineNode(definition) {
  return definition
}

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readConfig(component, defaults) {
  return { ...defaults, ...(isRecord(component?.config) ? component.config : {}) }
}

export function readState(component, defaults) {
  return { ...defaults, ...(isRecord(component?.state) ? component.state : {}) }
}

export function readBindings(component, defaults) {
  return { ...defaults, ...(isRecord(component?.bindings) ? component.bindings : {}) }
}

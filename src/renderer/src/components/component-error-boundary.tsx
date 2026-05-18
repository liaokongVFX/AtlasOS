import { Component, type ErrorInfo, type ReactNode } from 'react'

type ComponentErrorBoundaryProps = {
  children: ReactNode
}

type ComponentErrorBoundaryState = {
  error: Error | null
}

export class ComponentErrorBoundary extends Component<ComponentErrorBoundaryProps, ComponentErrorBoundaryState> {
  state: ComponentErrorBoundaryState = {
    error: null
  }

  static getDerivedStateFromError(error: Error): ComponentErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('AtlasOS component crashed', error, errorInfo)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="component-error">
          <strong>Component failed</strong>
          <span>{this.state.error.message}</span>
        </div>
      )
    }

    return this.props.children
  }
}

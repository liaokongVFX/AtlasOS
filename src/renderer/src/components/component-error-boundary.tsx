import { Component, type ErrorInfo, type ReactNode } from 'react'
import { I18nContext } from '../i18n'

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
        <I18nContext.Consumer>
          {({ t }) => (
            <div className="component-error">
              <strong>{t('component.componentFailed')}</strong>
              <span>{this.state.error?.message}</span>
            </div>
          )}
        </I18nContext.Consumer>
      )
    }

    return this.props.children
  }
}

/// <reference types="vite/client" />

import { Component, type ErrorInfo, type ReactNode } from 'react'

type State = { readonly error: Error | null; readonly componentStack: string }

export class ReaderRootErrorBoundary extends Component<
  { readonly children: ReactNode },
  State
> {
  state: State = { error: null, componentStack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Reader web root render error', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? '' })
  }

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (error === null) return this.props.children
    const showComponentStack = import.meta.env.DEV
    // Stay in fallback until the root is remounted by a new display/reload.
    return (
      <div role='alert' className='reader-root-error'>
        <p>阅读页面渲染发生错误，请截图此信息</p>
        <pre>web-root: {error.message}</pre>
        {showComponentStack && componentStack ? (
          <pre>{componentStack}</pre>
        ) : null}
        <p>请重载 WebView 后重试。</p>
      </div>
    )
  }
}

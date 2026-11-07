import { Component, type ErrorInfo, type ReactNode } from 'react'

declare const __DEV__: boolean

type PdfDrawingErrorBoundaryProps = {
  readonly children: ReactNode
}

type PdfDrawingErrorBoundaryState = {
  readonly error: Error | null
  readonly componentStack: string
}

export class PdfDrawingErrorBoundary extends Component<
  PdfDrawingErrorBoundaryProps,
  PdfDrawingErrorBoundaryState
> {
  state: PdfDrawingErrorBoundaryState = { error: null, componentStack: '' }

  static getDerivedStateFromError(
    error: Error
  ): Partial<PdfDrawingErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = info.componentStack ?? ''
    console.error('PDF drawing layer render error', error, componentStack)
    this.setState({ componentStack })
  }

  render() {
    const { error, componentStack } = this.state
    if (error === null) return this.props.children
    const showComponentStack =
      typeof __DEV__ !== 'undefined'
        ? __DEV__
        : (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true

    // 仅用于诊断：错误后持续显示兜底，只有绘图层卸载并重挂才会重置。
    return (
      <div
        className='hamster-reader__pdf-drawing-error'
        data-testid='pdf-drawing-error'
        role='alert'
      >
        <strong>PDF 绘图层发生错误，请截图此信息</strong>
        <pre data-testid='pdf-drawing-error-message'>{error.message}</pre>
        {componentStack && showComponentStack ? (
          <pre data-testid='pdf-drawing-error-stack'>{componentStack}</pre>
        ) : null}
      </div>
    )
  }
}

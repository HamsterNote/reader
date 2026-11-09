import { Component, type ErrorInfo, type ReactNode } from 'react'
import { SafeAreaView, ScrollView, StyleSheet, Text } from 'react-native'

type State = { readonly error: Error | null; readonly componentStack: string }

export class AppErrorBoundary extends Component<
  { readonly children: ReactNode },
  State
> {
  state: State = { error: null, componentStack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Reader app root render error', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? '' })
  }

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (error === null) return this.props.children
    // Preserve diagnostics until the app is reloaded; no automatic recovery.
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text role='alert' style={styles.title}>
            应用渲染发生错误，请截图此信息
          </Text>
          <Text selectable style={styles.message}>
            app-root: {error.message}
          </Text>
          {__DEV__ && componentStack ? (
            <Text selectable style={styles.message}>
              {componentStack}
            </Text>
          ) : null}
          <Text style={styles.message}>请重新加载应用后重试。</Text>
        </ScrollView>
      </SafeAreaView>
    )
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fffdf8' },
  content: { padding: 24, gap: 12 },
  title: { color: '#b3261e', fontSize: 18, fontWeight: '600' },
  message: { color: '#4d473f', fontSize: 13 }
})

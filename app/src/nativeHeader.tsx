import type { NativeStackHeaderItem } from 'expo-router'
import type { ReactElement, RefObject } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'

import type { PaneId, PaneRecords } from './debug/panes'
import type {
  ReaderScreenHandle,
  ReaderScreenHeaderState
} from './screens/ReaderScreen'

type HeaderStates = Partial<Record<PaneId, ReaderScreenHeaderState>>
type ReaderRefs = Record<PaneId, RefObject<ReaderScreenHandle | null>>
type Navigation = {
  setOptions(options: {
    title: string
    headerBackVisible?: boolean
    headerLargeTitleEnabled?: boolean
    headerLeft?: (() => ReactElement) | undefined
    unstable_headerLeftItems?: () => NativeStackHeaderItem[]
    unstable_headerRightItems?: () => NativeStackHeaderItem[]
    headerRight?: () => ReactElement
  }): void
}

export function resolveReaderHeaderTitle(
  readerOpen: boolean,
  split: boolean,
  panes: PaneRecords,
  focusPane: PaneId,
  headerStates: HeaderStates
): string {
  if (!readerOpen) return '仓鼠阅读'
  if (!split) {
    return headerStates[focusPane]?.title ?? panes[focusPane]!.fileName
  }
  return (['left', 'right'] as const)
    .filter((pane) => panes[pane] !== null)
    .map((pane) => headerStates[pane]?.title ?? panes[pane]!.fileName)
    .join(' / ')
}

function createRightItems(
  readerOpen: boolean,
  headerState: ReaderScreenHeaderState | undefined,
  focusPane: PaneId,
  readerRefs: ReaderRefs
): NativeStackHeaderItem[] {
  if (!readerOpen) return []
  const items: NativeStackHeaderItem[] = []
  if (headerState?.canToggleLayout) {
    items.push({
      type: 'button',
      label: headerState.nativePdf ? 'Text' : 'Layout',
      onPress: () => readerRefs[focusPane].current?.toggleLayout()
    })
    if (__DEV__) {
      items.push({
        type: 'button',
        label: headerState.nativePdf ? 'Web 对照' : '原生 PDF 验证',
        onPress: () => readerRefs[focusPane].current?.toggleDebugRenderer()
      })
    }
  }
  items.push({
    type: 'button',
    label: '导入旧数据',
    disabled: !headerState?.canImportLegacy,
    onPress: () => readerRefs[focusPane].current?.importLegacy()
  })
  return items
}

function AndroidBackButton({
  focusPane,
  readerRefs
}: {
  readonly focusPane: PaneId
  readonly readerRefs: ReaderRefs
}) {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='返回'
      onPress={() => readerRefs[focusPane].current?.close(false)}
    >
      <Text style={styles.nativeHeaderAction}>返回</Text>
    </Pressable>
  )
}

function AndroidHeaderActions({
  headerState,
  focusPane,
  readerRefs
}: {
  readonly headerState: ReaderScreenHeaderState | undefined
  readonly focusPane: PaneId
  readonly readerRefs: ReaderRefs
}) {
  return (
    <View style={styles.nativeHeaderActions}>
      {headerState?.canToggleLayout ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={headerState.nativePdf ? 'Text' : 'Layout'}
          onPress={() => readerRefs[focusPane].current?.toggleLayout()}
        >
          <Text style={styles.nativeHeaderAction}>
            {headerState.nativePdf ? 'Text' : 'Layout'}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='导入旧数据'
        disabled={!headerState?.canImportLegacy}
        onPress={() => readerRefs[focusPane].current?.importLegacy()}
      >
        <Text style={styles.nativeHeaderAction}>导入旧数据</Text>
      </Pressable>
    </View>
  )
}

export function updateReaderNativeHeader({
  navigation,
  readerRefs,
  focusPane,
  headerState,
  readerOpen,
  headerTitle
}: {
  readonly navigation: Navigation
  readonly readerRefs: ReaderRefs
  readonly focusPane: PaneId
  readonly headerState: ReaderScreenHeaderState | undefined
  readonly readerOpen: boolean
  readonly headerTitle: string
}): void {
  const rightItems = createRightItems(
    readerOpen,
    headerState,
    focusPane,
    readerRefs
  )
  navigation.setOptions({
    title: headerTitle,
    headerBackVisible: readerOpen ? false : undefined,
    headerLargeTitleEnabled: !readerOpen,
    headerLeft:
      Platform.OS !== 'ios' && readerOpen
        ? () => (
            <AndroidBackButton focusPane={focusPane} readerRefs={readerRefs} />
          )
        : undefined,
    unstable_headerLeftItems:
      Platform.OS === 'ios' && readerOpen
        ? (): NativeStackHeaderItem[] => [
            {
              type: 'button',
              label: '返回',
              accessibilityLabel: '返回',
              icon: { type: 'sfSymbol', name: 'chevron.left' },
              onPress: () => readerRefs[focusPane].current?.close(false)
            }
          ]
        : undefined,
    unstable_headerRightItems:
      Platform.OS === 'ios' && readerOpen ? () => rightItems : undefined,
    headerRight:
      Platform.OS !== 'ios' && readerOpen
        ? () => (
            <AndroidHeaderActions
              headerState={headerState}
              focusPane={focusPane}
              readerRefs={readerRefs}
            />
          )
        : undefined
  })
}

const styles = StyleSheet.create({
  nativeHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  nativeHeaderAction: { color: '#8b5e3c', fontSize: 13 }
})

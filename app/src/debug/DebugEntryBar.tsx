/**
 * HAM-278 设备取证调试栏（仅 __DEV__ 由 App 挂载）。
 * 提供三项能力：单双栏切换、活动栏切换、阅读中替换配置记录（走同一保存屏障）。
 * release 不渲染本组件。
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import type { HostDocumentSummary } from '../../../src/host/readerDataStore'
import type { PaneId } from './panes'

type DebugEntryBarProps = {
  readonly split: boolean
  readonly activePane: PaneId
  readonly documents: readonly HostDocumentSummary[]
  readonly currentFileId: string
  readonly sourcePickerOpen: boolean
  readonly onToggleSplit: () => void
  readonly onActivatePane: (pane: PaneId) => void
  readonly onToggleSourcePicker: () => void
  readonly onReplaceSource: (document: HostDocumentSummary) => void
  readonly onClose: () => void
}

export function DebugEntryBar({
  split,
  activePane,
  documents,
  currentFileId,
  sourcePickerOpen,
  onToggleSplit,
  onActivatePane,
  onToggleSourcePicker,
  onReplaceSource,
  onClose
}: DebugEntryBarProps) {
  return (
    <View style={styles.bar}>
      <Pressable onPress={onToggleSplit} accessibilityRole='button'>
        <Text style={styles.action}>{split ? '单栏' : '分栏'}</Text>
      </Pressable>
      {split ? (
        <Pressable
          onPress={() =>
            onActivatePane(activePane === 'left' ? 'right' : 'left')
          }
          accessibilityRole='button'
        >
          <Text style={styles.action}>
            活动：{activePane === 'left' ? '左栏' : '右栏'}
          </Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onToggleSourcePicker} accessibilityRole='button'>
        <Text style={styles.action}>换源</Text>
      </Pressable>
      <Text style={styles.hint} numberOfLines={1}>
        调试入口
      </Text>
      <Pressable onPress={onClose} accessibilityRole='button'>
        <Text style={styles.action}>返回书库</Text>
      </Pressable>
      {sourcePickerOpen ? (
        <View style={styles.panel}>
          <Text style={styles.title}>替换配置记录</Text>
          <Text style={styles.hint}>
            选中后按返回书库同一保存屏障关闭旧会话，再以新记录重开。
          </Text>
          <ScrollView style={styles.list}>
            {documents.length === 0 ? (
              <Text style={styles.hint}>书库为空</Text>
            ) : (
              documents.map((document) => (
                <Pressable
                  key={document.fileId}
                  onPress={() => onReplaceSource(document)}
                  accessibilityRole='button'
                >
                  <Text
                    style={[
                      styles.item,
                      document.fileId === currentFileId && styles.currentItem
                    ]}
                  >
                    {document.fileName}
                    {document.fileId === currentFileId ? '（当前）' : ''}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>
          <Pressable onPress={onToggleSourcePicker} accessibilityRole='button'>
            <Text style={styles.action}>取消</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#eee6d8',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d8cebc'
  },
  action: { color: '#8b5e3c', fontSize: 12, fontWeight: '600' },
  hint: { color: '#6d675f', fontSize: 11, flexShrink: 1 },
  panel: {
    position: 'absolute',
    top: 34,
    left: 8,
    right: 8,
    zIndex: 10,
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#fffdf8',
    borderWidth: 1,
    borderColor: '#ddd6ca'
  },
  title: { fontSize: 14, fontWeight: '600', color: '#1f1d1a' },
  list: { maxHeight: 240 },
  item: { paddingVertical: 6, color: '#1f1d1a', fontSize: 13 },
  currentItem: { color: '#8b5e3c' }
})

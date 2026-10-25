import { useCallback } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'

import type { HostDocumentSummary } from '../../../src/host/readerDataStore'

type LibraryScreenProps = {
  readonly documents: readonly HostDocumentSummary[]
  readonly busy: boolean
  readonly onPickDocument: () => void
  readonly onOpenDocument: (summary: HostDocumentSummary) => void
  readonly onRemoveDocument: (summary: HostDocumentSummary) => void
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`
}

export function LibraryScreen({
  documents,
  busy,
  onPickDocument,
  onOpenDocument,
  onRemoveDocument
}: LibraryScreenProps) {
  const renderItem = useCallback(
    ({ item }: { readonly item: HostDocumentSummary }) => (
      <Pressable
        style={styles.card}
        onPress={() => onOpenDocument(item)}
        accessibilityRole='button'
      >
        <View style={styles.cardMain}>
          <Text style={styles.title} numberOfLines={1}>
            {item.fileName}
          </Text>
          <Text style={styles.muted}>
            {item.format.toUpperCase()} · {formatBytes(item.size)}
            {item.legacyImport
              ? ` · 已导入 v${item.legacyImport.version} 旧数据`
              : ''}
          </Text>
        </View>
        <Pressable
          hitSlop={12}
          onPress={() => onRemoveDocument(item)}
          accessibilityLabel={`删除 ${item.fileName}`}
        >
          <Text style={styles.remove}>删除</Text>
        </Pressable>
      </Pressable>
    ),
    [onOpenDocument, onRemoveDocument]
  )

  return (
    <View style={styles.container}>
      <View style={styles.intro}>
        <Text style={styles.heading}>仓鼠阅读</Text>
        <Text style={styles.muted}>
          EPUB / PDF 在本地 WebView 中打开；标注按文件保存在应用内。
        </Text>
      </View>
      <Pressable
        style={[styles.primaryButton, busy && styles.disabled]}
        onPress={onPickDocument}
        disabled={busy}
      >
        <Text style={styles.primaryButtonText}>
          {busy ? '处理中…' : '打开 EPUB / PDF'}
        </Text>
      </Pressable>
      <FlatList
        data={documents}
        keyExtractor={(item) => item.fileId}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>还没有打开过的文件。</Text>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 12, gap: 14 },
  intro: { gap: 4 },
  heading: { fontSize: 26, fontWeight: '700', color: '#1f1d1a' },
  muted: { color: '#6d675f', fontSize: 13 },
  primaryButton: {
    backgroundColor: '#8b5e3c',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center'
  },
  disabled: { opacity: 0.6 },
  primaryButtonText: { color: '#fffdf8', fontWeight: '600' },
  list: { gap: 10, paddingBottom: 32 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#fffdf8',
    borderWidth: 1,
    borderColor: '#ddd6ca'
  },
  cardMain: { flex: 1, gap: 4 },
  title: { fontSize: 16, fontWeight: '600', color: '#1f1d1a' },
  remove: { color: '#b3261e', fontSize: 13 },
  empty: { color: '#6d675f', paddingVertical: 24, textAlign: 'center' }
})

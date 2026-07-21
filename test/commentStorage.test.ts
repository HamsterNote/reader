import { describe, expect, it } from 'vitest'

import {
  HAMSTER_DEMO_COMMENT_STORAGE_VERSION,
  parseComments,
  removeHighlightFromComments,
  serializeComments
} from '../demo/commentStorage'
import type { ReaderComment } from '../src'

const baseComment: ReaderComment = {
  id: 'comment-1',
  highlightIds: ['range-1'],
  content: 'hello comment',
  createdAt: 1000,
  parentId: null
}

describe('demo comment storage', () => {
  it('round-trips v2 comment storage when comments are serialized', () => {
    // Given: 新版扁平评论数组包含根评论与回复。
    const comments: readonly ReaderComment[] = [
      baseComment,
      {
        id: 'reply-1',
        highlightIds: ['range-1'],
        content: 'reply comment',
        createdAt: 1100,
        updatedAt: 1200,
        parentId: 'comment-1'
      }
    ]

    // When: Demo 将其序列化后再解析。
    const raw = serializeComments(comments)
    const stored = JSON.parse(raw)

    // Then: localStorage 外壳使用 v2，评论内容无损恢复。
    expect(stored).toEqual({
      version: HAMSTER_DEMO_COMMENT_STORAGE_VERSION,
      comments
    })
    expect(parseComments(raw)).toEqual(comments)
  })

  it('migrates legacy highlight comment arrays into flat ReaderComment records', () => {
    // Given: 旧版 shape 为 highlightId -> CommentItem[]。
    const raw = JSON.stringify({
      'range-a': [
        { id: 'legacy-a', content: 'legacy note A', createdAt: 1000 }
      ],
      'range-b': [{ id: 'legacy-b', content: 'legacy note B', createdAt: 2000 }]
    })

    // When: 读取旧数据。
    const comments = parseComments(raw)

    // Then: 每条旧评论绑定原 highlightId，成为根评论。
    expect(comments).toEqual([
      {
        id: 'legacy-a',
        highlightIds: ['range-a'],
        content: 'legacy note A',
        createdAt: 1000,
        parentId: null
      },
      {
        id: 'legacy-b',
        highlightIds: ['range-b'],
        content: 'legacy note B',
        createdAt: 2000,
        parentId: null
      }
    ])
  })

  it('migrates legacy plain-string notes into flat ReaderComment records', () => {
    // Given: 更早的旧版 shape 为 highlightId -> string。
    const raw = JSON.stringify({ 'range-a': 'plain note' })

    // When: 读取旧数据。
    const comments = parseComments(raw)

    // Then: 生成一条绑定该高亮的根评论，缺失 ID 由迁移层补齐。
    expect(comments).toHaveLength(1)
    expect(comments[0]).toMatchObject({
      highlightIds: ['range-a'],
      content: 'plain note',
      parentId: null
    })
    expect(typeof comments[0]?.id).toBe('string')
    expect(typeof comments[0]?.createdAt).toBe('number')
  })

  it.each([
    ['invalid JSON', '{ broken json ]'],
    ['empty raw', ''],
    ['bare array', JSON.stringify([])],
    [
      'v2 comments is not an array',
      JSON.stringify({ version: 2, comments: {} })
    ],
    ['garbage record', JSON.stringify({ nope: 123 })]
  ])('returns [] without throwing for %s', (_label, raw) => {
    // Given/When/Then: 损坏或未知结构都不能让 Demo 启动失败。
    expect(() => parseComments(raw)).not.toThrow()
    expect(parseComments(raw)).toEqual([])
  })

  it('removes a deleted highlight binding and cascades zero-bound comment replies', () => {
    // Given: 一个单绑定根评论有回复；另一个评论同时绑定两个高亮。
    const comments: readonly ReaderComment[] = [
      {
        id: 'single-root',
        highlightIds: ['range-a'],
        content: 'single root',
        createdAt: 1000,
        parentId: null
      },
      {
        id: 'reply-under-single-root',
        highlightIds: ['range-b'],
        content: 'reply should cascade',
        createdAt: 1100,
        parentId: 'single-root'
      },
      {
        id: 'multi-bound',
        highlightIds: ['range-a', 'range-b'],
        content: 'multi survives',
        createdAt: 1200,
        parentId: null
      },
      {
        id: 'other-root',
        highlightIds: ['range-b'],
        content: 'other survives',
        createdAt: 1300,
        parentId: null
      }
    ]

    // When: 显式删除 range-a。
    const next = removeHighlightFromComments(comments, 'range-a')

    // Then: 单绑定根评论及其回复子树删除，多绑定评论仅移除 range-a。
    expect(next).toEqual([
      {
        id: 'multi-bound',
        highlightIds: ['range-b'],
        content: 'multi survives',
        createdAt: 1200,
        parentId: null
      },
      {
        id: 'other-root',
        highlightIds: ['range-b'],
        content: 'other survives',
        createdAt: 1300,
        parentId: null
      }
    ])
  })
})

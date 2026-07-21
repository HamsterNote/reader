import { describe, expect, it } from 'vitest'

import {
  buildReaderCommentTree,
  getCommentCountByHighlightId,
  getCommentsByHighlightId,
  type ReaderComment
} from '../src'

const comments = [
  {
    id: 'late-root',
    highlightIds: ['h1'],
    content: '较晚根评论',
    createdAt: 30,
    parentId: null
  },
  {
    id: 'early-root',
    highlightIds: ['h1', 'h2'],
    content: '较早根评论',
    createdAt: 10,
    parentId: null
  },
  {
    id: 'same-time-root',
    highlightIds: ['h1'],
    content: '同时间根评论',
    createdAt: 10,
    parentId: null
  },
  {
    id: 'reply',
    highlightIds: ['h2'],
    content: '回复也计数',
    createdAt: 20,
    parentId: 'early-root'
  }
] satisfies readonly ReaderComment[]

describe('reader comment helpers', () => {
  it('filters comments by highlight id with createdAt ordering when comments are unsorted', () => {
    // Given: 多条评论绑定到同一个高亮，其中输入顺序与创建时间不一致。
    const input = comments

    // When: 按高亮 ID 查询评论列表。
    const result = getCommentsByHighlightId(input, 'h1')

    // Then: 只返回绑定 h1 的评论，并按 createdAt 升序；同一时间保持原始顺序。
    expect(result.map((comment) => comment.id)).toEqual([
      'early-root',
      'same-time-root',
      'late-root'
    ])
  })

  it('includes a multi-highlight comment in every matching highlight query', () => {
    // Given: 同一条评论同时绑定 h1 与 h2。
    const input = comments

    // When: 分别查询两个高亮 ID。
    const h1Result = getCommentsByHighlightId(input, 'h1')
    const h2Result = getCommentsByHighlightId(input, 'h2')

    // Then: 该评论会出现在每个绑定高亮的查询结果中。
    expect(h1Result.map((comment) => comment.id)).toContain('early-root')
    expect(h2Result.map((comment) => comment.id)).toContain('early-root')
  })

  it('counts every highlight binding once per comment including replies', () => {
    // Given: 评论与回复都可以绑定一个或多个高亮。
    const input = comments

    // When: 统计每个高亮 ID 的评论数量。
    const result = getCommentCountByHighlightId(input)

    // Then: 多高亮评论分别计入每个高亮，回复只要绑定也计数。
    expect(result).toEqual({
      h1: 3,
      h2: 2
    })
  })

  it('builds nested comment trees with sorted siblings and orphan roots', () => {
    // Given: 输入包含根评论、回复、同级排序冲突，以及 parentId 缺失的孤儿评论。
    const input = [
      {
        id: 'root-b',
        highlightIds: ['h1'],
        content: 'root b',
        createdAt: 30,
        parentId: null
      },
      {
        id: 'reply-late',
        highlightIds: ['h1'],
        content: 'reply late',
        createdAt: 25,
        parentId: 'root-a'
      },
      {
        id: 'orphan',
        highlightIds: ['h3'],
        content: 'orphan',
        createdAt: 5,
        parentId: 'missing-parent'
      },
      {
        id: 'root-a',
        highlightIds: ['h1'],
        content: 'root a',
        createdAt: 10,
        parentId: null
      },
      {
        id: 'reply-early',
        highlightIds: ['h2'],
        content: 'reply early',
        createdAt: 20,
        parentId: 'root-a'
      },
      {
        id: 'reply-same-time',
        highlightIds: ['h2'],
        content: 'reply same time',
        createdAt: 20,
        parentId: 'root-a'
      }
    ] satisfies readonly ReaderComment[]

    // When: 构建递归评论树。
    const result = buildReaderCommentTree(input)

    // Then: 孤儿回退为根，根与回复同级都按 createdAt 升序且同时间稳定排序。
    expect(result.map((comment) => comment.id)).toEqual([
      'orphan',
      'root-a',
      'root-b'
    ])
    expect(result[1]?.replies.map((comment) => comment.id)).toEqual([
      'reply-early',
      'reply-same-time',
      'reply-late'
    ])
  })

  it('returns an empty tree when there are no comments', () => {
    // Given: 没有任何评论。
    const input = [] satisfies readonly ReaderComment[]

    // When: 构建评论树。
    const result = buildReaderCommentTree(input)

    // Then: 返回空数组。
    expect(result).toEqual([])
  })
})

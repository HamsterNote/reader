import { describe, expect, it } from 'vitest'
import { createNativeCommentController } from '../../src/nativePdf/commentController'
import type { ReaderComment } from '../../src/types/comments'

const root: ReaderComment = {
  id: 'root',
  highlightIds: ['range-1'],
  content: 'root',
  createdAt: 1,
  parentId: null
}

describe('native comment controller', () => {
  it('supports add, reply, edit, bind and subtree delete with commit deduplication', () => {
    const controller = createNativeCommentController([root])
    const reply: ReaderComment = {
      id: 'reply',
      highlightIds: ['range-1'],
      content: 'reply',
      createdAt: 2,
      parentId: 'root'
    }
    expect(controller.add('add', reply).status).toBe('changed')
    expect(controller.add('add', reply).status).toBe('duplicate')
    expect(
      controller.update('edit', { ...root, content: 'edited', updatedAt: 3 })
        .status
    ).toBe('changed')
    expect(controller.bind('bind', 'root', ['range-2', 'range-2']).status).toBe(
      'changed'
    )
    expect(controller.remove('delete', 'root').comments).toEqual([])
  })

  it('removes a deleted highlight binding without touching other threads', () => {
    const controller = createNativeCommentController([
      root,
      {
        id: 'other',
        highlightIds: ['range-2'],
        content: 'other',
        createdAt: 2,
        parentId: null
      }
    ])
    const result = controller.removeHighlight('unbind', 'range-1')
    expect(result.comments).toEqual([
      {
        id: 'other',
        highlightIds: ['range-2'],
        content: 'other',
        createdAt: 2,
        parentId: null
      }
    ])
  })
})

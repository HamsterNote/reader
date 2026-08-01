import {
  buildReaderCommentTree,
  type ReaderComment,
  type ReaderCommentThreadNode,
  type ReaderSelectionRange
} from '@hamster-note/reader'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { removeCommentSubtree } from './commentStorage'

// 评论 ID 生成：优先 crypto.randomUUID，回退到时间戳+计数器
let fallbackCommentIdCounter = 0

function generateCommentId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  fallbackCommentIdCounter += 1
  return `comment-${Date.now()}-${fallbackCommentIdCounter}`
}

// 格式化评论时间为中文短日期格式
function formatCommentTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 创建一条新评论（支持多高亮绑定和父评论引用）
function createComment(
  highlightIds: readonly string[],
  content: string,
  parentId: string | null
): ReaderComment {
  return {
    id: generateCommentId(),
    highlightIds: Array.from(highlightIds),
    content: content.trim(),
    createdAt: Date.now(),
    parentId
  }
}

export interface CommentPanelProps {
  comments: readonly ReaderComment[]
  ranges: readonly ReaderSelectionRange[]
  activeHighlightId: string | null
  onCommentsChange: (next: readonly ReaderComment[]) => void
  onJumpToHighlight: (highlightId: string) => void
  onClose: () => void
}

export function CommentPanel({
  comments,
  ranges,
  activeHighlightId,
  onCommentsChange,
  onJumpToHighlight,
  onClose
}: CommentPanelProps) {
  // --- 撰写新评论状态 ---
  const [composeDraft, setComposeDraft] = useState('')
  const [composeHighlightIds, setComposeHighlightIds] = useState<string[]>(
    activeHighlightId ? [activeHighlightId] : []
  )

  // --- 回复状态 ---
  const [replyToId, setReplyToId] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')

  // --- 编辑状态 ---
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  // activeHighlightId 变化时重置撰写区高亮绑定
  useEffect(() => {
    if (activeHighlightId) {
      setComposeHighlightIds([activeHighlightId])
    }
  }, [activeHighlightId])

  // 构建评论树用于线程化展示
  const thread = useMemo(() => buildReaderCommentTree(comments), [comments])

  // 高亮 range 查找表（chip 渲染用）
  const rangeMap = useMemo(() => {
    const map = new Map<string, ReaderSelectionRange>()
    for (const range of ranges) {
      map.set(range.id, range)
    }
    return map
  }, [ranges])

  // 撰写区高亮勾选切换
  const toggleComposeHighlight = useCallback((highlightId: string) => {
    setComposeHighlightIds((prev) =>
      prev.includes(highlightId)
        ? prev.filter((id) => id !== highlightId)
        : [...prev, highlightId]
    )
  }, [])

  // 添加新评论
  const handleAddComment = useCallback(() => {
    const trimmed = composeDraft.trim()
    if (trimmed === '' || composeHighlightIds.length === 0) return
    const newComment = createComment(composeHighlightIds, trimmed, null)
    onCommentsChange([...comments, newComment])
    setComposeDraft('')
  }, [composeDraft, composeHighlightIds, comments, onCommentsChange])

  // 开始回复某条评论
  const handleStartReply = useCallback((commentId: string) => {
    setReplyToId(commentId)
    setReplyDraft('')
  }, [])

  // 发送回复（继承父评论的高亮绑定）
  const handleSendReply = useCallback(() => {
    if (!replyToId) return
    const trimmed = replyDraft.trim()
    if (trimmed === '') return
    const parent = comments.find((c) => c.id === replyToId)
    if (!parent) return
    const newReply = createComment(parent.highlightIds, trimmed, replyToId)
    onCommentsChange([...comments, newReply])
    setReplyToId(null)
    setReplyDraft('')
  }, [replyToId, replyDraft, comments, onCommentsChange])

  const handleCancelReply = useCallback(() => {
    setReplyToId(null)
    setReplyDraft('')
  }, [])

  // 开始编辑某条评论
  const handleStartEdit = useCallback((comment: ReaderComment) => {
    setEditingId(comment.id)
    setEditDraft(comment.content)
  }, [])

  // 保存编辑（设置 updatedAt）
  const handleSaveEdit = useCallback(() => {
    if (!editingId) return
    const trimmed = editDraft.trim()
    if (trimmed === '') return
    const updated = comments.map((c) =>
      c.id === editingId ? { ...c, content: trimmed, updatedAt: Date.now() } : c
    )
    onCommentsChange(updated)
    setEditingId(null)
    setEditDraft('')
  }, [editingId, editDraft, comments, onCommentsChange])

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
    setEditDraft('')
  }, [])

  // 删除评论及其所有子回复
  const handleDelete = useCallback(
    (commentId: string) => {
      onCommentsChange(removeCommentSubtree(comments, commentId))
    },
    [comments, onCommentsChange]
  )

  // 递归渲染评论节点（子评论嵌套在父评论 div 内）
  function renderNode(node: ReaderCommentThreadNode, depth: number) {
    const isReplying = replyToId === node.id
    const isEditing = editingId === node.id

    return (
      <div
        key={node.id}
        data-testid={`comment-item-${node.id}`}
        style={{ marginLeft: depth * 20 }}
      >
        {isEditing ? (
          <>
            <textarea
              aria-label='编辑内容'
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
            />
            <button type='button' onClick={handleSaveEdit}>
              保存
            </button>
            <button type='button' onClick={handleCancelEdit}>
              取消
            </button>
          </>
        ) : (
          <>
            <div>
              <span>{node.content}</span>
              {node.updatedAt !== undefined && (
                <span> (已编辑 {formatCommentTime(node.updatedAt)})</span>
              )}
            </div>
            <div>{formatCommentTime(node.createdAt)}</div>
            {/* 高亮 chips：点击跳转到对应高亮 */}
            <div>
              {node.highlightIds.map((hid) => {
                const range = rangeMap.get(hid)
                if (!range) return null
                return (
                  <button
                    key={hid}
                    type='button'
                    data-testid={`comment-chip-${hid}`}
                    onClick={() => onJumpToHighlight(hid)}
                  >
                    {range.text}
                  </button>
                )
              })}
            </div>
            {/* 操作按钮 */}
            <button type='button' onClick={() => handleStartReply(node.id)}>
              回复
            </button>
            <button type='button' onClick={() => handleStartEdit(node)}>
              编辑
            </button>
            <button type='button' onClick={() => handleDelete(node.id)}>
              删除
            </button>
          </>
        )}
        {/* 回复表单 */}
        {isReplying && (
          <div>
            <textarea
              aria-label='回复内容'
              value={replyDraft}
              onChange={(e) => setReplyDraft(e.target.value)}
            />
            <button type='button' onClick={handleSendReply}>
              发送回复
            </button>
            <button type='button' onClick={handleCancelReply}>
              取消
            </button>
          </div>
        )}
        {/* 递归渲染子评论 */}
        {node.replies.map((reply) => renderNode(reply, depth + 1))}
      </div>
    )
  }

  return (
    <aside
      data-testid='comment-panel'
      className='hamster-demo-comment-panel'
      role='dialog'
      aria-modal='true'
      style={{
        position: 'fixed',
        right: '24px',
        bottom: '24px',
        zIndex: 1000,
        width: 'min(360px, calc(100vw - 48px))',
        maxHeight: '60vh',
        overflowY: 'auto',
        boxSizing: 'border-box',
        padding: '20px',
        border: '1px solid #cbd5e1',
        borderRadius: '12px',
        background: '#fff',
        boxShadow: '0 20px 48px rgba(15, 23, 42, 0.2)'
      }}
    >
      {/* 面板头部：评论数 + 关闭按钮 */}
      <div data-testid='comment-panel-header'>
        <span>评论 ({comments.length})</span>
        <button type='button' onClick={onClose}>
          关闭评论
        </button>
      </div>

      {/* 高亮勾选列表：选择评论绑定的高亮 */}
      <div>
        {ranges.map((range) => (
          <label key={range.id}>
            <input
              type='checkbox'
              checked={composeHighlightIds.includes(range.id)}
              onChange={() => toggleComposeHighlight(range.id)}
            />
            {range.text}
          </label>
        ))}
      </div>

      {/* 撰写区 */}
      <div>
        <textarea
          aria-label='评论内容'
          value={composeDraft}
          onChange={(e) => setComposeDraft(e.target.value)}
          placeholder='输入新评论…'
        />
        <button type='button' onClick={handleAddComment}>
          添加评论
        </button>
      </div>

      {/* 评论列表 / 空状态 */}
      <div>
        {comments.length === 0 ? (
          <p>暂无评论</p>
        ) : (
          thread.map((node) => renderNode(node, 0))
        )}
      </div>
    </aside>
  )
}

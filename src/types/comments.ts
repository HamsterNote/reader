/** Reader 公开评论数据。 */
export type ReaderComment = {
  /** 评论唯一 ID。 */
  readonly id: string
  /** 评论绑定的高亮 ID 列表；一条评论可绑定多个高亮。 */
  readonly highlightIds: readonly string[]
  /** 评论正文内容。 */
  readonly content: string
  /** 评论创建时间戳。 */
  readonly createdAt: number
  /** 评论最后更新时间戳；未更新时为空。 */
  readonly updatedAt?: number
  /** 父评论 ID；根评论为 null。 */
  readonly parentId: string | null
}

/** Reader 公开评论变更来源。 */
export type ReaderCommentChangeSource =
  | 'add'
  | 'reply'
  | 'update'
  | 'delete'
  | 'bind-highlights'
  | 'external-sync'

/** Reader 公开评论变更详情。 */
export type ReaderCommentChangeDetail = {
  /** 本次评论变更的来源。 */
  readonly source: ReaderCommentChangeSource
  /** 本次变更涉及的评论 ID。 */
  readonly commentId?: string
  /** 本次变更涉及的父评论 ID；根评论为 null。 */
  readonly parentId?: string | null
  /** 本次变更涉及的高亮 ID 列表。 */
  readonly highlightIds?: readonly string[]
}

/** Reader 评论树节点，包含递归回复列表。 */
export type ReaderCommentThreadNode = ReaderComment & {
  /** 当前评论的回复节点列表。 */
  readonly replies: readonly ReaderCommentThreadNode[]
}

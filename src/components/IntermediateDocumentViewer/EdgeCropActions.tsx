type EdgeCropActionsProps = {
  readonly canHidePage: boolean
  readonly onApplyPage: () => void
  readonly onApplyAll: () => void
  readonly onHidePage: () => void
}

export function EdgeCropActions(props: EdgeCropActionsProps) {
  return (
    <div
      className='hamster-reader__edge-crop-actions'
      data-edge-crop-action='true'
    >
      <button
        type='button'
        className='hamster-reader__edge-crop-action hamster-reader__edge-crop-action--page'
        data-testid='edge-crop-apply-page'
        onClick={props.onApplyPage}
      >
        应用到当前页
      </button>
      <button
        type='button'
        className='hamster-reader__edge-crop-action hamster-reader__edge-crop-action--all'
        data-testid='edge-crop-apply-all'
        onClick={props.onApplyAll}
      >
        应用到全部
      </button>
      <button
        type='button'
        className='hamster-reader__edge-crop-action hamster-reader__edge-crop-action--hide'
        data-testid='edge-crop-hide-page'
        disabled={!props.canHidePage}
        onClick={props.onHidePage}
      >
        隐藏当前页
      </button>
    </div>
  )
}

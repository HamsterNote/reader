import { memo, useEffect, useRef } from 'react'

import {
  getReaderImageAlt,
  type ReaderIntermediateImage
} from './intermediateImage'

export type IntermediateDocumentFlowImageContentProps = {
  images: ReaderIntermediateImage[]
  onImageSettled?: (imageId: string) => void
}

type FlowImageProps = {
  image: ReaderIntermediateImage
  onSettled?: (imageId: string) => void
}

function FlowImage({ image, onSettled }: FlowImageProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const settledRef = useRef(false)
  const settle = () => {
    if (settledRef.current) return
    settledRef.current = true
    if (imageRef.current) imageRef.current.dataset.imageSettled = 'true'
    onSettled?.(image.id)
  }

  useEffect(() => {
    if (imageRef.current?.complete) settle()
  })

  const alt = getReaderImageAlt(image) ?? ''
  return (
    <figure
      className='hamster-reader__intermediate-flow-image'
      data-image-id={image.id}
    >
      <img
        ref={imageRef}
        src={image.src}
        alt={alt}
        onLoad={settle}
        onError={settle}
      />
      {alt ? <figcaption>{alt}</figcaption> : null}
    </figure>
  )
}

function IntermediateDocumentFlowImageContentComponent({
  images,
  onImageSettled
}: IntermediateDocumentFlowImageContentProps) {
  return images.map((image) => (
    <FlowImage key={image.id} image={image} onSettled={onImageSettled} />
  ))
}

export const IntermediateDocumentFlowImageContent = memo(
  IntermediateDocumentFlowImageContentComponent
)

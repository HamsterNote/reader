import { memo } from 'react'

import {
  getReaderImageAlt,
  type ReaderIntermediateImage
} from './intermediateImage'

export type IntermediateDocumentFlowImageContentProps = {
  images: ReaderIntermediateImage[]
}

function IntermediateDocumentFlowImageContentComponent({
  images
}: IntermediateDocumentFlowImageContentProps) {
  return images.map((image) => {
    const alt = getReaderImageAlt(image) ?? ''

    return (
      <figure
        key={image.id}
        className='hamster-reader__intermediate-flow-image'
        data-image-id={image.id}
      >
        <img src={image.src} alt={alt} />
        {alt ? <figcaption aria-hidden='true' data-caption={alt} /> : null}
      </figure>
    )
  })
}

export const IntermediateDocumentFlowImageContent = memo(
  IntermediateDocumentFlowImageContentComponent
)

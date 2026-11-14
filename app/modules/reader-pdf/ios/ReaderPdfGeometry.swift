import Foundation

// Foundation only: this is the production geometry, also compiled by the Linux tests.
struct ReaderPdfPageMetrics {
  let number: Int
  let size: CGSize
  var crop: [String: Double] = [:]

  static func visualSize(_ size: CGSize, rotation: Int) -> CGSize {
    abs(rotation % 180) == 90 ? CGSize(width: size.height, height: size.width) : size
  }
}

struct ReaderPdfLayout {
  let frames: [Int: CGRect]
  let slots: [Int: CGRect]
  let size: CGSize

  init(pages: [ReaderPdfPageMetrics]) {
    var frames: [Int: CGRect] = [:], slots: [Int: CGRect] = [:]
    var bottom: CGFloat = 0, width: CGFloat = 0
    for page in pages {
      let size = page.size, crop = page.crop
      let l = CGFloat(crop["left"] ?? 0), r = CGFloat(crop["right"] ?? 0)
      let t = CGFloat(crop["top"] ?? 0), b = CGFloat(crop["bottom"] ?? 0)
      let y = slots.isEmpty ? 0 : bottom + 12
      let slot = CGRect(x: 0, y: y, width: size.width * (1-l-r), height: size.height * (1-t-b))
      slots[page.number] = slot
      frames[page.number] = CGRect(x: -l * size.width, y: y-t * size.height, width: size.width, height: size.height)
      bottom = slot.maxY; width = max(width, slot.width)
    }
    self.frames = frames; self.slots = slots
    size = CGSize(width: width, height: bottom)
  }
}

struct ReaderPdfViewport {
  let scale: CGFloat
  // Measured in UIScrollView coordinates, not inferred from content.bounds.
  let contentOrigin: CGPoint
  let contentSize: CGSize
  let size: CGSize
  let offset: CGPoint
  let finalSlot: CGRect?

  // The sole scale-one -> scroll-coordinate conversion. Viewport coordinates
  // are scroll coordinates minus contentOffset; page crops stay in scale-one.
  func scrollPoint(_ point: CGPoint) -> CGPoint {
    CGPoint(x: contentOrigin.x + point.x * scale, y: contentOrigin.y + point.y * scale)
  }

  func viewportRect(_ rect: CGRect) -> CGRect {
    let start = scrollPoint(rect.origin)
    let end = scrollPoint(CGPoint(x: rect.maxX, y: rect.maxY))
    return CGRect(x: start.x-offset.x, y: start.y-offset.y, width: end.x-start.x, height: end.y-start.y)
  }

  func contentPoint(at point: CGPoint) -> CGPoint {
    CGPoint(x: (point.x+offset.x-contentOrigin.x)/scale, y: (point.y+offset.y-contentOrigin.y)/scale)
  }

  var center: CGPoint { CGPoint(x: size.width/2, y: size.height/2) }

  // Tail is a viewport-space inset, never part of the zoom view's bounds.
  // A single short page fills the viewport but gains no scrollable blank area.
  var bottomInset: CGFloat {
    guard let slot = finalSlot else { return 0 }
    return max(0, size.height - viewportRect(slot).height)
  }

  func clampedOffset(_ point: CGPoint) -> CGPoint {
    CGPoint(x: min(max(0, point.x), max(0, contentSize.width-size.width)),
            y: min(max(0, point.y), max(0, contentSize.height+bottomInset-size.height)))
  }

  func offset(keeping point: CGPoint, at anchor: CGPoint) -> CGPoint {
    let projected = scrollPoint(point)
    return clampedOffset(CGPoint(x: projected.x-anchor.x, y: projected.y-anchor.y))
  }

  func page(atTopOf slots: [(number: Int, rect: CGRect)]) -> Int? {
    // A short page at 50% must remain current when navigation aligns its top,
    // even if the viewport center already falls on a later page. Gaps belong
    // to the following page; the final tail belongs to the final page.
    slots.first { scrollPoint(CGPoint(x: 0, y: $0.rect.maxY)).y > offset.y + 0.000001 }?.number
      ?? slots.last?.number
  }
}

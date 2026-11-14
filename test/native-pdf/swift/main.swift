import Foundation
import XCTest

final class ReaderPdfGeometryTests: XCTestCase {
  let zooms: [CGFloat] = [0.5, 1, 2]
  let screen = CGSize(width: 402, height: 679.33331298828125)

  func layout(cropped: Bool = false) -> ReaderPdfLayout {
    ReaderPdfLayout(pages: (cropped ? [1, 200] : [1, 2]).map {
      ReaderPdfPageMetrics(number: $0, size: CGSize(width: 400, height: 500),
                           crop: cropped ? ["left": 0.05, "right": 0.05, "top": 0.1, "bottom": 0.1] : [:])
    })
  }

  // UIKit supplies these scaled extents in production. Its view mutations and
  // callback order require the separate Mac checks, not this numerical fixture.
  func viewport(_ layout: ReaderPdfLayout, _ zoom: CGFloat, offset: CGPoint = .zero,
                size: CGSize? = nil, origin: CGPoint = .zero) -> ReaderPdfViewport {
    ReaderPdfViewport(scale: zoom, contentOrigin: origin,
                      contentSize: CGSize(width: layout.size.width * zoom, height: layout.size.height * zoom),
                      size: size ?? screen, offset: offset, finalSlot: layout.slots.keys.max().flatMap { layout.slots[$0] })
  }

  func assertPoint(_ actual: CGPoint, _ expected: CGPoint, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertEqual(actual.x, expected.x, accuracy: 0.000001, file: file, line: line)
    XCTAssertEqual(actual.y, expected.y, accuracy: 0.000001, file: file, line: line)
  }

  func testS02PageNavigationAtEveryZoom() {
    let document = layout()
    XCTAssertEqual(document.size, CGSize(width: 400, height: 1012))
    for (zoom, expected) in zip(zooms, [CGFloat(256), 512, 1024]) {
      let initial = viewport(document, zoom)
      let last = initial.offset(keeping: document.slots[2]!.origin, at: .zero)
      assertPoint(last, CGPoint(x: 0, y: expected))
      let navigated = viewport(document, zoom, offset: last)
      XCTAssertEqual(navigated.viewportRect(document.slots[2]!).minY, 0, accuracy: 0.000001)
      XCTAssertLessThan(navigated.viewportRect(document.slots[1]!).maxY, 0)
      XCTAssertEqual(navigated.page(atTopOf: [(1, document.slots[1]!), (2, document.slots[2]!)]), 2)
      assertPoint(navigated.offset(keeping: .zero, at: .zero), .zero)
      XCTAssertEqual(initial.page(atTopOf: [(1, document.slots[1]!), (2, document.slots[2]!)]), 1)
    }
  }

  func testS08HiddenCroppedPagesAtEveryZoom() {
    let document = layout(cropped: true)
    XCTAssertEqual(Set(document.slots.keys), [1, 200])
    XCTAssertEqual(document.size.width, 360, accuracy: 0.000001)
    XCTAssertEqual(document.size.height, 812)
    XCTAssertEqual(document.frames[200]?.minY, 362)
    for (zoom, expected) in zip(zooms, [CGFloat(206), 412, 824]) {
      let initial = viewport(document, zoom)
      let last = initial.offset(keeping: document.slots[200]!.origin, at: .zero)
      assertPoint(last, CGPoint(x: 0, y: expected))
      let navigated = viewport(document, zoom, offset: last)
      XCTAssertEqual(navigated.viewportRect(document.slots[200]!).minY, 0, accuracy: 0.000001)
      XCTAssertEqual(navigated.page(atTopOf: [(1, document.slots[1]!), (200, document.slots[200]!)]), 200)
      XCTAssertEqual(initial.page(atTopOf: [(1, document.slots[1]!), (200, document.slots[200]!)]), 1)
      assertPoint(navigated.offset(keeping: .zero, at: .zero), .zero)
    }
  }

  func testObservedS08NegativeFrameExplains406PointDrift() {
    let document = layout(cropped: true)
    let offset = CGPoint(x: 0, y: 824)
    let broken = viewport(document, 2, offset: offset, origin: CGPoint(x: -180, y: -406))
    XCTAssertEqual(broken.viewportRect(document.slots[200]!).minY, -406)
    // The fixed layout keeps the UIKit-owned content origin at zero.
    let fixed = viewport(document, 2, offset: offset)
    XCTAssertEqual(fixed.viewportRect(document.slots[200]!).minY, 0)
    XCTAssertEqual(fixed.bottomInset, 0)
    XCTAssertEqual(fixed.contentSize.height, 1624)
  }

  func testBottomInsetAllowsOnlyNecessaryTail() {
    for cropped in [false, true] {
      let document = layout(cropped: cropped)
      let final = document.slots[cropped ? 200 : 2]!
      for zoom in zooms {
        let initial = viewport(document, zoom)
        let maximum = initial.clampedOffset(CGPoint(x: 1_000_000, y: 1_000_000))
        let atBottom = viewport(document, zoom, offset: maximum)
        let last = atBottom.viewportRect(final)
        XCTAssertGreaterThanOrEqual(last.height, screen.height - initial.bottomInset - 0.000001)
        XCTAssertEqual(last.maxY + initial.bottomInset, screen.height, accuracy: 0.000001)
        if initial.bottomInset > 0 {
          XCTAssertEqual(last.minY, 0, accuracy: 0.000001)
          XCTAssertEqual(maximum.y, initial.scrollPoint(final.origin).y, accuracy: 0.000001)
        } else {
          XCTAssertLessThan(last.minY, 0)
        }
        assertPoint(initial.clampedOffset(CGPoint(x: -100, y: -100)), .zero)
      }
    }
  }

  func testSingleShortPageAndEmptyDocumentCannotScrollIntoBlankSpace() {
    let single = ReaderPdfLayout(pages: [ReaderPdfPageMetrics(number: 7, size: CGSize(width: 100, height: 120))])
    let empty = ReaderPdfLayout(pages: [])
    XCTAssertEqual(empty.size, .zero)
    for zoom in zooms {
      for document in [single, empty] {
        let view = viewport(document, zoom)
        assertPoint(view.clampedOffset(CGPoint(x: 5000, y: 5000)), .zero)
        assertPoint(view.offset(keeping: .zero, at: .zero), .zero)
      }
      XCTAssertEqual(viewport(empty, zoom).bottomInset, 0)
      XCTAssertNil(viewport(empty, zoom).page(atTopOf: []))
      XCTAssertEqual(viewport(single, zoom).page(atTopOf: [(7, single.slots[7]!)]), 7)
    }
    let zeroViewport = viewport(single, 1, size: .zero)
    XCTAssertEqual(zeroViewport.bottomInset, 0)
    assertPoint(zeroViewport.contentPoint(at: .zero), .zero)
  }

  func testPageGapsAndFractionalEdges() {
    let document = ReaderPdfLayout(pages: [1, 8].map {
      ReaderPdfPageMetrics(number: $0, size: CGSize(width: 360.125, height: 100.25))
    })
    let slots = [(1, document.slots[1]!), (8, document.slots[8]!)]
    for zoom in zooms {
      for (top, expected) in [(CGFloat(0), 1), (100.24, 1), (100.25, 8), (106.25, 8), (112.25, 8), (212.5, 8)] {
        let offset = viewport(document, zoom).scrollPoint(CGPoint(x: 0, y: top))
        XCTAssertEqual(viewport(document, zoom, offset: offset).page(atTopOf: slots), expected)
      }
    }
  }

  func testButtonsPreserveBothCenterCoordinatesAcrossAllZoomPairs() {
    let document = ReaderPdfLayout(pages: [ReaderPdfPageMetrics(number: 1, size: CGSize(width: 3000, height: 6000))])
    let anchor = CGPoint(x: 1400, y: 2800)
    for oldZoom in zooms {
      let initial = viewport(document, oldZoom)
      let initialOffset = initial.offset(keeping: anchor, at: initial.center)
      let before = viewport(document, oldZoom, offset: initialOffset)
      let savedAnchor = before.contentPoint(at: before.center)
      assertPoint(savedAnchor, anchor)
      for newZoom in zooms {
        let changed = viewport(document, newZoom)
        let newOffset = changed.offset(keeping: savedAnchor, at: changed.center)
        let after = viewport(document, newZoom, offset: newOffset)
        assertPoint(after.contentPoint(at: after.center), savedAnchor)
      }
    }
  }

  func testCenterClampsAtDocumentEdges() {
    let document = layout()
    for oldZoom in zooms {
      let initial = viewport(document, oldZoom)
      for offset in [CGPoint.zero, initial.clampedOffset(CGPoint(x: 9999, y: 9999))] {
        let before = viewport(document, oldZoom, offset: offset)
        let anchor = before.contentPoint(at: before.center)
        for newZoom in zooms {
          let changed = viewport(document, newZoom)
          let projected = changed.scrollPoint(anchor)
          let ideal = CGPoint(x: projected.x-changed.center.x, y: projected.y-changed.center.y)
          let maximum = changed.clampedOffset(CGPoint(x: 9999, y: 9999))
          let actual = changed.offset(keeping: anchor, at: changed.center)
          assertPoint(actual, CGPoint(x: min(max(0, ideal.x), maximum.x), y: min(max(0, ideal.y), maximum.y)))
        }
      }
    }
  }

  func testHeightOnlyResizeUpdatesTailAndKeepsReachableCenter() {
    let document = layout(cropped: true)
    for zoom in zooms {
      for height in [CGFloat(300), 679.33331298828125, 900] {
        let size = CGSize(width: 402, height: height)
        let view = viewport(document, zoom, size: size)
        let last = view.offset(keeping: document.slots[200]!.origin, at: .zero)
        let resized = viewport(document, zoom, offset: last, size: size)
        XCTAssertEqual(resized.viewportRect(document.slots[200]!).minY, 0, accuracy: 0.000001)
      }
    }
    let large = ReaderPdfLayout(pages: [ReaderPdfPageMetrics(number: 1, size: CGSize(width: 3000, height: 6000))])
    let before = viewport(large, 1, offset: CGPoint(x: 500, y: 1200))
    let anchor = before.contentPoint(at: before.center)
    let resized = viewport(large, 1, size: CGSize(width: 402, height: 900))
    let offset = resized.offset(keeping: anchor, at: resized.center)
    assertPoint(viewport(large, 1, offset: offset, size: resized.size).contentPoint(at: resized.center), anchor)
  }

  func testRotatedCroppedLayoutAndOverlayRoundTrip() {
    for rotation in [90, 270, -90] {
      let size = ReaderPdfPageMetrics.visualSize(CGSize(width: 400.5, height: 500.25), rotation: rotation)
      XCTAssertEqual(size, CGSize(width: 500.25, height: 400.5))
      let document = ReaderPdfLayout(pages: [ReaderPdfPageMetrics(number: 3, size: size,
        crop: ["top": 0.2, "bottom": 0.1, "left": 0.05, "right": 0.1])])
      XCTAssertEqual(document.slots[3]!.height, 280.35, accuracy: 0.000001)
      XCTAssertEqual(document.frames[3]!.minY, -80.1, accuracy: 0.000001)
      for zoom in zooms {
        let view = viewport(document, zoom, offset: CGPoint(x: 14.125, y: 21.375))
        let point = CGPoint(x: 50.25, y: 99.125)
        let rect = view.viewportRect(CGRect(origin: point, size: CGSize(width: 20, height: 30)))
        assertPoint(view.contentPoint(at: rect.origin), point)
        let pageFrame = view.viewportRect(document.frames[3]!)
        XCTAssertLessThan(pageFrame.minX, 0)
        XCTAssertLessThan(pageFrame.minY, 0)
      }
    }
  }

  func testProjectionIncludesContentOriginAndBothScrollAxes() {
    let document = layout()
    for zoom in zooms {
      let view = viewport(document, zoom, offset: CGPoint(x: 55, y: 420), origin: CGPoint(x: 21, y: -13))
      let point = CGPoint(x: 60, y: 512)
      let projected = view.viewportRect(CGRect(origin: point, size: .zero)).origin
      assertPoint(projected, CGPoint(x: 21 + 60*zoom - 55, y: -13 + 512*zoom - 420))
      assertPoint(view.contentPoint(at: projected), point)
    }
  }

  func testZoomCyclesDoNotAccumulateCenterError() {
    let document = ReaderPdfLayout(pages: [ReaderPdfPageMetrics(number: 1, size: CGSize(width: 3000, height: 6000))])
    var current = viewport(document, 1, offset: CGPoint(x: 600.125, y: 1500.375))
    let anchor = current.contentPoint(at: current.center)
    for _ in 0..<50 {
      for zoom in [CGFloat(1), 2, 0.5, 2, 1] {
        let saved = current.contentPoint(at: current.center)
        let changed = viewport(document, zoom)
        let offset = changed.offset(keeping: saved, at: changed.center)
        current = viewport(document, zoom, offset: offset)
        assertPoint(current.contentPoint(at: current.center), anchor)
      }
    }
    assertPoint(current.offset, CGPoint(x: 600.125, y: 1500.375))
  }
}

XCTMain([testCase([
  ("S02 navigation at 50/100/200%", ReaderPdfGeometryTests.testS02PageNavigationAtEveryZoom),
  ("S08 hidden cropped navigation at 50/100/200%", ReaderPdfGeometryTests.testS08HiddenCroppedPagesAtEveryZoom),
  ("observed S08 406pt drift", ReaderPdfGeometryTests.testObservedS08NegativeFrameExplains406PointDrift),
  ("minimal bottom inset and scroll limits", ReaderPdfGeometryTests.testBottomInsetAllowsOnlyNecessaryTail),
  ("single/empty/zero viewport", ReaderPdfGeometryTests.testSingleShortPageAndEmptyDocumentCannotScrollIntoBlankSpace),
  ("fractional page edges and gaps", ReaderPdfGeometryTests.testPageGapsAndFractionalEdges),
  ("both center coordinates for all zoom pairs", ReaderPdfGeometryTests.testButtonsPreserveBothCenterCoordinatesAcrossAllZoomPairs),
  ("center clamps at edges", ReaderPdfGeometryTests.testCenterClampsAtDocumentEdges),
  ("height-only resize", ReaderPdfGeometryTests.testHeightOnlyResizeUpdatesTailAndKeepsReachableCenter),
  ("rotated crop and overlay", ReaderPdfGeometryTests.testRotatedCroppedLayoutAndOverlayRoundTrip),
  ("origin and both scroll axes", ReaderPdfGeometryTests.testProjectionIncludesContentOriginAndBothScrollAxes),
  ("repeated zoom cycles", ReaderPdfGeometryTests.testZoomCyclesDoNotAccumulateCenterError)
])])

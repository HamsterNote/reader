import ExpoModulesCore
import PDFKit
import UIKit

public class ReaderPdfModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ReaderPdf")
    Function("capabilities") {
      return ["nativeLayout": true, "thumbnails": true, "textGeometry": true, "pageImage": true]
    }
    View(ReaderPdfView.self) {
      Events("onPdfEvent")
      Prop("configuration") { (view: ReaderPdfView, value: [String: Double]) in view.configuration = value }
      Prop("command") { (view: ReaderPdfView, value: [String: Any]?) in
        if let value = value { view.receive(value) }
      }
    }
  }
}

struct CanonicalBoundary {
  let offset: Int
  let rect: CGRect
}
struct CanonicalGlyph {
  let start: Int
  let end: Int
  let text: String
  let rect: CGRect
}
struct CanonicalPage {
  let text: String
  let boundaries: [CanonicalBoundary]
  let glyphs: [CanonicalGlyph]
}
struct PdfEndpoint: Equatable, Comparable {
  let page: Int
  let offset: Int
  static func < (a: Self, b: Self) -> Bool { a.page == b.page ? a.offset < b.offset : a.page < b.page }
  var json: [String: Any] { ["selectionId": "page-\(page)", "offset": offset] }
}
func pdfRect(_ value: Any?) -> CGRect {
  guard let v = value as? [String: Any] else { return .zero }
  return CGRect(x: (v["x"] as? Double) ?? 0, y: (v["y"] as? Double) ?? 0,
                width: (v["width"] as? Double) ?? 0, height: (v["height"] as? Double) ?? 0)
}
func jsonRect(_ r: CGRect) -> [String: Double] { ["x": r.minX, "y": r.minY, "width": r.width, "height": r.height] }

/** A page bitmap contains only PDF content; selection never enters this layer. */
final class ReaderPdfPageView: UIView {
  var page: PDFPage?
  var painted: (() -> Void)?
  var zoomScale: CGFloat = 1
  private var drawCount = 0
  override class var layerClass: AnyClass { CATiledLayer.self }
  override func draw(_ rect: CGRect) {
    drawCount += 1
    NSLog("ReaderPdf draw count=%ld bounds=%@ scale=%@ zoom=%@ rect=%@", drawCount, NSStringFromCGRect(bounds), String(contentScaleFactor), String(zoomScale), NSStringFromCGRect(rect))
    guard let context = UIGraphicsGetCurrentContext(), let page = page else {
      NSLog("ReaderPdf draw skipped context=%@ page=%@", String(UIGraphicsGetCurrentContext() != nil), String(page != nil))
      return
    }
    context.setFillColor(UIColor.white.cgColor); context.fill(bounds)
    context.saveGState()
    context.translateBy(x: 0, y: bounds.height)
    context.scaleBy(x: 1, y: -1)
    // PDFPage.draw handles crop box origin and intrinsic rotation. Applying
    // page.transform(for:) here as well moves rotated/off-origin pages twice.
    page.draw(with: .cropBox, to: context)
    context.restoreGState()
    DispatchQueue.main.async { [weak self] in self?.painted?() }
  }
}

/** No PDFView, UITextView, UIMenu or system Selection participates. */
final class ReaderPdfView: ExpoView, UIScrollViewDelegate, UIGestureRecognizerDelegate {
  let onPdfEvent = EventDispatcher()
  var configuration: [String: Double] = [:]
  private let scroll = UIScrollView()
  private let content = UIView()
  private let overlay = CAShapeLayer()
  private var annotationLayers: [CAShapeLayer] = []
  private var annotations: [[String: Any]] = []
  private var slots: [Int: CGRect] = [:]
  private var ownedPreviews = Set<URL>()
  private var previewOrder: [URL] = []
  private let startHandle = CAShapeLayer(), endHandle = CAShapeLayer()
  private let lens = TextOnlyLens()
  private var document: PDFDocument?
  private var identity: [String: Any] = [:]
  private var sourceEpoch = UUID()
  private var seen = Set<String>()
  private var pages: [Int] = []
  private var frames: [Int: CGRect] = [:]
  private var crops: [String: [String: Double]] = [:]
  private var pageViews: [Int: ReaderPdfPageView] = [:]
  private var text: [Int: CanonicalPage] = [:]
  private var textTextures = NSCache<NSNumber, UIImage>()
  private var revision = 0
  private var firstDisplayed = false, restoreComplete = false
  private var start: PdfEndpoint?, end: PdfEndpoint?
  private var activeRangeId: String?
  private var beforeDrag: (PdfEndpoint?, PdfEndpoint?)?
  private var beforeRangeId: String?
  private var fixed: PdfEndpoint?
  private var pointer: CGPoint?
  private var activeTouch = false
  private var timer: CADisplayLink?
  private var color = UIColor.systemYellow
  private var previewQueue = OperationQueue()
  private var previewCache = NSCache<NSString, UIImage>()
  private lazy var drag = ReaderSelectionPan(target: self, action: #selector(dragSelection(_:)))
  private var closing = false
  private var layoutWidth: CGFloat = -1

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addSubview(scroll); scroll.addSubview(content)
    scroll.delegate = self; scroll.minimumZoomScale = 0.5; scroll.maximumZoomScale = 2
    scroll.backgroundColor = .secondarySystemBackground
    content.layer.addSublayer(overlay); content.layer.addSublayer(startHandle); content.layer.addSublayer(endHandle)
    addSubview(lens); lens.isHidden = true
    overlay.fillColor = color.withAlphaComponent(0.35).cgColor
    for h in [startHandle,endHandle] { h.fillColor = color.cgColor }
    let hold = ReaderSelectionHold(target: self, action: #selector(longPress(_:)))
    hold.onAdditionalTouch = { [weak self] in self?.cancelSelection() }
    hold.minimumPressDuration = 0.45; hold.delegate = self; addGestureRecognizer(hold)
    drag.onAdditionalTouch = { [weak self] in self?.cancelSelection() }
    scroll.panGestureRecognizer.require(toFail:drag)
    drag.maximumNumberOfTouches = 1; drag.delegate = self; addGestureRecognizer(drag)
    let tap = UITapGestureRecognizer(target: self, action: #selector(tapPage(_:))); addGestureRecognizer(tap)
    previewQueue.maxConcurrentOperationCount = 2; previewQueue.qualityOfService = .utility
    textTextures.countLimit = 5; textTextures.totalCostLimit = 16 * 1024 * 1024
    previewCache.totalCostLimit = 16 * 1024 * 1024; previewCache.countLimit = 24
    NotificationCenter.default.addObserver(self, selector: #selector(cancelSelection), name: UIApplication.willResignActiveNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(memoryWarning), name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
  }
  deinit { for url in ownedPreviews { try? FileManager.default.removeItem(at:url) }; timer?.invalidate(); previewQueue.cancelAllOperations(); NotificationCenter.default.removeObserver(self) }
  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    if (event?.allTouches?.count ?? 0) > 1 { cancelSelection() }
    super.touchesBegan(touches,with:event)
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { cancelSelection(); previewQueue.cancelAllOperations() }
  }
  override func layoutSubviews() {
    super.layoutSubviews(); scroll.frame = bounds
    if document != nil && beforeDrag == nil && layoutWidth != bounds.width { layoutWidth = bounds.width; layoutPages() }
  }
  private func emit(_ event: [String: Any]) {
    guard !closing else { return }
    onPdfEvent(identity.merging(event) { _, new in new })
  }
  private func error(_ code: String, _ request: String? = nil, _ message: String? = nil) {
    var event: [String: Any] = ["type": "error", "code": code]
    if let request = request { event["requestId"] = request }
    if let message = message { event["message"] = message }
    emit(event)
  }
  func receive(_ c: [String: Any]) {
    guard let type = c["type"] as? String, let request = c["requestId"] as? String else { return }
    if type == "open" {
      reset()
      closing = false
      for key in ["fileId", "paneId", "sessionId", "generation"] { identity[key] = c[key] }
      guard let source = c["source"] as? [String: String], source["fileId"] == identity["fileId"] as? String,
            let uri = source["localUri"], let url = URL(string: uri), url.isFileURL else { error("PERMISSION",request,"source localUri 无效"); return }
      // Only app-owned documents/caches; no arbitrary file or executable action.
      let roots = [FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
                   FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first].compactMap { $0?.resolvingSymlinksInPath().path }
      let path = url.resolvingSymlinksInPath().path
      let exists = FileManager.default.fileExists(atPath: path)
      let readable = FileManager.default.isReadableFile(atPath: path)
      NSLog("ReaderPdf open sessionDirectory=%@ pdfPath=%@ exists=%@ readable=%@", (path as NSString).deletingLastPathComponent, path, String(exists), String(readable))
      guard roots.contains(where: { path.hasPrefix($0 + "/") }) else { error("PERMISSION",request,"path 不在应用容器内：\(path)"); return }
      guard readable else { error("PERMISSION",request,"PDF 不可读：\(path)"); return }
      guard let doc = PDFDocument(url: url) else { NSLog("ReaderPdf document=nil path=%@", path); error("CORRUPT",request,"PDFKit document=nil，路径：\(path)"); return }
      NSLog("ReaderPdf document opened path=%@ locked=%@ pageCount=%ld", path, String(doc.isLocked), doc.pageCount)
      guard !doc.isLocked else { error("PASSWORD_REQUIRED",request,"PDF 已加密：\(path)"); return }
      guard doc.pageCount > 0 else { error("CORRUPT",request,"PDF 页数为 0：\(path)"); return }
      document = doc; pages = Array(1...doc.pageCount)
      seen.insert(request); emit(["type":"loaded", "pageCount":doc.pageCount]); layoutPages()
    } else {
      guard !closing, ["fileId","paneId","sessionId","generation"].allSatisfy({ String(describing: c[$0] ?? "") == String(describing: identity[$0] ?? "") }) else { return }
      if seen.contains(request) { return }; seen.insert(request)
      switch type {
      case "close": reset(); closing = true; return
      case "cancel": cancelSelection()
      case "restoreComplete":
        restoreComplete = true
        emit(["type":"restored", "pageNumber":visiblePage()]); emitReady()
      case "layout":
        guard let doc = document, let requested = c["pages"] as? [Int], Set(requested).count == requested.count,
              requested == requested.sorted(), requested.allSatisfy({ $0 > 0 && $0 <= doc.pageCount }) else { error("INVALID_TARGET",request); return }
        let values = c["crops"] as? [String: [String: Double]] ?? [:]
        guard values.values.allSatisfy({ v in
          let t = v["top"] ?? 0, b = v["bottom"] ?? 0, l = v["left"] ?? 0, r = v["right"] ?? 0
          return [t,b,l,r].allSatisfy({ $0.isFinite && $0 >= 0 && $0 < 1 }) && t+b < 1 && l+r < 1
        }) else { error("INVALID_TARGET",request); return }
        cancelSelection(); pages = requested; crops = values; layoutPages()
      case "scale":
        if let scale = c["value"] as? Double, scale.isFinite { scroll.setZoomScale(CGFloat(min(2,max(0.5,scale))), animated:false) }
      case "navigate":
        guard let n = c["pageNumber"] as? Int, let frame = frames[n] else { error("INVALID_TARGET",request); return }
        var y = frame.minY
        if let offset = c["offset"] as? Int {
          guard let b = text[n]?.boundaries.first(where: { $0.offset == offset }) else { error("MAPPING_NOT_READY",request); return }
          y += b.rect.minY
        }
        let target = min(max(0,y * scroll.zoomScale),max(0,scroll.contentSize.height-scroll.bounds.height))
        scroll.setContentOffset(CGPoint(x:0,y:target), animated:false); updateVisible()
      case "text":
        let retain = Set(c["retain"] as? [Int] ?? [])
        for p in c["pages"] as? [[String: Any]] ?? [] {
          guard let n = p["pageNumber"] as? Int, pages.contains(n), let str = p["text"] as? String,
                let bs = p["boundaries"] as? [[String: Any]], let gs = p["glyphs"] as? [[String: Any]] else { continue }
          let boundaries = bs.compactMap { b -> CanonicalBoundary? in
            guard let o = b["offset"] as? Int, o >= 0 && o <= str.utf16.count else { return nil }
            return CanonicalBoundary(offset:o,rect:pdfRect(b["rect"]))
          }
          guard boundaries.count == str.utf16.count + 1 else { error("MAPPING_NOT_READY",request); continue }
          if let raw = p["textImage"] as? String, let base64 = raw.split(separator:",",maxSplits:1).last,
             let data = Data(base64Encoded:String(base64)), let image = UIImage(data:data) {
            textTextures.setObject(image,forKey:NSNumber(value:n),cost:Int(image.size.width*image.size.height*4))
          }
          text[n] = CanonicalPage(text:str,boundaries:boundaries,glyphs:gs.compactMap { g in
            guard let a = g["start"] as? Int, let b = g["end"] as? Int, let s = g["text"] as? String else { return nil }
            return CanonicalGlyph(start:a,end:b,text:s,rect:pdfRect(g["rect"]))
          })
        }
        text = text.filter { retain.contains($0.key) || pageViews[$0.key] != nil }
        updateSelection()
      case "annotations":
        annotations = c["ranges"] as? [[String: Any]] ?? []; updateAnnotations()
      case "selection":
        stopSelection(notify:false)
        if let r = c["range"] as? [String: Any] {
          activeRangeId = r["id"] as? String
          start = endpoint(r["start"]); end = endpoint(r["end"])
          if let style = r["markerStyle"] as? [String: String], let hex = style["backgroundColor"] { color = parseColor(hex) }
        } else { start = nil; end = nil; activeRangeId = nil }
        updateSelection()
        if c["showMenu"] as? Bool == true { sendSelection("end") }
      case "preview":
        guard let n = c["pageNumber"] as? Int, let p = document?.page(at:n-1), pages.contains(n) else { error("INVALID_TARGET",request); return }
        let width = min(512,max(32,c["width"] as? Double ?? 160))
        preview(p,n,width,request); return
      default: error("INVALID_TARGET",request); return
      }
    }
    emit(["type":"complete","requestId":request])
  }
  private func endpoint(_ v: Any?) -> PdfEndpoint? {
    guard let v = v as? [String: Any], let id = v["selectionId"] as? String, id.hasPrefix("page-"),
          let n = Int(id.dropFirst(5)), let offset = v["offset"] as? Int else { return nil }
    return PdfEndpoint(page:n,offset:offset)
  }
  private func reset() {
    sourceEpoch = UUID()
    cancelSelection(); previewQueue.cancelAllOperations(); previewCache.removeAllObjects(); textTextures.removeAllObjects()
    pageViews.values.forEach { $0.superview?.removeFromSuperview() }; pageViews.removeAll()
    for url in ownedPreviews { try? FileManager.default.removeItem(at:url) }; ownedPreviews.removeAll(); previewOrder.removeAll()
    annotationLayers.forEach { $0.removeFromSuperlayer() }; annotationLayers = []; annotations = []; slots = [:]
    document = nil; pages = []; frames = [:]; text = [:]; crops = [:]; seen = []
    start = nil; end = nil; firstDisplayed = false; restoreComplete = false; revision = 0
    scroll.setZoomScale(1,animated:false); scroll.contentOffset = .zero
    updateSelection()
  }
  private func visualSize(_ page: PDFPage) -> CGSize {
    let box = page.bounds(for:.cropBox)
    return abs(page.rotation % 180) == 90 ? CGSize(width:box.height,height:box.width) : box.size
  }
  private func layoutPages() {
    guard let doc = document, bounds.width > 0 else { return }
    // Scale-one visual page coordinates are never replaced by screen coordinates.
    var y: CGFloat = 0, width: CGFloat = 0
    frames.removeAll(); slots.removeAll()
    for n in pages {
      guard let p = doc.page(at:n-1) else { continue }
      let size = visualSize(p), crop = crops[String(n)] ?? crops["page-\(n)"] ?? [:]
      let l = CGFloat(crop["left"] ?? 0), r = CGFloat(crop["right"] ?? 0), t = CGFloat(crop["top"] ?? 0), b = CGFloat(crop["bottom"] ?? 0)
      slots[n] = CGRect(x:0,y:y,width:size.width*(1-l-r),height:size.height*(1-t-b))
      frames[n] = CGRect(x:-l*size.width,y:y-t*size.height,width:size.width,height:size.height)
      y += size.height * (1-t-b) + 12; width = max(width,size.width*(1-l-r))
    }
    let contentSize = CGSize(width:width,height:max(0,y-12))
    content.frame = CGRect(origin: .zero, size: contentSize)
    content.bounds.size = contentSize
    scroll.contentSize = CGSize(width:contentSize.width*scroll.zoomScale,height:contentSize.height*scroll.zoomScale)
    for (n,v) in pageViews {
      if let f = frames[n], let slot = slots[n] {
        v.zoomScale = scroll.zoomScale
        v.contentScaleFactor = window?.screen.scale ?? UIScreen.main.scale
        v.superview?.frame = slot; v.frame = f.offsetBy(dx:-slot.minX,dy:-slot.minY)
      }
    }
    updateVisible()
  }
  private func visiblePage() -> Int {
    pages.first(where: { n in guard let f = frames[n] else { return false }; return f.maxY*scroll.zoomScale >= scroll.contentOffset.y }) ?? pages.first ?? 1
  }
  private func updateVisible() {
    guard let doc = document else { return }
    let viewport = scroll.convert(scroll.bounds,to:content)
    let visible = pages.filter { slots[$0]?.intersects(viewport) == true }
    var keep = Set(visible)
    for n in visible { if let i = pages.firstIndex(of:n) { if i > 0 { keep.insert(pages[i-1]) }; if i+1 < pages.count { keep.insert(pages[i+1]) } } }
    for n in Array(pageViews.keys) where !keep.contains(n) { pageViews.removeValue(forKey:n)?.superview?.removeFromSuperview() }
    for n in keep where pageViews[n] == nil {
      guard let frame = frames[n], let slot = slots[n], let page = doc.page(at:n-1) else { continue }
      let wrapper = UIView(frame:slot); wrapper.clipsToBounds = true; wrapper.isUserInteractionEnabled = false
      let view = ReaderPdfPageView(frame:frame.offsetBy(dx:-slot.minX,dy:-slot.minY)); view.page = page
      view.zoomScale = scroll.zoomScale
      view.contentScaleFactor = window?.screen.scale ?? UIScreen.main.scale
      view.isUserInteractionEnabled = false
      let generation = sourceEpoch
      view.painted = { [weak self, weak view] in
        guard let self = self, view?.superview != nil, generation == self.sourceEpoch,
              self.slots[n]?.intersects(self.scroll.convert(self.scroll.bounds,to:self.content)) == true else { return }
        if !self.firstDisplayed { self.firstDisplayed = true; self.emit(["type":"displayed","pageNumber":n]); self.emitReady() }
      }
      wrapper.addSubview(view); content.insertSubview(wrapper,at:0); pageViews[n] = view; view.setNeedsDisplay()
    }
    let active = activePages()
    let retain = keep.union(active)
    text = text.filter { retain.contains($0.key) }
    for n in pages where !keep.contains(n) { textTextures.removeObject(forKey:NSNumber(value:n)) }
    let missing = retain.filter { text[$0] == nil || (keep.contains($0) && text[$0]?.text.isEmpty == false && textTextures.object(forKey:NSNumber(value:$0)) == nil) }.sorted()
    if !missing.isEmpty { emit(["type":"textNeeded","pages":missing,"retain":retain.sorted()]) }
    revision += 1
    let geometry: [[String: Any]] = visible.compactMap { n in
      guard let frame = frames[n], let page = doc.page(at:n-1) else { return nil }
      let origin = content.convert(frame.origin,to:self), scale = scroll.zoomScale
      return ["pageNumber":n,"width":frame.width,"height":frame.height,"rotation":page.rotation,
              "crop":crops[String(n)] ?? crops["page-\(n)"] ?? [:],"pageToViewport":[scale,0,0,scale,origin.x,origin.y],"geometryRevision":revision]
    }
    emit(["type":"geometry","pages":geometry,"geometryRevision":revision]); updateSelection(); updateAnnotations()
  }
  private func emitReady() { if firstDisplayed && restoreComplete { emit(["type":"ready","pageNumber":visiblePage()]) } }
  func viewForZooming(in scrollView: UIScrollView) -> UIView? { content }
  func scrollViewWillBeginDragging(_ scrollView: UIScrollView) { previewQueue.isSuspended = true }
  func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) { if !decelerate { previewQueue.isSuspended = false } }
  func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { previewQueue.isSuspended = false }
  func scrollViewDidScroll(_ scrollView: UIScrollView) { updateVisible() }
  func scrollViewDidZoom(_ scrollView: UIScrollView) { updateVisible() }
  private func activePages() -> Set<Int> {
    guard let s = start, let e = end else { return [] }
    return Set(pages.filter { $0 >= min(s.page,e.page) && $0 <= max(s.page,e.page) })
  }
  private func storedRects(_ annotation: [String: Any], _ n: Int) -> [CGRect] {
    guard let map = annotation["rectsBySelectionId"] as? [String: [[String: Any]]], let f = frames[n] else { return [] }
    return (map["page-\(n)"] ?? []).map { value in
      let r = pdfRect(value)
      if annotation["overlayRectType"] as? String == "percent" { return CGRect(x:r.minX*f.width/100,y:r.minY*f.height/100,width:r.width*f.width/100,height:r.height*f.height/100) }
      return r
    }
  }
  private func updateAnnotations() {
    annotationLayers.forEach { $0.removeFromSuperlayer() }; annotationLayers = []
    for a in annotations {
      let path = UIBezierPath()
      for n in pageViews.keys {
        guard let f = frames[n] else { continue }
        for r in storedRects(a,n) {
          let clipped = r.offsetBy(dx:f.minX,dy:f.minY).intersection(slots[n] ?? .zero)
          if !clipped.isNull { path.append(UIBezierPath(rect:clipped)) }
        }
      }
      let layer = CAShapeLayer(); layer.path = path.cgPath
      let style = a["markerStyle"] as? [String: String]
      layer.fillColor = parseColor(style?["backgroundColor"] ?? "#ffc107").withAlphaComponent(0.35).cgColor
      content.layer.insertSublayer(layer,below:overlay); annotationLayers.append(layer)
    }
  }
  private func boundaryPoint(_ e: PdfEndpoint) -> CGRect? {
    guard let f = frames[e.page], let b = text[e.page]?.boundaries.first(where: { $0.offset == e.offset }) else { return nil }
    return b.rect.offsetBy(dx:f.minX,dy:f.minY)
  }
  private func hit(_ point: CGPoint) -> PdfEndpoint? {
    let p = convert(point,to:content)
    guard let n = pages.first(where: { slots[$0]?.contains(p) == true }), let f = frames[n], let mapping = text[n] else { return nil }
    let local = CGPoint(x:p.x-f.minX,y:p.y-f.minY)
    // Only actual line bounds can hit; never add a handle/finger compensation.
    let candidates = mapping.boundaries.filter { $0.rect.minY <= local.y && $0.rect.maxY >= local.y }
    guard let b = candidates.min(by: { abs($0.rect.minX-local.x) < abs($1.rect.minX-local.x) }) else { return nil }
    return PdfEndpoint(page:n,offset:b.offset)
  }
  private func updateSelection() {
    let path = UIBezierPath()
    if let a = start, let b = end {
      let low = min(a,b), high = max(a,b)
      for n in activePages() {
        guard let f = frames[n], let p = text[n] else { continue }
        let from = n == low.page ? low.offset : 0, to = n == high.page ? high.offset : p.text.utf16.count
        for g in p.glyphs where g.end > from && g.start < to {
          let r = g.rect.offsetBy(dx:f.minX,dy:f.minY).intersection(slots[n] ?? .zero)
          if !r.isNull { path.append(UIBezierPath(rect:r)) }
        }
      }
    }
    CATransaction.begin(); CATransaction.setDisableActions(true)
    overlay.path = path.cgPath; overlay.fillColor = color.withAlphaComponent(0.35).cgColor
    for (endpoint, layer) in [(start,startHandle),(end,endHandle)] {
      if let e = endpoint, let r = boundaryPoint(e) {
        let size = CGFloat(configuration["handleSize"] ?? 0) / max(scroll.zoomScale,0.01)
        layer.path = UIBezierPath(ovalIn:CGRect(x:r.minX-size/2,y:r.maxY,width:size,height:size)).cgPath
      } else { layer.path = nil }
      layer.fillColor = color.cgColor
    }
    CATransaction.commit()
  }
  override func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
    if recognizer === drag {
      let point = recognizer.location(in:content)
      let radius = CGFloat(configuration["hitSize"] ?? 0)/2/max(scroll.zoomScale,0.01)
      return [start,end].compactMap { $0 }.contains { e in
        guard let r = boundaryPoint(e) else { return false }
        return hypot(point.x-r.minX,point.y-r.maxY-(CGFloat(configuration["handleSize"] ?? 0)/2/scroll.zoomScale)) <= radius
      }
    }
    return true
  }
  @objc private func longPress(_ g: UILongPressGestureRecognizer) {
    if g.numberOfTouches > 1 { cancelSelection(); return }
    if g.state == .began, let e = hit(g.location(in:self)), let p = text[e.page], !p.text.isEmpty {
      beforeDrag = (start,end); beforeRangeId = activeRangeId; activeRangeId = nil
      // NSString is UTF-16, exactly the public canonical coordinate system.
      let string = p.text as NSString
      var lo = min(e.offset,max(0,string.length-1)), hi = min(lo+1,string.length)
      while lo > 0 && !CharacterSet.whitespacesAndNewlines.contains(UnicodeScalar(string.character(at:lo-1)) ?? UnicodeScalar(32)!) { lo -= 1 }
      while hi < string.length && !CharacterSet.whitespacesAndNewlines.contains(UnicodeScalar(string.character(at:hi)) ?? UnicodeScalar(32)!) { hi += 1 }
      start = PdfEndpoint(page:e.page,offset:lo); end = PdfEndpoint(page:e.page,offset:hi)
      fixed = start; scroll.isScrollEnabled = false
      activeTouch = (g as? ReaderSelectionHold)?.inputType == .direct
      pointer = g.location(in:self); updateSelection(); sendSelection("preview")
    } else if g.state == .changed { move(g.location(in:self)) }
    else if g.state == .ended { finish(g.location(in:self)) }
    else if g.state == .cancelled || g.state == .failed { cancelSelection() }
  }
  @objc private func dragSelection(_ g: UIPanGestureRecognizer) {
    if g.numberOfTouches > 1 { cancelSelection(); return }
    if g.state == .began {
      beforeDrag = (start,end); beforeRangeId = activeRangeId; let point = g.location(in:content)
      guard let s = start, let e = end, let a = boundaryPoint(s), let b = boundaryPoint(e) else { return }
      fixed = abs(point.x-a.minX)+abs(point.y-a.maxY) < abs(point.x-b.minX)+abs(point.y-b.maxY) ? e : s
      scroll.isScrollEnabled = false; activeTouch = (g as? ReaderSelectionPan)?.inputType == .direct
    }
    if g.state == .began || g.state == .changed { move(g.location(in:self)) }
    else if g.state == .ended { finish(g.location(in:self)) }
    else if g.state == .cancelled || g.state == .failed { cancelSelection() }
  }
  private func move(_ point: CGPoint) {
    guard let f = fixed else { return }; pointer = point
    if let hit = hit(point), hit != f { start = min(f,hit); end = max(f,hit) }
    updateSelection(); updateLens(point); sendSelection("preview")
    if timer == nil { let link = CADisplayLink(target:self,selector:#selector(autoScroll)); timer = link; link.add(to:.main,forMode:.common) }
  }
  @objc private func autoScroll() {
    guard let p = pointer, fixed != nil else { timer?.invalidate(); timer = nil; return }
    let zone: CGFloat = 64
    let distance = p.y < zone ? p.y-zone : p.y > bounds.height-zone ? p.y-(bounds.height-zone) : 0
    let delta = (distance < 0 ? -1.0 : 1.0) * pow(min(1,abs(distance)/zone),2) * 14
    let y = min(max(0,scroll.contentOffset.y+delta),max(0,scroll.contentSize.height-scroll.bounds.height))
    if y != scroll.contentOffset.y { scroll.contentOffset.y = y; move(p) }
  }
  private func finish(_ point: CGPoint) {
    move(point); timer?.invalidate(); timer = nil; pointer = nil; fixed = nil; beforeDrag = nil
    scroll.isScrollEnabled = true; lens.isHidden = true; updateVisible(); sendSelection("end")
  }
  @objc private func cancelSelection() { stopSelection(notify:true) }
  private func stopSelection(notify: Bool) {
    if let previous = beforeDrag { start = previous.0; end = previous.1; activeRangeId = beforeRangeId }
    beforeDrag = nil; fixed = nil; pointer = nil; timer?.invalidate(); timer = nil
    lens.isHidden = true; scroll.isScrollEnabled = true; updateSelection(); if notify { emit(["type":"cancelled"]) }
  }
  private func sendSelection(_ phase: String) {
    guard let s = start, let e = end, s != e, let r = boundaryPoint(e) else { return }
    let anchor = content.convert(r,to:self)
    var event: [String: Any] = ["type":"selection","start":s.json,"end":e.json,"phase":phase,"geometryRevision":revision,"anchor":jsonRect(anchor)]
    if let id = activeRangeId { event["rangeId"] = id }
    emit(event)
  }
  private func updateLens(_ point: CGPoint) {
    guard activeTouch, let radius = configuration["lensRadius"], let distance = configuration["lensDistance"], let scale = configuration["magnification"] else { lens.isHidden = true; return }
    let safe = bounds.inset(by:safeAreaInsets), size = CGFloat(radius*2)
    var y = point.y-CGFloat(distance)
    if y-CGFloat(radius) < safe.minY { y = point.y+CGFloat(distance) }
    let x = max(safe.minX+CGFloat(radius),min(safe.maxX-CGFloat(radius),point.x))
    y = max(safe.minY+CGFloat(radius),min(safe.maxY-CGFloat(radius),y))
    lens.frame = CGRect(x:x-CGFloat(radius),y:y-CGFloat(radius),width:size,height:size)
    lens.layer.cornerRadius = CGFloat(radius); lens.isHidden = false
    lens.textures = pageViews.keys.compactMap { n in
      guard let image = textTextures.object(forKey:NSNumber(value:n)), let f = frames[n] else { return nil }
      return (image, content.convert(f,to:self))
    }
    lens.sample = point; lens.magnification = CGFloat(scale); lens.color = color
    lens.markerWidth = CGFloat(configuration["markerWidth"] ?? 0)
    lens.marker = hit(point).flatMap { boundaryPoint($0) }.map { content.convert($0,to:self) }
    lens.setNeedsDisplay()
  }
  @objc private func tapPage(_ g: UITapGestureRecognizer) {
    guard let doc = document else { return }
    let point = g.location(in:content)
    guard let n = pages.first(where: { slots[$0]?.contains(point) == true }), let frame = frames[n], let page = doc.page(at:n-1) else { return }
    let transform = page.transform(for:.cropBox)
    let visual = CGPoint(x:point.x-frame.minX,y:frame.height-(point.y-frame.minY))
    let user = visual.applying(transform.inverted())
    for a in annotations.reversed() {
      if let id = a["id"] as? String, storedRects(a,n).contains(where: { $0.offsetBy(dx:frame.minX,dy:frame.minY).contains(point) }) {
        emit(["type":"activate","rangeId":id]); return
      }
    }
    guard let annotation = page.annotation(at:user) else { return }
    if let action = annotation.action as? PDFActionGoTo {
      guard let targetPage = action.destination.page else { return }
      let target = doc.index(for:targetPage)+1
      if let f = frames[target] { scroll.setContentOffset(CGPoint(x:0,y:max(0,f.minY*scroll.zoomScale)),animated:false) }
    } else if let action = annotation.action as? PDFActionURL, let url = action.url,
              ["https","http"].contains(url.scheme?.lowercased() ?? "") { emit(["type":"link","url":url.absoluteString]) }
  }
  private func preview(_ page: PDFPage, _ number: Int, _ width: Double, _ request: String) {
    let token = sourceEpoch, key = "\(number):\(width)" as NSString
    let destination = FileManager.default.temporaryDirectory.appendingPathComponent("reader-pdf-\(UUID().uuidString).png")
    previewQueue.addOperation { [weak self] in
      guard let self = self else { return }
      let size = self.visualSize(page)
      let image = self.previewCache.object(forKey:key) ?? page.thumbnail(of:CGSize(width:width,height:width*size.height/size.width),for:.cropBox)
      guard let data = image.pngData() else { DispatchQueue.main.async { self.error("RENDER_FAILED",request) }; return }
      do { try data.write(to:destination) } catch { DispatchQueue.main.async { self.error("RENDER_FAILED",request) }; return }
      DispatchQueue.main.async {
        guard token == self.sourceEpoch, !self.closing else { try? FileManager.default.removeItem(at:destination); return }
        self.ownedPreviews.insert(destination); self.previewOrder.append(destination)
        while self.previewOrder.count > 24 {
          let old = self.previewOrder.removeFirst(); self.ownedPreviews.remove(old); try? FileManager.default.removeItem(at:old)
        }
        self.previewCache.setObject(image,forKey:key,cost:Int(image.size.width*image.size.height*image.scale*image.scale*4))
        self.emit(["type":"complete","requestId":request,"uri":destination.absoluteString])
      }
    }
  }
  @objc private func memoryWarning() { previewCache.removeAllObjects(); textTextures.removeAllObjects(); updateVisible() }
}

/** Isolated canonical text rendering: no PDF/highlight/handle snapshots. */
final class TextOnlyLens: UIView {
  var textures: [(UIImage, CGRect)] = []
  var sample = CGPoint.zero
  var marker: CGRect?
  var magnification: CGFloat = 1
  var color = UIColor.systemYellow
  var markerWidth: CGFloat = 0
  override init(frame: CGRect) { super.init(frame:frame); backgroundColor = .white; clipsToBounds = true; isUserInteractionEnabled = false; layer.borderWidth = 1; layer.borderColor = UIColor.gray.cgColor }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func draw(_ rect: CGRect) {
    guard let c = UIGraphicsGetCurrentContext() else { return }
    c.translateBy(x:bounds.midX,y:bounds.midY); c.scaleBy(x:magnification,y:magnification); c.translateBy(x:-sample.x,y:-sample.y)
    for (image,box) in textures where !box.isEmpty { image.draw(in:box) }
    if let box = marker { c.setFillColor(color.cgColor); c.fill(CGRect(x:box.minX,y:box.minY,width:markerWidth/magnification,height:box.height)) }
  }
}
private func parseColor(_ value: String) -> UIColor {
  let hex = value.replacingOccurrences(of:"#",with:"")
  if hex.count == 6, let n = UInt32(hex,radix:16) { return UIColor(red:CGFloat((n>>16)&255)/255,green:CGFloat((n>>8)&255)/255,blue:CGFloat(n&255)/255,alpha:1) }
  let channels = value.replacingOccurrences(of:"rgba(",with:"").replacingOccurrences(of:"rgb(",with:"").replacingOccurrences(of:")",with:"").split(separator:",").compactMap { Double($0.trimmingCharacters(in:.whitespaces)) }
  if channels.count >= 3 { return UIColor(red:CGFloat(channels[0]/255),green:CGFloat(channels[1]/255),blue:CGFloat(channels[2]/255),alpha:1) }
  return .systemYellow
}

final class ReaderSelectionPan: UIPanGestureRecognizer {
  var inputType: UITouch.TouchType?
  var onAdditionalTouch: (() -> Void)?
  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    if (event.allTouches?.count ?? 0) > 1 { onAdditionalTouch?() }
    inputType = touches.first?.type
    super.touchesBegan(touches,with:event)
  }
}
final class ReaderSelectionHold: UILongPressGestureRecognizer {
  var inputType: UITouch.TouchType?
  var onAdditionalTouch: (() -> Void)?
  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    if (event.allTouches?.count ?? 0) > 1 { onAdditionalTouch?() }
    inputType = touches.first?.type
    super.touchesBegan(touches,with:event)
  }
}

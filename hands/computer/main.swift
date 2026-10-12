import AppKit
import ApplicationServices
import CoreImage
import CoreMedia
import ScreenCaptureKit

struct ComputerError: Error, LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

func fail(_ message: String) -> ComputerError { ComputerError(message: message) }
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  if AXUIElementCopyAttributeValue(element, name as CFString, &value) != .success { return nil }
  return value
}
func stringValue(_ element: AXUIElement, _ name: String) -> String {
  guard let value = attribute(element, name) else { return "" }
  if let text = value as? String { return String(text.prefix(2000)) }
  if let number = value as? NSNumber { return number.stringValue }
  return ""
}
func rectValue(_ element: AXUIElement) -> CGRect? {
  guard let position = attribute(element, kAXPositionAttribute),
    let size = attribute(element, kAXSizeAttribute),
    CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID()
  else { return nil }
  var point = CGPoint.zero
  var dimensions = CGSize.zero
  guard AXValueGetValue(unsafeBitCast(position, to: AXValue.self), .cgPoint, &point),
    AXValueGetValue(unsafeBitCast(size, to: AXValue.self), .cgSize, &dimensions)
  else { return nil }
  return CGRect(origin: point, size: dimensions)
}
func rectJSON(_ rect: CGRect) -> [String: Double] {
  ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
}
func number(_ args: [String: Any], _ key: String) throws -> Double {
  guard let value = args[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
    value.doubleValue.isFinite
  else {
    throw fail("\(key) 必须是有限数字")
  }
  return value.doubleValue
}
func text(_ args: [String: Any], _ key: String) throws -> String {
  guard let value = args[key] as? String, !value.isEmpty else { throw fail("缺少 \(key)") }
  return value
}
func requireAccessibility() throws {
  if !AXIsProcessTrusted() { throw fail("需要辅助功能权限，请在 菜单栏 iimos 图标里打开「允许它操作这台电脑」,并在系统设置里给 iimos 辅助功能权限") }
}
func targetApp(_ args: [String: Any]) throws -> NSRunningApplication {
  let bundleID = try text(args, "bundleId")
  guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first
  else {
    throw fail("应用未运行：\(bundleID)，请先调用 computer.open(bundleId)")
  }
  return app
}
// 授权来自桌面主进程的本机设置，不能从模型的 args 中开启。
var foregroundAllowed = false
func requireForegroundPermission() throws {
  if !foregroundAllowed {
    throw fail("requires_foreground：此操作会占用鼠标或焦点，用户还没允许它操作这台电脑:请用户在菜单栏 iimos 图标里勾选「允许它操作这台电脑」")
  }
}
func requireFrontmost(_ app: NSRunningApplication) throws {
  try requireForegroundPermission()
  try requireAccessibility()
  if NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier {
    throw fail("目标应用已失去前台焦点，停止本次操作；请重新读取界面")
  }
}
func appJSON(_ app: NSRunningApplication) -> [String: Any] {
  [
    "bundleId": app.bundleIdentifier ?? "", "name": app.localizedName ?? "",
    "pid": app.processIdentifier,
    "active": NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
  ]
}

// 元素引用只属于最近一次界面快照；操作后清空，禁止使用旧编号误点。
var elements: [String: AXUIElement] = [:]
var snapshotPID: pid_t = 0
func state(_ app: NSRunningApplication) throws -> [String: Any] {
  try requireAccessibility()
  elements.removeAll()
  snapshotPID = app.processIdentifier
  let root = AXUIElementCreateApplication(app.processIdentifier)
  AXUIElementSetMessagingTimeout(root, 0.4)
  let snapshot = String(UUID().uuidString.prefix(8))
  let deadline = Date().addingTimeInterval(5)
  var rows: [[String: Any]] = []
  var truncated = false
  func visit(_ element: AXUIElement, _ parent: String?, _ depth: Int) {
    if rows.count >= 1000 || depth > 18 || Date() > deadline {
      truncated = true
      return
    }
    let id = "\(snapshot):\(rows.count)"
    let role = stringValue(element, kAXRoleAttribute)
    let subrole = stringValue(element, kAXSubroleAttribute)
    var row: [String: Any] = ["id": id, "role": role, "depth": depth]
    if let parent { row["parent"] = parent }
    for name in [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute] {
      let value = stringValue(element, name)
      if !value.isEmpty { row[name] = value }
    }
    if subrole != kAXSecureTextFieldSubrole {
      let value = stringValue(element, kAXValueAttribute)
      if !value.isEmpty { row["value"] = value }
    }
    var settable = DarwinBoolean(false)
    AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
    row["valueSettable"] = settable.boolValue && subrole != kAXSecureTextFieldSubrole
    let orientation = stringValue(element, kAXOrientationAttribute)
    if !orientation.isEmpty { row["orientation"] = orientation }
    if let enabled = attribute(element, kAXEnabledAttribute) as? Bool { row["enabled"] = enabled }
    if let frame = rectValue(element) { row["bounds"] = rectJSON(frame) }
    var actions: CFArray?
    if AXUIElementCopyActionNames(element, &actions) == .success {
      row["actions"] = actions as? [String] ?? []
    }
    rows.append(row)
    elements[id] = element
    // 应用的窗口和菜单分开读取，其他节点沿 AXChildren 递归。
    let childNames =
      depth == 0 ? [kAXWindowsAttribute, kAXMenuBarAttribute] : [kAXChildrenAttribute]
    for name in childNames {
      guard let value = attribute(element, name) else { continue }
      if CFGetTypeID(value) == AXUIElementGetTypeID() {
        visit(unsafeBitCast(value, to: AXUIElement.self), id, depth + 1)
      } else if let children = value as? [AXUIElement] {
        for child in children {
          if rows.count >= 1000 || Date() > deadline {
            truncated = true
            break
          }
          visit(child, id, depth + 1)
        }
      }
    }
  }
  visit(root, nil, 0)
  return [
    "app": appJSON(app), "snapshot": snapshot, "elements": rows, "truncated": truncated,
    "control": ["foreground": foregroundAllowed],
    "coordinates": "全局屏幕逻辑坐标，主屏幕左上角为原点；多屏坐标可能为负数",
  ]
}
func resolveElement(_ args: [String: Any], _ app: NSRunningApplication) throws -> AXUIElement {
  let id = try text(args, "element")
  guard snapshotPID == app.processIdentifier, let element = elements[id] else {
    throw fail("元素引用已过期，请先调用 app.state() 获取新的 id")
  }
  return element
}
func checkPoint(_ point: CGPoint) throws {
  var count: UInt32 = 0
  CGGetActiveDisplayList(0, nil, &count)
  var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
  CGGetActiveDisplayList(count, &displays, &count)
  if !displays.contains(where: { CGDisplayBounds($0).contains(point) }) {
    throw fail("坐标不在任何屏幕范围内")
  }
}
// 取消时释放拖拽中的鼠标，避免辅助进程退出后留下按住状态。
final class HeldMouse: @unchecked Sendable {
  private let lock = NSLock()
  private var point: CGPoint?
  func update(_ type: CGEventType, _ location: CGPoint) {
    lock.lock()
    if type == .leftMouseDown || type == .leftMouseDragged { point = location }
    if type == .leftMouseUp { point = nil }
    lock.unlock()
  }
  func release() {
    lock.lock()
    let location = point
    point = nil
    lock.unlock()
    if let location {
      CGEvent(
        mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: location,
        mouseButton: .left)?.post(tap: .cghidEventTap)
    }
  }
}
let heldMouse = HeldMouse()

func mouse(_ type: CGEventType, _ point: CGPoint, _ button: CGMouseButton = .left, _ count: Int = 1)
  throws
{
  guard
    let event = CGEvent(
      mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button)
  else {
    throw fail("无法创建鼠标事件")
  }
  event.setIntegerValueField(.mouseEventClickState, value: Int64(count))
  heldMouse.update(type, point)
  event.post(tap: .cghidEventTap)
}
let keys: [String: CGKeyCode] = [
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11,
  "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21,
  "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31,
  "u": 32, "[": 33, "i": 34, "p": 35, "enter": 36, "l": 37, "j": 38, "'": 39, "k": 40,
  ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "tab": 48, "space": 49,
  "`": 50, "backspace": 51, "escape": 53, "delete": 117, "home": 115, "end": 119,
  "pageup": 116, "pagedown": 121, "left": 123, "right": 124, "down": 125, "up": 126,
  "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100,
  "f9": 101, "f10": 109, "f11": 103, "f12": 111,
]
func press(_ shortcut: String) throws {
  let parts = shortcut.lowercased().split(separator: "+").map(String.init)
  guard let last = parts.last, let key = keys[last] else { throw fail("不支持的按键：\(shortcut)") }
  var flags: CGEventFlags = []
  for modifier in parts.dropLast() {
    switch modifier {
    case "cmd": flags.insert(.maskCommand)
    case "ctrl": flags.insert(.maskControl)
    case "alt": flags.insert(.maskAlternate)
    case "shift": flags.insert(.maskShift)
    default: throw fail("不支持的修饰键：\(modifier)")
    }
  }
  guard let down = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: true),
    let up = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: false)
  else { throw fail("无法创建键盘事件") }
  down.flags = flags
  up.flags = flags
  down.post(tap: .cghidEventTap)
  up.post(tap: .cghidEventTap)
}

// ScreenCaptureKit 取一帧。请求完成与超时只允许交付一次结果。
final class FrameCapture: NSObject, SCStreamOutput, @unchecked Sendable {
  private let lock = NSLock()
  private var result: Result<Data, Error>?
  private var continuation: CheckedContinuation<Data, Error>?
  func finish(_ value: Result<Data, Error>) {
    lock.lock()
    if result != nil {
      lock.unlock()
      return
    }
    result = value
    let waiting = continuation
    continuation = nil
    lock.unlock()
    waiting?.resume(with: value)
  }
  func frame() async throws -> Data {
    try await withCheckedThrowingContinuation { waiting in
      lock.lock()
      if let value = result {
        lock.unlock()
        waiting.resume(with: value)
        return
      }
      continuation = waiting
      lock.unlock()
    }
  }
  func stream(
    _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of type: SCStreamOutputType
  ) {
    guard type == .screen, sampleBuffer.isValid,
      let attachments = CMSampleBufferGetSampleAttachmentsArray(
        sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
      let status = attachments.first?[.status] as? Int, status == SCFrameStatus.complete.rawValue,
      let buffer = sampleBuffer.imageBuffer
    else { return }
    let image = CIImage(cvPixelBuffer: buffer)
    guard let cgImage = CIContext().createCGImage(image, from: image.extent),
      let png = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:])
    else {
      finish(.failure(fail("截图编码失败")))
      return
    }
    finish(.success(png))
  }
}
func screenshot(_ args: [String: Any]) async throws -> [String: Any] {
  if !CGPreflightScreenCaptureAccess() { throw fail("需要屏幕录制权限，请在 菜单栏 iimos 图标里打开「允许它操作这台电脑」,并在系统设置里给 iimos 辅助功能权限") }
  let content = try await SCShareableContent.excludingDesktopWindows(
    false, onScreenWindowsOnly: true)
  let filter: SCContentFilter
  let bounds: CGRect
  if args["bundleId"] != nil {
    let app = try targetApp(args)
    let windows = content.windows.filter {
      $0.owningApplication?.processID == app.processIdentifier && $0.windowLayer == 0
    }
    let root = AXUIElementCreateApplication(app.processIdentifier)
    var focusedBounds: CGRect?
    if let focused = attribute(root, kAXFocusedWindowAttribute),
      CFGetTypeID(focused) == AXUIElementGetTypeID()
    {
      focusedBounds = rectValue(unsafeBitCast(focused, to: AXUIElement.self))
    }
    var chosen = windows.first
    if let focusedBounds {
      chosen = windows.first(where: {
        abs($0.frame.minX - focusedBounds.minX) < 3 && abs($0.frame.minY - focusedBounds.minY) < 3
          && abs($0.frame.width - focusedBounds.width) < 3
      })
    }
    guard let window = chosen else { throw fail("没有找到可截图的目标窗口；可使用 computer.screenshot() 查看屏幕") }
    bounds = window.frame
    filter = SCContentFilter(desktopIndependentWindow: window)
  } else {
    let id = (args["displayId"] as? NSNumber)?.uint32Value ?? CGMainDisplayID()
    guard let display = content.displays.first(where: { $0.displayID == id }) else {
      throw fail("显示器不存在")
    }
    bounds = CGDisplayBounds(id)
    filter = SCContentFilter(display: display, excludingWindows: [])
  }
  if bounds.width <= 0 || bounds.height <= 0 { throw fail("截图区域无效") }
  let scale = min(1, 4096 / max(bounds.width, bounds.height))
  let configuration = SCStreamConfiguration()
  configuration.width = max(1, Int(bounds.width * scale))
  configuration.height = max(1, Int(bounds.height * scale))
  configuration.showsCursor = true
  configuration.capturesAudio = false
  let output = FrameCapture()
  let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
  try stream.addStreamOutput(
    output, type: .screen, sampleHandlerQueue: DispatchQueue(label: "iimos.capture"))
  try await stream.startCapture()
  let timeout = Task {
    do {
      try await Task.sleep(nanoseconds: 5_000_000_000)
      output.finish(.failure(fail("截图超时")))
    } catch {}
  }
  do {
    let png = try await output.frame()
    timeout.cancel()
    try await stream.stopCapture()
    return [
      "png": png.base64EncodedString(), "width": configuration.width,
      "height": configuration.height,
      "bounds": rectJSON(bounds), "scale": scale,
      "coordinates": "图片坐标转换为屏幕逻辑坐标：x=bounds.x+图片x/scale，y=bounds.y+图片y/scale",
    ]
  } catch {
    timeout.cancel()
    try? await stream.stopCapture()
    throw error
  }
}

@MainActor func execute(_ method: String, _ args: [String: Any]) async throws -> Any {
  switch method {
  case "permissions":
    return ["accessibility": AXIsProcessTrusted(), "screen": CGPreflightScreenCaptureAccess()]
  case "requestPermission":
    let kind = try text(args, "kind")
    if kind == "accessibility" {
      _ = AXIsProcessTrustedWithOptions(
        [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    } else if kind == "screen" {
      _ = CGRequestScreenCaptureAccess()
    } else {
      throw fail("权限类型无效")
    }
    return ["accessibility": AXIsProcessTrusted(), "screen": CGPreflightScreenCaptureAccess()]
  case "apps":
    return NSWorkspace.shared.runningApplications.filter {
      $0.activationPolicy == .regular && $0.bundleIdentifier != nil
    }.map(appJSON)
  case "displays":
    var count: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &count)
    var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
    CGGetActiveDisplayList(count, &displays, &count)
    return displays.map {
      ["id": $0, "bounds": rectJSON(CGDisplayBounds($0)), "main": $0 == CGMainDisplayID()]
        as [String: Any]
    }
  case "open":
    let id = try text(args, "bundleId")
    guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) else {
      throw fail("没有安装应用：\(id)")
    }
    let config = NSWorkspace.OpenConfiguration()
    config.activates = false
    let app = try await NSWorkspace.shared.openApplication(at: url, configuration: config)
    elements.removeAll()
    return appJSON(app)
  case "screenshot": return try await screenshot(args)
  default: break
  }
  let app = try targetApp(args)
  if method == "state" { return try state(app) }
  if method == "focus" {
    try requireForegroundPermission()
    try requireAccessibility()
    elements.removeAll()
    app.activate(options: [.activateIgnoringOtherApps])
    for _ in 0..<20 {
      if NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier {
        return appJSON(app)
      }
      try await Task.sleep(nanoseconds: 50_000_000)
    }
    throw fail("应用未能切到前台")
  }
  try requireAccessibility()
  defer { elements.removeAll() }
  switch method {
  case "click":
    if args["element"] != nil {
      let element = try resolveElement(args, app)
      let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
      if result != .success { throw fail("元素点击失败（\(result.rawValue)）；请重新读取界面确认结果，勿盲目重试") }
    } else {
      try requireFrontmost(app)
      let point = CGPoint(x: try number(args, "x"), y: try number(args, "y"))
      try checkPoint(point)
      let buttonName = args["button"] as? String ?? "left"
      if buttonName != "left" && buttonName != "right" { throw fail("button 必须为 left 或 right") }
      let right = buttonName == "right"
      let count = (args["count"] as? Int) ?? 1
      if count != 1 && count != 2 { throw fail("count 必须为 1 或 2") }
      for index in 1...count {
        try requireFrontmost(app)
        try mouse(right ? .rightMouseDown : .leftMouseDown, point, right ? .right : .left, index)
        try mouse(right ? .rightMouseUp : .leftMouseUp, point, right ? .right : .left, index)
      }
    }
  case "action":
    let element = try resolveElement(args, app)
    let action = try text(args, "action")
    if ![kAXPressAction, kAXIncrementAction, kAXDecrementAction].contains(action) {
      try requireForegroundPermission()
    }
    var supportedActions: CFArray?
    AXUIElementCopyActionNames(element, &supportedActions)
    if !(supportedActions as? [String] ?? []).contains(action) {
      throw fail("此元素不支持该操作，请使用 state 返回的 actions")
    }
    let result = AXUIElementPerformAction(element, action as CFString)
    if result != .success { throw fail("元素操作失败（\(result.rawValue)）；请重新读取界面") }
  case "setValue":
    let element = try resolveElement(args, app)
    var settable = DarwinBoolean(false)
    AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
    if !settable.boolValue { throw fail("此元素不支持直接设置值，请读取界面选择其他可用操作") }
    let value: CFTypeRef
    if stringValue(element, kAXRoleAttribute) == kAXScrollBarRole {
      let position = try number(args, "value")
      if position < 0 || position > 1 { throw fail("滚动条 value 必须在 0 到 1 之间") }
      value = NSNumber(value: position)
    } else {
      guard let content = args["value"] as? String else { throw fail("value 必须为字符串") }
      value = content as CFString
    }
    let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value)
    if result != .success { throw fail("此元素不能直接设置值（\(result.rawValue)）") }
  case "type":
    try requireFrontmost(app)
    let value = try text(args, "text")
    if value.utf16.count > 20000 { throw fail("单次输入最多 20000 个 UTF-16 字符") }
    // 逐字符发送并清空修饰键；一条事件中的换行可能让应用丢掉剩余文本。
    // 不拆开表情的代理对，给目标应用时间消费事件。
    for character in value {
      let units = Array(String(character).utf16)
      try requireFrontmost(app)
      guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
        let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
      else { throw fail("无法创建输入事件") }
      down.flags = []
      up.flags = []
      units.withUnsafeBufferPointer { buffer in
        down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: buffer.baseAddress)
        up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: buffer.baseAddress)
      }
      down.post(tap: .cghidEventTap)
      up.post(tap: .cghidEventTap)
      try await Task.sleep(nanoseconds: 10_000_000)
    }
  case "press":
    try requireFrontmost(app)
    try press(try text(args, "key"))
  case "scroll":
    try requireFrontmost(app)
    let point = CGPoint(x: try number(args, "x"), y: try number(args, "y"))
    try checkPoint(point)
    let dy = try number(args, "dy")
    let dx = try number(args, "dx")
    if abs(dx) > 10000 || abs(dy) > 10000 { throw fail("单次滚动距离不能超过 10000") }
    try mouse(.mouseMoved, point)
    guard
      let event = CGEvent(
        scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: Int32(-dy),
        wheel2: Int32(-dx), wheel3: 0)
    else { throw fail("无法创建滚动事件") }
    event.location = point
    event.post(tap: .cghidEventTap)
  case "drag":
    try requireFrontmost(app)
    let from = CGPoint(x: try number(args, "fromX"), y: try number(args, "fromY"))
    let to = CGPoint(x: try number(args, "toX"), y: try number(args, "toY"))
    try checkPoint(from)
    try checkPoint(to)
    var current = from
    try mouse(.leftMouseDown, from)
    defer { try? mouse(.leftMouseUp, current) }
    for step in 1...20 {
      try requireFrontmost(app)
      current = CGPoint(
        x: from.x + (to.x - from.x) * Double(step) / 20,
        y: from.y + (to.y - from.y) * Double(step) / 20)
      try mouse(.leftMouseDragged, current)
      try await Task.sleep(nanoseconds: 20_000_000)
    }
  default: throw fail("未知操作：\(method)")
  }
  // 给应用处理事件的时间；下一步仍由模型读取真实状态确认。
  try await Task.sleep(nanoseconds: 100_000_000)
  return ["ok": true]
}

@main struct ComputerHelper {
  @MainActor static func main() {
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    Task {
      await serve()
      exit(0)
    }
    // AppKit 需要主线程事件循环来更新前台应用状态和处理激活请求。
    application.run()
  }

  @MainActor static func serve() async {
    signal(SIGTERM, SIG_IGN)
    let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
    terminate.setEventHandler {
      heldMouse.release()
      exit(0)
    }
    terminate.resume()
    defer {
      heldMouse.release()
      terminate.cancel()
    }
    do {
      for try await line in FileHandle.standardInput.bytes.lines {
        var id: Any = NSNull()
        var reply: [String: Any]
        do {
          guard let data = line.data(using: .utf8),
            let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let method = request["method"] as? String
          else { throw fail("无效请求") }
          id = request["id"] ?? NSNull()
          foregroundAllowed = request["foreground"] as? Bool == true
          let result = try await execute(method, request["args"] as? [String: Any] ?? [:])
          reply = ["id": id, "result": result]
        } catch { reply = ["id": id, "error": error.localizedDescription] }
        let output = try JSONSerialization.data(withJSONObject: reply, options: [.sortedKeys])
        FileHandle.standardOutput.write(output)
        FileHandle.standardOutput.write(Data([10]))
      }
    } catch {
      FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
    }
  }
}

import AppKit
import TerminalCore

// Use the shipping views, with an isolated layout and controlled shell output.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func remove(_ controller: TerminalWindowController) {}
}

@main
struct Capture {
    @MainActor static func main() throws {
        let output = CommandLine.arguments[1]
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        app.appearance = NSAppearance(named: .darkAqua)
        let root = URL(fileURLWithPath: "/tmp/tabdance-article/demo")
        for directory in ["TabDance", "TabDance/Sources", "TabDance/Tests", "mainbrella", "scratch"] {
            try FileManager.default.createDirectory(at: root.appendingPathComponent(directory), withIntermediateDirectories: true)
            try Data("alpha\nbeta\ngamma\n".utf8).write(to: root.appendingPathComponent(directory).appendingPathComponent("demo.txt"))
        }
        var layout = WorkspaceLayout(directory: root.appendingPathComponent("TabDance").path)
        let sources = layout.addTab()
        layout.updateTab(sources.id, directory: root.appendingPathComponent("TabDance/Sources").path)
        let tests = layout.addTab()
        layout.updateTab(tests.id, directory: root.appendingPathComponent("TabDance/Tests").path)
        layout.addWorkspace(directory: root.appendingPathComponent("mainbrella").path)
        layout.addWorkspace(directory: root.appendingPathComponent("scratch").path)
        layout.selectWorkspace(at: 0)
        layout.selectTab(layout.workspaces[0].tabs[0].id)
        let state = root.appendingPathComponent("capture-layout.json")
        try JSONEncoder().encode(layout).write(to: state)
        let command = LaunchCommand(executable: "/bin/sh", arguments: ["-c", "printf '$ cat demo.txt\\r\\n'; cat demo.txt; printf '\\r\\n$ '; read reply"], loginName: nil)
        let controller = TerminalWindowController(command: command, stateURL: state)
        guard let window = controller.window, let view = window.contentView?.superview else { fatalError("Missing window") }
        let narrow = CommandLine.arguments.contains("--narrow")
        window.setContentSize(NSSize(width: narrow ? 640 : 960, height: 320))
        window.contentView?.layoutSubtreeIfNeeded()
        _ = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: false) { _ in
            MainActor.assumeIsolated {
                app.activate(ignoringOtherApps: true)
                view.displayIfNeeded()
                guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { fatalError("Missing bitmap") }
                view.cacheDisplay(in: view.bounds, to: bitmap)
                if let terminal = window.firstResponder as? TabDanceTerminalView {
                    let frame = terminal.convert(terminal.bounds, to: view)
                    let terminalBitmap = terminal.bitmapImageRepForCachingDisplay(in: terminal.bounds)!
                    terminal.cacheDisplay(in: terminal.bounds, to: terminalBitmap)
                    NSGraphicsContext.saveGraphicsState()
                    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
                    NSGraphicsContext.current = context
                    // Cache the terminal layer separately: parent view caching omits it.
                    // The native background belongs to the layer, not the transparent glyph bitmap.
                    terminal.nativeBackgroundColor.setFill()
                    frame.fill()
                    let terminalImage = NSImage(size: terminal.bounds.size)
                    terminalImage.addRepresentation(terminalBitmap)
                    terminalImage.draw(in: frame, from: .zero, operation: .sourceOver, fraction: 1)
                    NSGraphicsContext.restoreGraphicsState()
                }
                try! bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output))
                print("Captured \(bitmap.pixelsWide)x\(bitmap.pixelsHigh) to \(output)")
                controller.stopSessions()
                window.close()
                exit(0)
            }
        }
        app.run()
    }
}

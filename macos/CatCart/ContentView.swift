import SwiftUI
import WebKit

struct ContentView: View {
    var body: some View {
        GameView()
            .frame(minWidth: 960, minHeight: 600)
            .ignoresSafeArea()
            .navigationTitle("CatCart")
    }
}

/// Shows the built web game (the `dist` folder bundled into the app) in a web view.
struct GameView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Serve the game from app://game/ instead of file://, which blocks the game's JS modules.
        config.setURLSchemeHandler(BundledFiles(), forURLScheme: "app")
        // Keep records and settings (localStorage) between launches.
        config.websiteDataStore = .default()
        config.mediaTypesRequiringUserActionForPlayback = []

        let web = GameWebView(frame: .zero, configuration: config)
        web.load(URLRequest(url: URL(string: "app://game/index.html")!))
        return web
    }

    func updateNSView(_ view: WKWebView, context: Context) {}
}

/// A web view that takes keyboard focus as soon as it's on screen, so the arrow keys drive right away.
final class GameWebView: WKWebView {
    override var acceptsFirstResponder: Bool { true }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.makeFirstResponder(self)
    }
}

/// Answers app://game/... requests with files from the `dist` folder in the app bundle.
final class BundledFiles: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.resourceURL!.appendingPathComponent("dist")
    private let types = [
        "html": "text/html", "js": "text/javascript", "css": "text/css", "json": "application/json",
        "png": "image/png", "jpg": "image/jpeg", "webp": "image/webp", "svg": "image/svg+xml",
        "ico": "image/x-icon", "woff2": "font/woff2", "mp3": "audio/mpeg", "wav": "audio/wav",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path)
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let mime = types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let response = HTTPURLResponse(
            url: url, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": mime, "Content-Length": String(data.count)])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

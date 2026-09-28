import SwiftUI
import WebKit

struct ContentView: View {
    var body: some View {
        GameView()
            .ignoresSafeArea()
            .background(Color.black)
            .statusBarHidden()
            // Keep the home bar out of the way and stop edge swipes from leaving mid-race.
            .persistentSystemOverlays(.hidden)
            .defersSystemGestures(on: .all)
    }
}

/// Shows the built web game (the `dist` folder bundled into the app) full screen.
struct GameView: UIViewRepresentable {
    func makeCoordinator() -> Permissions { Permissions() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Serve the game from app://game/ instead of file://, which blocks the game's JS modules.
        config.setURLSchemeHandler(BundledFiles(), forURLScheme: "app")
        // Keep records and settings (localStorage) between launches.
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        #if DEBUG
        // Print the game's JS errors and console output to the Xcode console.
        config.userContentController.add(context.coordinator, name: "log")
        config.userContentController.addUserScript(WKUserScript(
            source: """
            (() => {
              const send = (kind, args) => window.webkit.messageHandlers.log.postMessage(
                kind + ': ' + Array.from(args, (a) => a instanceof Error ? a.stack || String(a) : String(a)).join(' '));
              for (const k of ['log', 'warn', 'error']) {
                const orig = console[k];
                console[k] = (...a) => { send(k, a); orig.apply(console, a); };
              }
              addEventListener('error', (e) => send('uncaught', [e.message + ' @ ' + e.filename + ':' + e.lineno]));
              addEventListener('unhandledrejection', (e) => send('unhandled rejection', [e.reason]));
            })();
            """,
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        #endif

        let web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = .black
        // The game is one fixed screen: no scrolling, bouncing or safe-area insets.
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        // Lets Safari's Web Inspector (Develop menu on the Mac) debug the game.
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        web.load(URLRequest(url: URL(string: "app://game/index.html")!))
        return web
    }

    func updateUIView(_ view: WKWebView, context: Context) {}
}

/// Lets the game read the tilt sensor for steering without an extra web permission prompt.
final class Permissions: NSObject, WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.grant)
    }
}

extension Permissions: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        NSLog("[game] %@", String(describing: message.body))
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

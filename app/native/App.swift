// HomeView shell for iPad Air 2 (iOS 15, installed with TrollStore).
// A full-screen WKWebView runs web/index.html. Documents/config.json (written
// over SSH, holds the HA token) is injected as window.HV_CONFIG before any page
// script runs. Logs go to Documents/log.jsonl on the iPad only.
import UIKit
import WebKit

enum Log {
    static let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("log.jsonl")
    private static let stamp = ISO8601DateFormatter()
    private static let queue = DispatchQueue(label: "log")
    private static let maxBytes: UInt64 = 2_000_000

    static func write(_ object: [String: Any]) {
        var o = object
        o["native_t"] = stamp.string(from: Date())
        guard JSONSerialization.isValidJSONObject(o),
              var line = try? JSONSerialization.data(withJSONObject: o) else { return }
        line.append(0x0A)
        queue.async {
            let fm = FileManager.default
            if let size = (try? fm.attributesOfItem(atPath: file.path))?[.size] as? UInt64, size > maxBytes {
                let old = file.deletingPathExtension().appendingPathExtension("1.jsonl")
                try? fm.removeItem(at: old)
                try? fm.moveItem(at: file, to: old)
            }
            if let h = try? FileHandle(forWritingTo: file) {
                h.seekToEndOfFile()
                h.write(line)
                try? h.close()
            } else {
                try? line.write(to: file)
            }
        }
    }
}

final class ViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private var web: WKWebView!
    private var config: [String: Any] = [:]
    private var configStamp: Date?
    private var webStamp: Date?
    static let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    static let configURL = documents.appendingPathComponent("config.json")
    /// tools/deploy.sh web puts the page here (and touches .stamp): updates without reinstalling.
    static let docsWeb = documents.appendingPathComponent("web")
    static let webStampURL = docsWeb.appendingPathComponent(".stamp")

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }

    override func loadView() {
        let wc = WKWebViewConfiguration()
        wc.userContentController.add(self, name: "native")
        injectConfig(into: wc.userContentController)
        wc.allowsInlineMediaPlayback = true
        wc.mediaTypesRequiringUserActionForPlayback = []
        web = WKWebView(frame: .zero, configuration: wc)
        web.isOpaque = true
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsLinkPreview = false
        web.navigationDelegate = self
        view = web
    }

    private static func stamp(_ url: URL = configURL) -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
    }

    /// Documents/web when deployed there, else the copy in the app bundle.
    private func loadPage() {
        webStamp = ViewController.stamp(ViewController.webStampURL)
        let useDocs = FileManager.default.fileExists(atPath: ViewController.docsWeb.appendingPathComponent("index.html").path)
        let dir = useDocs ? ViewController.docsWeb : Bundle.main.bundleURL.appendingPathComponent("web")
        web.loadFileURL(dir.appendingPathComponent("index.html"), allowingReadAccessTo: dir)
        Log.write(["event": "page", "source": useDocs ? "Documents" : "bundle"])
    }

    /// Documents/config.json becomes window.HV_CONFIG before any page script runs.
    private func injectConfig(into ucc: WKUserContentController) {
        ucc.removeAllUserScripts()
        configStamp = ViewController.stamp()
        config = [:]
        guard let data = try? Data(contentsOf: ViewController.configURL),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let json = String(data: data, encoding: .utf8) else { return }
        config = obj
        ucc.addUserScript(WKUserScript(source: "window.HV_CONFIG = \(json);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    /// Coming back to the foreground: if config.json changed (e.g. written over SSH), reload with it.
    @objc private func becameActive() {
        let configChanged = ViewController.stamp() != configStamp
        let webChanged = ViewController.stamp(ViewController.webStampURL) != webStamp
        guard configChanged || webChanged else { return }
        if configChanged { injectConfig(into: web.configuration.userContentController) }
        Log.write(["event": "reloaded", "config": configChanged, "web": webChanged])
        loadPage()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        NotificationCenter.default.addObserver(self, selector: #selector(becameActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
        // also notice a config written over SSH while the app stays on screen
        Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.becameActive() }
        Log.write(["event": "launch", "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? "?",
                   "hasConfig": !config.isEmpty, "system": UIDevice.current.systemVersion,
                   "thermal": ProcessInfo.processInfo.thermalState.rawValue])
        loadPage()
    }

    // The web content process can be killed under memory pressure; bring the page back.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Log.write(["event": "webcontent_terminated"])
        webView.reload()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let msg = message.body as? [String: Any], let cmd = msg["cmd"] as? String else { return }
        switch cmd {
        case "log":
            if let body = msg["body"] as? [String: Any] { Log.write(body) }
        case "brightness":
            if let v = msg["value"] as? Double { UIScreen.main.brightness = CGFloat(max(0, min(1, v))) }
        case "files.write", "files.read", "files.list", "files.delete":
            files(cmd, msg)
        default:
            Log.write(["event": "unknown_cmd", "cmd": cmd])
        }
    }

    // ---- files: a tiny store under Documents/<dir> for the page (photos) -------------------------
    // The page calls {cmd, id, dir, name, data(base64)}; the reply goes to window.HVNative._reply(id, ok, result).
    private static let fileDirs: Set<String> = ["photos"]
    private let fileQueue = DispatchQueue(label: "files", qos: .userInitiated)

    private func reply(_ id: Any?, _ ok: Bool, _ result: Any) {
        guard let id = id else { return }
        let payload: [String: Any] = ["id": id, "ok": ok, "result": result]
        guard let d = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: d, encoding: .utf8) else { return }
        DispatchQueue.main.async { self.web.evaluateJavaScript("window.HVNative && HVNative._reply(\(json))", completionHandler: nil) }
    }

    private func files(_ cmd: String, _ msg: [String: Any]) {
        let id = msg["id"]
        guard let dirName = msg["dir"] as? String, ViewController.fileDirs.contains(dirName) else { reply(id, false, "bad dir"); return }
        let dir = ViewController.documents.appendingPathComponent(dirName)
        let name = (msg["name"] as? String) ?? ""
        let safe = !name.isEmpty && name.range(of: "^[A-Za-z0-9._-]{1,80}$", options: .regularExpression) != nil && !name.hasPrefix(".")
        fileQueue.async {
            let fm = FileManager.default
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
            switch cmd {
            case "files.list":
                let names = ((try? fm.contentsOfDirectory(atPath: dir.path)) ?? []).filter { !$0.hasPrefix(".") }.sorted()
                self.reply(id, true, names)
            case "files.write":
                guard safe, let b64 = msg["data"] as? String, let data = Data(base64Encoded: b64) else { self.reply(id, false, "bad write"); return }
                do { try data.write(to: dir.appendingPathComponent(name), options: .atomic); self.reply(id, true, data.count) }
                catch { self.reply(id, false, error.localizedDescription) }
            case "files.read":
                guard safe, let data = try? Data(contentsOf: dir.appendingPathComponent(name)) else { self.reply(id, false, "not found"); return }
                self.reply(id, true, data.base64EncodedString())
            case "files.delete":
                guard safe else { self.reply(id, false, "bad name"); return }
                try? fm.removeItem(at: dir.appendingPathComponent(name))
                self.reply(id, true, true)
            default:
                self.reply(id, false, "unknown")
            }
        }
    }
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ app: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        app.isIdleTimerDisabled = true      // a home display stays on
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.backgroundColor = .black
        w.rootViewController = ViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }
}

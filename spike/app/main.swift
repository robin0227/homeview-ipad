// HVSpike: the smallest version of the HomeView shell for iPad Air 2 (iOS 15).
// A full-screen WKWebView runs web/index.html (GPU benchmark), then the native
// layer measures the microphone with the system voice processing (echo
// cancellation) on. Everything is logged to Documents/log.jsonl and, while the
// spike runs, also sent to the Mac's collector.
import AudioToolbox
import AVFoundation
import UIKit
import WebKit

// The Mac running ../serve.py while the spike is measured; change to your Mac's LAN address.
let collector = URL(string: "http://192.168.1.10:8770/result")!

enum Log {
    static let file: URL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("log.jsonl")
    static let stamp = ISO8601DateFormatter()

    static func write(_ object: [String: Any]) {
        var o = object
        o["native_t"] = stamp.string(from: Date())
        guard JSONSerialization.isValidJSONObject(o),
              let data = try? JSONSerialization.data(withJSONObject: o) else { return }
        var line = data
        line.append(0x0A)
        if let h = try? FileHandle(forWritingTo: file) {
            h.seekToEndOfFile()
            h.write(line)
            try? h.close()
        } else {
            try? line.write(to: file)
        }
        var req = URLRequest(url: collector, timeoutInterval: 5)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = data
        URLSession.shared.dataTask(with: req).resume()
    }
}

/// CPU time used by this process (not the WebContent process) between calls.
struct CPUMeter {
    private var lastCPU = CPUMeter.cpuSeconds()
    private var lastWall = CACurrentMediaTime()

    static func cpuSeconds() -> Double {
        var u = rusage()
        getrusage(RUSAGE_SELF, &u)
        return Double(u.ru_utime.tv_sec) + Double(u.ru_utime.tv_usec) / 1e6
            + Double(u.ru_stime.tv_sec) + Double(u.ru_stime.tv_usec) / 1e6
    }

    /// Percent of one core since the last call.
    mutating func sample() -> Double {
        let cpu = CPUMeter.cpuSeconds(), wall = CACurrentMediaTime()
        defer { lastCPU = cpu; lastWall = wall }
        return wall > lastWall ? (cpu - lastCPU) / (wall - lastWall) * 100 : 0
    }
}

final class Mic {
    private let engine = AVAudioEngine()
    private var levels: [Float] = []
    private var buffers = 0
    var onLevel: ((Float) -> Void)?
    /// Called on the audio thread with each buffer (mono float, `rate` Hz).
    var onSamples: ((UnsafePointer<Float>, Int, Int) -> Void)?

    func start() throws -> [String: Any] {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker])
        try session.setPreferredSampleRate(16_000)
        try session.setPreferredIOBufferDuration(0.02)
        try session.setActive(true)
        let input = engine.inputNode
        var vp = "off"
        do {
            try input.setVoiceProcessingEnabled(true)
            vp = "on"
        } catch {
            vp = "error: \(error.localizedDescription)"
        }
        let format = input.outputFormat(forBus: 0)
        let rate = Int(format.sampleRate)
        input.installTap(onBus: 0, bufferSize: 1600, format: format) { [weak self] buffer, _ in
            guard let samples = buffer.floatChannelData?[0] else { return }
            let n = Int(buffer.frameLength)
            self?.onSamples?(samples, n, rate)
            var sum: Float = 0
            for i in 0..<n { sum += samples[i] * samples[i] }
            let db = 10 * log10(max(sum / Float(max(n, 1)), 1e-10))
            DispatchQueue.main.async {
                guard let self else { return }
                self.buffers += 1
                self.levels.append(db)
                if self.levels.count > 20_000 { self.levels.removeFirst(10_000) }
                self.onLevel?(db)
            }
        }
        engine.prepare()
        try engine.start()
        return [
            "voiceProcessing": vp,
            "formatRate": format.sampleRate,
            "channels": Int(format.channelCount),
            "sessionRate": session.sampleRate,
            "ioBuffer": session.ioBufferDuration,
            "inputs": session.availableInputs?.map { $0.portName } ?? [],
        ]
    }

    func stop() -> [String: Any] {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let sorted = levels.sorted()
        func pct(_ p: Double) -> Float { sorted.isEmpty ? -100 : sorted[min(sorted.count - 1, Int(p * Double(sorted.count)))] }
        return ["buffers": buffers, "p10_db": pct(0.1), "p50_db": pct(0.5), "p95_db": pct(0.95), "max_db": sorted.last ?? -100]
    }
}

final class ViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private var web: WKWebView!
    private let mic = Mic()
    private var cpu = CPUMeter()
    private var hasConfig = false
    private var settings: [String: Any] = [:]
    private var kwsVariants: [(String, Kws)] = []
    private var kwsTimer: Timer?
    static let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    static let configURL = documents.appendingPathComponent("config.json")

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "native")
        // Documents/config.json ({"ha_url": ..., "token": ...}) is put there over SSH,
        // so the token never lives in the bundle. Pages read it as window.HV_CONFIG.
        if let data = try? Data(contentsOf: ViewController.configURL),
           let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           let json = String(data: data, encoding: .utf8) {
            config.userContentController.addUserScript(WKUserScript(
                source: "window.HV_CONFIG = \(json);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
            hasConfig = true
            settings = obj
        }
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.navigationDelegate = self
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let dir = Bundle.main.bundleURL.appendingPathComponent("web")
        // config.json "page": kws | ha | index (default kws)
        let page = (settings["page"] as? String).flatMap { ["kws", "ha", "index"].contains($0) ? $0 : nil } ?? "kws"
        web.loadFileURL(dir.appendingPathComponent("\(page).html"), allowingReadAccessTo: dir)
        let d = UIDevice.current
        Log.write(["event": "launch", "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? "?",
                   "hasConfig": hasConfig, "model": d.model, "system": d.systemVersion,
                   "screen": "\(UIScreen.main.nativeBounds.size)", "scale": UIScreen.main.scale,
                   "memMB": ProcessInfo.processInfo.physicalMemory / 1_048_576,
                   "thermal": ProcessInfo.processInfo.thermalState.rawValue])
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Log.write(["event": "webcontent_terminated"])
        webView.reload()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let msg = message.body as? [String: Any], let cmd = msg["cmd"] as? String else { return }
        switch cmd {
        case "log":
            if let body = msg["body"] as? [String: Any] { Log.write(body) }
        case "mic":
            runMic(seconds: (msg["seconds"] as? Double) ?? 30)
        case "kws_start":
            startKws()
        default:
            Log.write(["event": "unknown_cmd", "cmd": cmd])
        }
    }

    private func js(_ code: String) { web.evaluateJavaScript(code, completionHandler: nil) }

    private func jsCall(_ fn: String, _ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
        js("\(fn)(\(s))")
    }

    /// Continuous wake-word test: mic (voice processing on) → one or more sherpa-onnx spotters fed
    /// the same audio, so configurations can be compared on identical utterances.
    /// config.json "kws_variants": [{"name", "model" ("bundle" or a folder in Documents),
    /// "keywords" (file in Documents, optional), "threshold", "score"}]. Default: the bundled model.
    private func startKws() {
        guard kwsVariants.isEmpty else { return }
        let docs = ViewController.documents
        let bundleModel = Bundle.main.bundleURL.appendingPathComponent("models/kws")
        var specs = (settings["kws_variants"] as? [[String: Any]]) ?? []
        if specs.isEmpty {
            specs = [["name": "A", "model": "bundle", "threshold": settings["kws_threshold"] ?? 0.25, "score": settings["kws_score"] ?? 1.5]]
        }
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else { self.jsCall("onKwsStatus", ["error": "麦克风权限被拒绝"]); return }
                var described: [[String: Any]] = []
                var lastBeep = 0.0
                for spec in specs {
                    let name = spec["name"] as? String ?? "?"
                    let modelName = spec["model"] as? String ?? "bundle"
                    let modelDir = modelName == "bundle" ? bundleModel : docs.appendingPathComponent(modelName)
                    let kwURL = (spec["keywords"] as? String).map { docs.appendingPathComponent($0) }
                        ?? modelDir.appendingPathComponent("keywords.txt")
                    let keywords = (try? String(contentsOf: kwURL, encoding: .utf8)) ?? ""
                    let threshold = Float((spec["threshold"] as? Double) ?? 0.25)
                    let score = Float((spec["score"] as? Double) ?? 1.5)
                    var d: [String: Any] = ["name": name, "model": modelName, "threshold": threshold, "score": score,
                                            "keywords": keywords.split(separator: "\n").map(String.init)]
                    do {
                        let t0 = CACurrentMediaTime()
                        let k = try Kws(modelDir: modelDir, keywords: keywords, threshold: threshold, score: score)
                        d["loadMs"] = Int((CACurrentMediaTime() - t0) * 1000)
                        k.onKeyword = { word in
                            let now = CACurrentMediaTime()
                            if now - lastBeep > 1.5 { lastBeep = now; AudioServicesPlaySystemSound(1113) }
                            let e: [String: Any] = ["event": "kws_hit", "variant": name, "keyword": word]
                            Log.write(e)
                            self.jsCall("onKwsHit", e)
                        }
                        self.kwsVariants.append((name, k))
                    } catch {
                        d["error"] = "\(error)"
                    }
                    described.append(d)
                }
                let spotters = self.kwsVariants.map { $0.1 }
                self.mic.onSamples = { p, n, rate in for k in spotters { k.feed(p, count: n, rate: rate) } }
                var lastLevel = 0.0
                self.mic.onLevel = { db in
                    let now = CACurrentMediaTime()
                    if now - lastLevel > 0.1 { lastLevel = now; self.js("onMicLevel(\(db))") }
                }
                do {
                    var info = try self.mic.start()
                    info["event"] = "kws_start"
                    info["variants"] = described
                    Log.write(info)
                    self.jsCall("onKwsStatus", info)
                } catch {
                    Log.write(["event": "kws_error", "error": "\(error)"])
                    self.jsCall("onKwsStatus", ["error": "\(error)"])
                    return
                }
                _ = self.cpu.sample()
                self.kwsTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in
                    let cpuPct = (self.cpu.sample() * 10).rounded() / 10
                    for (name, k) in self.kwsVariants {
                        k.takeStats { s in
                            var st = s
                            st["event"] = "kws_stats"
                            st["variant"] = name
                            st["appCpuPct"] = cpuPct
                            st["thermal"] = ProcessInfo.processInfo.thermalState.rawValue
                            st["battery"] = UIDevice.current.batteryLevel
                            Log.write(st)
                            self.jsCall("onKwsStats", st)
                        }
                    }
                }
            }
        }
    }

    private func runMic(seconds: Double) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else {
                    Log.write(["event": "mic", "error": "permission denied"])
                    self.js("onMicStatus({error:'麦克风权限被拒绝'})")
                    return
                }
                do {
                    let info = try self.mic.start()
                    Log.write(["event": "mic_start"].merging(info) { a, _ in a })
                    if let d = try? JSONSerialization.data(withJSONObject: info), let s = String(data: d, encoding: .utf8) {
                        self.js("onMicStatus(\(s))")
                    }
                    var lastPush = 0.0
                    self.mic.onLevel = { db in
                        let now = CACurrentMediaTime()
                        if now - lastPush > 0.1 { lastPush = now; self.js("onMicLevel(\(db))") }
                    }
                    _ = self.cpu.sample()
                    var cpuSamples: [Double] = []
                    let timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in
                        cpuSamples.append(self.cpu.sample())
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
                        timer.invalidate()
                        cpuSamples.append(self.cpu.sample())
                        var result = self.mic.stop()
                        result["event"] = "mic_done"
                        result["appCpuPct"] = cpuSamples.map { ($0 * 10).rounded() / 10 }
                        result["thermal"] = ProcessInfo.processInfo.thermalState.rawValue
                        Log.write(result)
                        if let d = try? JSONSerialization.data(withJSONObject: result), let s = String(data: d, encoding: .utf8) {
                            self.js("onMicStatus(\(s))")
                        }
                    }
                } catch {
                    Log.write(["event": "mic", "error": error.localizedDescription])
                    self.js("onMicStatus({error:\"\(error.localizedDescription)\"})")
                }
            }
        }
    }
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ app: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        app.isIdleTimerDisabled = true
        UIDevice.current.isBatteryMonitoringEnabled = true
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = ViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }
}

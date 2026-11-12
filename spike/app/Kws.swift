// Wake-word spotting with sherpa-onnx (zipformer transducer, zh-en 3M, int8).
// Audio arrives on the audio thread; decoding runs on its own serial queue so
// the tap never blocks.
import Foundation
import QuartzCore

final class Kws {
    private let spotter: OpaquePointer
    private let stream: OpaquePointer
    private let queue = DispatchQueue(label: "kws", qos: .userInitiated)
    private var lastHit = 0.0

    /// Keyword label, e.g. "HOMEVIEW". Called on the main queue.
    var onKeyword: ((String) -> Void)?

    // Counters for the stats line (touched only on `queue`).
    private(set) var audioSeconds = 0.0
    private(set) var decodeSeconds = 0.0
    private(set) var hits = 0
    private var dropped = 0          // guarded by `lock`
    private var queued = 0           // guarded by `lock`
    private let lock = NSLock()

    struct Failure: Error, CustomStringConvertible { let description: String }

    init(modelDir: URL, keywords: String, threshold: Float, score: Float, threads: Int32 = 1) throws {
        var owned: [UnsafeMutablePointer<CChar>] = []
        defer { owned.forEach { free($0) } }
        func cs(_ s: String) -> UnsafePointer<CChar> {
            let p = strdup(s)!
            owned.append(p)
            return UnsafePointer(p)
        }
        func file(_ name: String) throws -> UnsafePointer<CChar> {
            let url = modelDir.appendingPathComponent(name)
            guard FileManager.default.fileExists(atPath: url.path) else { throw Failure(description: "missing \(name)") }
            return cs(url.path)
        }
        var c = SherpaOnnxKeywordSpotterConfig()
        c.feat_config.sample_rate = 16_000
        c.feat_config.feature_dim = 80
        c.model_config.transducer.encoder = try file("encoder.int8.onnx")
        c.model_config.transducer.decoder = try file("decoder.onnx")
        c.model_config.transducer.joiner = try file("joiner.int8.onnx")
        c.model_config.tokens = try file("tokens.txt")
        c.model_config.num_threads = threads
        c.model_config.provider = cs("cpu")
        c.model_config.debug = 0
        c.max_active_paths = 4
        c.num_trailing_blanks = 1
        c.keywords_score = score
        c.keywords_threshold = threshold
        c.keywords_buf = cs(keywords)
        c.keywords_buf_size = Int32(keywords.utf8.count)
        guard let s = SherpaOnnxCreateKeywordSpotter(&c) else { throw Failure(description: "create spotter failed (bad keywords?)") }
        guard let st = SherpaOnnxCreateKeywordStream(s) else {
            SherpaOnnxDestroyKeywordSpotter(s)
            throw Failure(description: "create stream failed")
        }
        spotter = s
        stream = st
    }

    deinit {
        SherpaOnnxDestroyOnlineStream(stream)
        SherpaOnnxDestroyKeywordSpotter(spotter)
    }

    /// Copies the buffer and decodes it off the audio thread.
    func feed(_ samples: UnsafePointer<Float>, count: Int, rate: Int) {
        // If decoding falls ~2 s behind (20 buffers of 100 ms), drop audio instead of piling up.
        lock.lock()
        if queued > 20 { dropped += 1; lock.unlock(); return }
        queued += 1
        lock.unlock()
        let copy = Array(UnsafeBufferPointer(start: samples, count: count))
        queue.async { [self] in
            defer { lock.lock(); queued -= 1; lock.unlock() }
            let t0 = CACurrentMediaTime()
            copy.withUnsafeBufferPointer {
                SherpaOnnxOnlineStreamAcceptWaveform(stream, Int32(rate), $0.baseAddress, Int32(count))
            }
            var hit: String?
            while SherpaOnnxIsKeywordStreamReady(spotter, stream) != 0 {
                SherpaOnnxDecodeKeywordStream(spotter, stream)
                if let r = SherpaOnnxGetKeywordResult(spotter, stream) {
                    if let k = r.pointee.keyword, k.pointee != 0 {
                        hit = String(cString: k)
                        SherpaOnnxResetKeywordStream(spotter, stream)
                    }
                    SherpaOnnxDestroyKeywordResult(r)
                }
            }
            decodeSeconds += CACurrentMediaTime() - t0
            audioSeconds += Double(count) / Double(rate)
            if let hit {
                let now = CACurrentMediaTime()
                // one utterance can match two pronunciations back to back
                guard now - lastHit > 1.5 else { return }
                lastHit = now
                hits += 1
                DispatchQueue.main.async { self.onKeyword?(hit) }
            }
        }
    }

    /// Real-time factor and counters since the last call (decode time / audio time).
    func takeStats(_ done: @escaping ([String: Any]) -> Void) {
        queue.async { [self] in
            lock.lock()
            let d = dropped
            lock.unlock()
            let s: [String: Any] = [
                "audioSec": (audioSeconds * 10).rounded() / 10,
                "rtf": audioSeconds > 0 ? ((decodeSeconds / audioSeconds) * 1000).rounded() / 1000 : 0,
                "hits": hits, "dropped": d,
            ]
            audioSeconds = 0
            decodeSeconds = 0
            DispatchQueue.main.async { done(s) }
        }
    }
}

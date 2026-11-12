// Draws the app icon (a warm glass tile with a house) into the given folder:
// AppIcon76x76@2x.png (152) and AppIcon83.5x83.5@2x.png (167).
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."

func draw(_ size: CGFloat) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let rect = NSRect(x: 0, y: 0, width: size, height: size)
    NSGradient(colors: [NSColor(calibratedRed: 0.86, green: 0.78, blue: 0.66, alpha: 1),
                        NSColor(calibratedRed: 0.52, green: 0.45, blue: 0.38, alpha: 1)])!.draw(in: rect, angle: -60)
    // soft discs, like the bubbles wallpaper
    for (x, y, r, a) in [(0.25, 0.75, 0.38, 0.35), (0.8, 0.3, 0.42, 0.28), (0.7, 0.85, 0.25, 0.2)] as [(CGFloat, CGFloat, CGFloat, CGFloat)] {
        NSColor(white: 1, alpha: a).setFill()
        NSBezierPath(ovalIn: NSRect(x: (x - r) * size, y: (y - r) * size, width: 2 * r * size, height: 2 * r * size)).fill()
    }
    // glass tile
    let tile = NSRect(x: size * 0.17, y: size * 0.17, width: size * 0.66, height: size * 0.66)
    let path = NSBezierPath(roundedRect: tile, xRadius: size * 0.15, yRadius: size * 0.15)
    NSColor(white: 1, alpha: 0.28).setFill(); path.fill()
    NSColor(white: 1, alpha: 0.85).setStroke(); path.lineWidth = size * 0.012; path.stroke()
    // house
    let s = size, house = NSBezierPath()
    house.move(to: NSPoint(x: s * 0.33, y: s * 0.32)); house.line(to: NSPoint(x: s * 0.33, y: s * 0.52))
    house.line(to: NSPoint(x: s * 0.5, y: s * 0.66)); house.line(to: NSPoint(x: s * 0.67, y: s * 0.52))
    house.line(to: NSPoint(x: s * 0.67, y: s * 0.32)); house.close()
    NSColor.white.setFill(); house.fill()
    NSColor(calibratedRed: 1, green: 0.72, blue: 0.25, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: s * 0.46, y: s * 0.32, width: s * 0.08, height: s * 0.13), xRadius: s * 0.015, yRadius: s * 0.015).fill()
    NSGraphicsContext.restoreGraphicsState()
    return rep
}

for (name, px) in [("AppIcon76x76@2x.png", 152.0), ("AppIcon83.5x83.5@2x.png", 167.0)] {
    let data = draw(CGFloat(px)).representation(using: .png, properties: [:])!
    try! data.write(to: URL(fileURLWithPath: out).appendingPathComponent(name))
}

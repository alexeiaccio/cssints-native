// The text oracle: the same strings, sizes and places as the desktop's text, drawn by CoreText (the platform's own
// rasteriser) into a PNG of the page's size. `solid/text-oracle.ts` runs it over the sheet page and stores the result, and
// `solid/text.test.ts` compares the ThorVG frame of the sheet with that store: the ink weight per line (how much of the
// line is covered, against what CoreText covers) and the structural similarity of the two (the shapes, not the coverage),
// each aligned by the line's own ink so a hinting drift of a pixel is reported, not punished.
//
// Font smoothing is off: it is a gamma and subpixel trick of the display, not a property of the glyph, and ThorVG has no
// counterpart. Antialiasing and subpixel positioning stay on.
//
//   swiftc -O text-oracle.swift -o $TMPDIR/text-oracle && $TMPDIR/text-oracle spec.json
//
// spec.json: { "width", "height", "bg": [r, g, b], "fg": [r, g, b], "font": "<path to a .ttf>", "out": "<png>",
//              "rows": [{ "text", "size", "x", "y" }] } — x, y is the line's top-left, as Clay gives the text command.
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Row: Decodable {
    let text: String
    let size: Double
    let x: Double
    let y: Double
}

struct Spec: Decodable {
    /// The layout's size in Clay units.
    let width: Int
    let height: Int
    /// Device pixels per Clay unit: the window's pixel density (2 on a Retina screen), 1 for the stored frames.
    let scale: Double?
    let bg: [Double]
    let fg: [Double]
    let font: String
    let out: String
    let rows: [Row]
}

func die(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

guard CommandLine.arguments.count > 1 else { die("usage: text-oracle spec.json") }
let path = CommandLine.arguments[1]
let spec = try! JSONDecoder().decode(Spec.self, from: Data(contentsOf: URL(fileURLWithPath: path)))

let url = URL(fileURLWithPath: spec.font) as CFURL
var error: Unmanaged<CFError>?
if !CTFontManagerRegisterFontsForURL(url, .process, &error) {
    // already registered is not a failure: the descriptors below are what we want either way
    _ = error
}
guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url) as? [CTFontDescriptor], let face = descriptors.first
else { die("cannot read a font face from \(spec.font)") }

let scale = spec.scale ?? 1
let width = Int((Double(spec.width) * scale).rounded()), height = Int((Double(spec.height) * scale).rounded())
guard let ctx = CGContext(
    data: nil,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: width * 4,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
) else { die("cannot make a \(width)x\(height) bitmap") }

// the spec's colours are 0..255 bytes, as the frame's are
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
func color(_ c: [Double]) -> CGColor {
    CGColor(colorSpace: srgb, components: [c[0] / 255, c[1] / 255, c[2] / 255, 1])!
}
let bg = color(spec.bg), fg = color(spec.fg)
ctx.setFillColor(bg)
ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
ctx.setAllowsAntialiasing(true)
ctx.setShouldAntialias(true)
ctx.setAllowsFontSmoothing(false)
ctx.setShouldSmoothFonts(false)
ctx.setAllowsFontSubpixelPositioning(true)
ctx.setShouldSubpixelPositionFonts(true)
ctx.setAllowsFontSubpixelQuantization(false)
ctx.setShouldSubpixelQuantizeFonts(false)
ctx.setFillColor(fg)

for row in spec.rows {
    let font = CTFontCreateWithFontDescriptor(face, CGFloat(row.size * scale), nil)
    let attributed = NSAttributedString(
        string: row.text,
        attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): fg,
        ]
    )
    let line = CTLineCreateWithAttributedString(attributed)
    // Clay's y is the top of the line; CoreGraphics' origin is the bottom-left of the bitmap
    let baseline = Double(height) - (row.y * scale + Double(CTFontGetAscent(font)))
    ctx.textPosition = CGPoint(x: row.x * scale, y: baseline)
    CTLineDraw(line, ctx)
}

guard let image = ctx.makeImage() else { die("cannot make the image") }
let out = URL(fileURLWithPath: spec.out) as CFURL
guard let dest = CGImageDestinationCreateWithURL(out, UTType.png.identifier as CFString, 1, nil) else {
    die("cannot write \(spec.out)")
}
CGImageDestinationAddImage(dest, image, nil)
guard CGImageDestinationFinalize(dest) else { die("cannot finish \(spec.out)") }
print("text-oracle: \(spec.rows.count) lines into \(spec.out)")

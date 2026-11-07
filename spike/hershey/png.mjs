// A PNG decoder for the spike: 8-bit, non-interlaced, RGB or RGBA — what CoreText's ImageIO and SDL_image write. The
// metric needs one; the tree has none in node (solid reads pngs through libui.dylib's ThorVG) and a decoder is smaller
// than a renderer's worth of FFI.
import { inflateSync } from "node:zlib";

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function readPng(file) {
  const bytes = new Uint8Array(file);
  if (bytes[0] !== 0x89 || String.fromCharCode(...bytes.slice(1, 4)) !== "PNG") throw new Error("not a PNG");
  let at = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (at < bytes.length) {
    const length = (bytes[at] << 24 | bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3]) >>> 0;
    const kind = String.fromCharCode(...bytes.slice(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (kind === "IHDR") {
      width = (data[0] << 24 | data[1] << 16 | data[2] << 8 | data[3]) >>> 0;
      height = (data[4] << 24 | data[5] << 16 | data[6] << 8 | data[7]) >>> 0;
      depth = data[8], type = data[9], interlace = data[12];
    } else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    at += 12 + length;
  }
  if (depth !== 8 || interlace) throw new Error(`a ${depth}-bit, interlaced ${interlace} PNG is not read here`);
  const channels = CHANNELS[type];
  if (!channels) throw new Error(`colour type ${type} is not read here`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, i = x * channels;
      out[o] = row[i];
      out[o + 1] = channels < 3 ? row[i] : row[i + 1];
      out[o + 2] = channels < 3 ? row[i] : row[i + 2];
      out[o + 3] = channels === 4 ? row[i + 3] : 255;
    }
    prev.set(row);
  }
  return { width, height, pixels: out };
}

/**
 * Generates the PWA PNG icons (no image library needed): a teal rounded tile with a white
 * "page" and a darker margin rule — the Margin mark. Run: npx tsx scripts/make-icons.ts
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const TEAL = [31, 111, 107];
const PAGE = [247, 245, 240];
const RULE = [191, 90, 60];

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function render(size: number, maskable: boolean): Buffer {
  const px = Buffer.alloc(size * size * 4);
  const r = maskable ? 0 : size * 0.22; // corner radius
  const inset = maskable ? size * 0.2 : size * 0.14;
  const pageL = inset + size * 0.08, pageR = size - inset - size * 0.08;
  const pageT = inset, pageB = size - inset;
  const ruleX = pageL + (pageR - pageL) * 0.24;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded-rect mask
      const cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r);
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      if (!inside) continue;
      let col = TEAL;
      if (x >= pageL && x <= pageR && y >= pageT && y <= pageB) {
        col = PAGE;
        if (Math.abs(x - ruleX) < size * 0.018) col = RULE;
        // text lines
        const lineH = (pageB - pageT) / 9;
        const row = Math.floor((y - pageT) / lineH);
        const inLine = (y - pageT) % lineH > lineH * 0.42 && (y - pageT) % lineH < lineH * 0.58;
        if (row >= 2 && row <= 7 && inLine && x > ruleX + size * 0.05 && x < pageR - size * (row % 3 === 0 ? 0.16 : 0.06)) col = [150, 160, 165];
      }
      px[i] = col[0];
      px[i + 1] = col[1];
      px[i + 2] = col[2];
      px[i + 3] = 255;
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = path.resolve("web/public/icons");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "icon-192.png"), render(192, false));
fs.writeFileSync(path.join(out, "icon-512.png"), render(512, false));
fs.writeFileSync(path.join(out, "icon-maskable-512.png"), render(512, true));
fs.writeFileSync(path.join(out, "apple-touch-icon.png"), render(180, true));
console.log("Icons written to", out);

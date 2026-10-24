// WOFF2 directory reader/writer and cmap rebuilder.
//
// Scope is deliberately narrow: the font keeps every glyph and hmtx entry it
// had; only the cmap format 4 table is rewritten to map the requested codepoints.
// That avoids reconstructing glyf/loca (where the size is) but still turns a
// large font's cmap into a small one and, more importantly, gives us a single
// place to change if we later strip glyphs.

const TAG = (s) =>
  ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;

export const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep',
  'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE',
  'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt',
  'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar',
  'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill', 'DSIG', 'MVAR',
  'HVAR', 'VVAR', 'STAT', 'meta',
];

export const tagToName = (tag) =>
  String.fromCharCode((tag >>> 24) & 0xff, (tag >>> 16) & 0xff, (tag >>> 8) & 0xff, tag & 0xff);

export function readBase128(buf, pos) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[pos++];
    if (i === 0 && byte === 0x80) throw new Error('UIntBase128 leading 0x80');
    if (value & 0xfe000000) throw new Error('UIntBase128 overflow');
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return [value, pos];
  }
  throw new Error('UIntBase128 too long');
}

export function writeBase128(value) {
  const out = [value & 0x7f];
  let v = Math.floor(value / 128);
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  return out;
}

/**
 * @param {Uint8Array} bytes
 */
export function parseWoff2(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x774f4632) throw new Error('not a woff2 file');
  const flavor = view.getUint32(4);
  const numTables = view.getUint16(12);
  const totalCompressedSize = view.getUint32(20);

  let pos = 48;
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = bytes[pos++];
    const tagIndex = flags & 0x3f;
    let tag;
    if (tagIndex === 0x3f) {
      tag = view.getUint32(pos);
      pos += 4;
    } else {
      const name = KNOWN_TAGS[tagIndex];
      if (!name) throw new Error(`unknown known-table index ${tagIndex}`);
      tag = TAG(name);
    }

    const version = (flags >> 6) & 0x03;
    const isGlyfLoca = tag === TAG('glyf') || tag === TAG('loca');
    const transformed = isGlyfLoca ? version === 0 : version !== 0;
    const [origLength, p1] = readBase128(bytes, pos);
    pos = p1;
    let storedLength = origLength;
    if (transformed) {
      const [t, p2] = readBase128(bytes, pos);
      pos = p2;
      storedLength = t;
    }
    tables.push({ tag, version, transformed, origLength, storedLength });
  }

  const totalSfntSize = view.getUint32(16);
  const compressed = bytes.subarray(pos, pos + totalCompressedSize);
  return { flavor, tables, compressed, totalSfntSize };
}

/**
 * @param {{flavor: number, tables: Array, compressed: Uint8Array, totalSfntSize: number}} dir
 */
export async function decompressTables(dir) {
  const stream = new Blob([dir.compressed]).stream().pipeThrough(new DecompressionStream('brotli'));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  let offset = 0;
  const tables = dir.tables.map((t) => {
    const data = raw.subarray(offset, offset + t.storedLength);
    offset += t.storedLength;
    if (!t.transformed && data.length !== t.origLength) {
      throw new Error(`table ${tagToName(t.tag)} length mismatch`);
    }
    return { ...t, data };
  });
  return { ...dir, tables, raw };
}

/**
 * @param {{flavor: number, tables: Array, totalSfntSize: number}} dir tables[].data is the stored payload
 */
export async function writeWoff2(dir) {
  const entries = [];
  const payloads = [];
  for (const t of dir.tables) {
    const idx = KNOWN_TAGS.indexOf(tagToName(t.tag));
    const flags = (idx >= 0 ? idx : 0x3f) | ((t.version & 0x03) << 6);
    entries.push(flags);
    if (idx < 0) {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setUint32(0, t.tag);
      entries.push(...b);
    }
    entries.push(...writeBase128(t.origLength));
    if (t.transformed) entries.push(...writeBase128(t.data.length));
    payloads.push(t.data);
  }

  const raw = concat(payloads);
  const compressed = new Uint8Array(
    await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('brotli'))).arrayBuffer(),
  );

  const dirBytes = Uint8Array.from(entries);
  const total = 48 + dirBytes.length + compressed.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4632);
  view.setUint32(4, dir.flavor);
  view.setUint32(8, total);
  view.setUint16(12, dir.tables.length);
  view.setUint16(14, 0);
  view.setUint32(16, dir.totalSfntSize);
  view.setUint32(20, compressed.length);
  view.setUint16(24, 1);
  view.setUint16(26, 0);
  out.set(dirBytes, 48);
  out.set(compressed, 48 + dirBytes.length);
  return out;
}

function concat(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// --- cmap ---

/**
 * Read a cmap table (format 4 and format 12 subtables).
 * @param {Uint8Array} table
 * @returns {Map<number, number>} codepoint -> glyph id
 */
export function readCmap(table) {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const numTables = view.getUint16(2);
  const map = new Map();
  let fmt4 = -1;
  let fmt12 = -1;

  for (let i = 0; i < numTables; i++) {
    const platform = view.getUint16(4 + i * 8);
    const encoding = view.getUint16(6 + i * 8);
    const offset = view.getUint32(8 + i * 8);
    const format = view.getUint16(offset);
    if (format === 12 && (platform === 3 && encoding === 10)) fmt12 = offset;
    if (format === 4 && platform === 3 && encoding === 1) fmt4 = offset;
  }

  if (fmt12 >= 0) {
    const groups = view.getUint32(fmt12 + 12);
    for (let g = 0; g < groups; g++) {
      const base = fmt12 + 16 + g * 12;
      const start = view.getUint32(base);
      const end = view.getUint32(base + 4);
      const glyph = view.getUint32(base + 8);
      for (let cp = start; cp <= end; cp++) map.set(cp, glyph + (cp - start));
    }
    return map;
  }

  if (fmt4 >= 0) {
    const segX2 = view.getUint16(fmt4 + 6);
    const seg = segX2 / 2;
    const endBase = fmt4 + 14;
    const startBase = endBase + segX2 + 2;
    const deltaBase = startBase + segX2;
    const rangeBase = deltaBase + segX2;
    for (let i = 0; i < seg; i++) {
      const end = view.getUint16(endBase + i * 2);
      const start = view.getUint16(startBase + i * 2);
      const delta = view.getInt16(deltaBase + i * 2);
      const rangeOffset = view.getUint16(rangeBase + i * 2);
      if (start > end || start === 0xffff) continue;
      for (let cp = start; cp <= end; cp++) {
        let glyph;
        if (rangeOffset === 0) {
          glyph = (cp + delta) & 0xffff;
        } else {
          const addr = rangeBase + i * 2 + rangeOffset + (cp - start) * 2;
          glyph = view.getUint16(addr);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) map.set(cp, glyph);
      }
    }
    return map;
  }

  throw new Error('cmap has neither a format 12 nor a format 4 subtable');
}

/**
 * Build a cmap subtable with format 4 only, mapping the given codepoints.
 * @param {Map<number, number>} full codepoint -> glyph id from the source font
 * @param {string} text characters to keep
 */
export function buildCmap4(full, text) {
  const cps = [...new Set([...text].map((ch) => ch.codePointAt(0)).filter((cp) => cp <= 0xffff))].sort(
    (a, b) => a - b,
  );
  const mapped = [];
  for (const cp of cps) {
    const glyph = full.get(cp);
    if (glyph) mapped.push([cp, glyph]);
  }

  // Segments: consecutive codepoints sharing a constant glyph-id delta.
  const segs = [];
  for (const [cp, glyph] of mapped) {
    const delta = (glyph - cp) & 0xffff;
    const last = segs[segs.length - 1];
    if (last && cp === last.end + 1 && last.delta === delta) last.end = cp;
    else segs.push({ start: cp, end: cp, delta });
  }
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });

  const segX2 = segs.length * 2;
  const length = 16 + segX2 * 4;
  const buf = new Uint8Array(length);
  const view = new DataView(buf.buffer);
  let maxPower = 0;
  while (2 ** (maxPower + 1) <= segs.length) maxPower++;
  const searchRange = 2 * 2 ** maxPower;
  const entrySelector = maxPower;
  const rangeShift = segX2 - searchRange;

  view.setUint16(0, 4);
  view.setUint16(2, length);
  view.setUint16(4, 0);
  view.setUint16(6, segX2);
  view.setUint16(8, searchRange);
  view.setUint16(10, entrySelector);
  view.setUint16(12, rangeShift);

  const endBase = 14;
  const startBase = endBase + segX2 + 2;
  const deltaBase = startBase + segX2;
  const rangeBase = deltaBase + segX2;
  segs.forEach((s, i) => {
    view.setUint16(endBase + i * 2, s.end);
    view.setUint16(startBase + i * 2, s.start);
    view.setInt16(deltaBase + i * 2, s.delta);
    view.setUint16(rangeBase + i * 2, 0);
  });

  return buf;
}

/**
 * Wrap cmap subtables into a cmap table with the given encoding records.
 * @param {Array<{platform: number, encoding: number, data: Uint8Array}>} subtables
 */
export function buildCmap(subtables) {
  const header = 4 + subtables.length * 8;
  const offsets = [];
  let cursor = header;
  for (const s of subtables) {
    offsets.push(cursor);
    cursor += s.data.length;
  }
  const out = new Uint8Array(cursor);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0);
  view.setUint16(2, subtables.length);
  subtables.forEach((s, i) => {
    view.setUint16(4 + i * 8, s.platform);
    view.setUint16(6 + i * 8, s.encoding);
    view.setUint32(8 + i * 8, offsets[i]);
    out.set(s.data, offsets[i]);
  });
  return out;
}

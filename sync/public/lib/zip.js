// Minimal streaming ZIP writer (store method, data descriptors; no ZIP64, so each file must be < 4 GiB).
const T = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export const crc32 = (buf, crc = 0xffffffff) => { for (let i = 0; i < buf.length; i++) crc = T[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8); return crc >>> 0; };
const LIMIT = 0xffffffff;

export class ZipWriter {
  /** `sink(chunk: Uint8Array)` receives the archive bytes in order. */
  constructor(sink) { this.sink = sink; this.offset = 0; this.entries = []; }
  async #emit(b) { this.offset += b.length; await this.sink(b); }

  /** `chunks` is an async iterable of Uint8Array. */
  async addFile(path, chunks, date = new Date()) {
    if (this.entries.length >= 65534) throw new Error('Too many files for a ZIP; use "Export to folder"');
    const name = new TextEncoder().encode(path);
    const dt = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) |
      ((((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) << 16);
    const start = this.offset;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0808, true);
    h.setUint32(10, dt >>> 0, true); h.setUint16(26, name.length, true);
    await this.#emit(new Uint8Array(h.buffer)); await this.#emit(name);
    let crc = 0xffffffff, size = 0;
    for await (const c of chunks) {
      crc = crc32(c, crc); size += c.length;
      if (size > LIMIT) throw new Error(`${path} exceeds the 4 GiB ZIP limit; use "Export to folder"`);
      await this.#emit(c);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const d = new DataView(new ArrayBuffer(16));
    d.setUint32(0, 0x08074b50, true); d.setUint32(4, crc, true); d.setUint32(8, size, true); d.setUint32(12, size, true);
    await this.#emit(new Uint8Array(d.buffer));
    this.entries.push({ name, crc, size, start, dt: dt >>> 0 });
  }

  async close() {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const v = new DataView(new ArrayBuffer(46));
      v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0808, true);
      v.setUint32(12, e.dt, true); v.setUint32(16, e.crc, true); v.setUint32(20, e.size, true); v.setUint32(24, e.size, true);
      v.setUint16(28, e.name.length, true); v.setUint32(42, e.start, true);
      await this.#emit(new Uint8Array(v.buffer)); await this.#emit(e.name);
    }
    const size = this.offset - cdStart;
    const v = new DataView(new ArrayBuffer(22));
    v.setUint32(0, 0x06054b50, true); v.setUint16(8, this.entries.length, true); v.setUint16(10, this.entries.length, true);
    v.setUint32(12, size, true); v.setUint32(16, cdStart, true);
    await this.#emit(new Uint8Array(v.buffer));
  }
}

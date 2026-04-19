export class EndOfBufferError extends Error {
  constructor(
    readonly offset: number,
    readonly need: number,
    readonly have: number,
  ) {
    super(`EOF at 0x${offset.toString(16)}: need ${need}, have ${have}`);
    this.name = 'EndOfBufferError';
  }
}

export class BinaryReader {
  private view: DataView;
  private _offset: number;

  constructor(
    readonly buffer: Uint8Array,
    start = 0,
    readonly end = buffer.byteLength,
  ) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this._offset = start;
  }

  get offset(): number {
    return this._offset;
  }
  get remaining(): number {
    return this.end - this._offset;
  }
  get eof(): boolean {
    return this._offset >= this.end;
  }

  seek(absolute: number): void {
    this._offset = absolute;
  }
  skip(n: number): void {
    this.ensure(n);
    this._offset += n;
  }

  peekBytes(n: number): Uint8Array {
    this.ensure(n);
    return this.buffer.subarray(this._offset, this._offset + n);
  }

  readU8(): number {
    this.ensure(1);
    return this.view.getUint8(this._offset++);
  }

  readU16LE(): number {
    this.ensure(2);
    const v = this.view.getUint16(this._offset, true);
    this._offset += 2;
    return v;
  }

  readU16BE(): number {
    this.ensure(2);
    const v = this.view.getUint16(this._offset, false);
    this._offset += 2;
    return v;
  }

  readU32LE(): number {
    this.ensure(4);
    const v = this.view.getUint32(this._offset, true);
    this._offset += 4;
    return v;
  }

  readU32BE(): number {
    this.ensure(4);
    const v = this.view.getUint32(this._offset, false);
    this._offset += 4;
    return v;
  }

  readI64LE(): bigint {
    this.ensure(8);
    const v = this.view.getBigInt64(this._offset, true);
    this._offset += 8;
    return v;
  }

  readI64BE(): bigint {
    this.ensure(8);
    const v = this.view.getBigInt64(this._offset, false);
    this._offset += 8;
    return v;
  }

  readBytes(n: number): Uint8Array {
    this.ensure(n);
    const out = this.buffer.subarray(this._offset, this._offset + n);
    this._offset += n;
    return out;
  }

  sliceReader(length: number): BinaryReader {
    this.ensure(length);
    const r = new BinaryReader(this.buffer, this._offset, this._offset + length);
    this._offset += length;
    return r;
  }

  readUtf8(n: number): string {
    return new TextDecoder('utf-8', { fatal: false }).decode(this.readBytes(n));
  }

  readAscii(n: number): string {
    const bytes = this.readBytes(n);
    let s = '';
    for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]!);
    return s;
  }

  private ensure(n: number): void {
    if (this._offset + n > this.end) {
      throw new EndOfBufferError(this._offset, n, this.end - this._offset);
    }
  }
}

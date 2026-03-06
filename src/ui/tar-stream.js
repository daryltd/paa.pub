/**
 * Streaming POSIX ustar tar writer.
 *
 * Writes tar entries (512-byte headers + file data + padding) to a
 * WritableStreamDefaultWriter. Designed for use with CompressionStream('gzip')
 * to produce .tar.gz archives without buffering the entire archive in memory.
 */

const BLOCK = 512;
const encoder = new TextEncoder();

/**
 * Streaming tar archive writer.
 */
export class TarWriter {
  /**
   * @param {WritableStreamDefaultWriter} writer
   */
  constructor(writer) {
    this.writer = writer;
  }

  /**
   * Add a file from a string or ArrayBuffer.
   * @param {string} path - file path within the archive
   * @param {string|ArrayBuffer|Uint8Array} content
   */
  async addFile(path, content) {
    const data = typeof content === 'string'
      ? encoder.encode(content)
      : content instanceof Uint8Array ? content : new Uint8Array(content);

    const header = createTarHeader(path, data.byteLength);
    await this.writer.write(header);
    await this.writer.write(data);

    const remainder = data.byteLength % BLOCK;
    if (remainder > 0) {
      await this.writer.write(new Uint8Array(BLOCK - remainder));
    }
  }

  /**
   * Add a file by streaming from a ReadableStream (e.g., R2 blob body).
   * The size must be known in advance (from R2 list metadata).
   * @param {string} path - file path within the archive
   * @param {number} size - exact byte size of the stream content
   * @param {ReadableStream} readableStream
   */
  async addFileFromStream(path, size, readableStream) {
    const header = createTarHeader(path, size);
    await this.writer.write(header);

    const reader = readableStream.getReader();
    let bytesWritten = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await this.writer.write(value);
        bytesWritten += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }

    const remainder = bytesWritten % BLOCK;
    if (remainder > 0) {
      await this.writer.write(new Uint8Array(BLOCK - remainder));
    }
  }

  /**
   * Write the end-of-archive marker (two 512-byte zero blocks) and close.
   */
  async finalize() {
    await this.writer.write(new Uint8Array(BLOCK * 2));
  }
}

/**
 * Build a 512-byte POSIX ustar tar header.
 * @param {string} path - file path (max 255 chars via prefix + name split)
 * @param {number} size - file size in bytes
 * @returns {Uint8Array}
 */
function createTarHeader(path, size) {
  const header = new Uint8Array(BLOCK);

  // Split long paths into prefix (155) + name (100)
  let name = path;
  let prefix = '';
  if (path.length > 100) {
    const splitIdx = path.lastIndexOf('/', 155);
    if (splitIdx > 0) {
      prefix = path.slice(0, splitIdx);
      name = path.slice(splitIdx + 1);
    }
  }

  writeStr(header, 0, name, 100);                                     // name
  writeStr(header, 100, '0000644\0', 8);                               // mode
  writeStr(header, 108, '0000000\0', 8);                               // uid
  writeStr(header, 116, '0000000\0', 8);                               // gid
  writeStr(header, 124, size.toString(8).padStart(11, '0') + ' ', 12); // size (octal)
  const mtime = Math.floor(Date.now() / 1000);
  writeStr(header, 136, mtime.toString(8).padStart(11, '0') + ' ', 12); // mtime
  // checksum placeholder — fill with spaces for calculation
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  header[156] = 0x30;                                                  // typeflag '0' (regular file)
  writeStr(header, 257, 'ustar\0', 6);                                // magic
  writeStr(header, 263, '00', 2);                                      // version
  if (prefix) writeStr(header, 345, prefix, 155);                      // prefix

  // Compute checksum: unsigned sum of all header bytes
  let checksum = 0;
  for (let i = 0; i < BLOCK; i++) checksum += header[i];
  writeStr(header, 148, checksum.toString(8).padStart(6, '0') + '\0 ', 8);

  return header;
}

/**
 * Write a string into a Uint8Array at offset, truncated to maxLen.
 */
function writeStr(buf, offset, str, maxLen) {
  const bytes = encoder.encode(str);
  const len = Math.min(bytes.length, maxLen);
  buf.set(bytes.subarray(0, len), offset);
}

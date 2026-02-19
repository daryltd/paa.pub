/**
 * Minimal CBOR decoder for WebAuthn attestation objects.
 *
 * Handles the subset of CBOR used by WebAuthn:
 * - Maps, arrays, byte strings, text strings, positive/negative integers, booleans, null
 */

/**
 * Decode a CBOR-encoded ArrayBuffer.
 * @param {ArrayBuffer} buffer
 * @returns {*} decoded value
 */
export function decodeCBOR(buffer) {
  const data = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
  let offset = 0;

  function readUint8() { return data.getUint8(offset++); }
  function readUint16() { const v = data.getUint16(offset); offset += 2; return v; }
  function readUint32() { const v = data.getUint32(offset); offset += 4; return v; }

  function readLength(additionalInfo) {
    if (additionalInfo < 24) return additionalInfo;
    if (additionalInfo === 24) return readUint8();
    if (additionalInfo === 25) return readUint16();
    if (additionalInfo === 26) return readUint32();
    throw new Error(`CBOR: unsupported length encoding ${additionalInfo}`);
  }

  function decode() {
    const initial = readUint8();
    const majorType = initial >> 5;
    const additionalInfo = initial & 0x1f;

    switch (majorType) {
      case 0: // Positive integer
        return readLength(additionalInfo);

      case 1: // Negative integer
        return -1 - readLength(additionalInfo);

      case 2: { // Byte string
        const len = readLength(additionalInfo);
        const bytes = new Uint8Array(data.buffer, offset, len);
        offset += len;
        return bytes.slice(); // Return a copy
      }

      case 3: { // Text string
        const len = readLength(additionalInfo);
        const bytes = new Uint8Array(data.buffer, offset, len);
        offset += len;
        return new TextDecoder().decode(bytes);
      }

      case 4: { // Array
        const len = readLength(additionalInfo);
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(decode());
        return arr;
      }

      case 5: { // Map
        const len = readLength(additionalInfo);
        const map = {};
        for (let i = 0; i < len; i++) {
          const key = decode();
          const value = decode();
          map[key] = value;
        }
        return map;
      }

      case 7: // Simple values and floats
        if (additionalInfo === 20) return false;
        if (additionalInfo === 21) return true;
        if (additionalInfo === 22) return null;
        if (additionalInfo === 23) return undefined;
        throw new Error(`CBOR: unsupported simple value ${additionalInfo}`);

      default:
        throw new Error(`CBOR: unsupported major type ${majorType}`);
    }
  }

  return decode();
}

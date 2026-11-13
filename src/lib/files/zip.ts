/**
 * Minimal, allocation-free ZIP central-directory reader used to inspect DOCX
 * files BEFORE handing them to a parser (zip-bomb / structure checks).
 */

export interface ZipEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

export class ZipFormatError extends Error {}

export function readZipEntries(buf: Uint8Array, maxEntries = 5000): ZipEntryInfo[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const len = buf.byteLength;
  if (len < 22) throw new ZipFormatError("File is too small to be a ZIP archive");

  // Locate End Of Central Directory record (may be followed by a comment ≤ 65535 bytes).
  let eocd = -1;
  const stop = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= stop; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError("ZIP end-of-central-directory record not found");

  const totalEntries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (totalEntries === 0xffff || cdOffset === 0xffffffff) {
    throw new ZipFormatError("ZIP64 archives are not supported");
  }
  if (totalEntries > maxEntries) throw new ZipFormatError("Archive contains too many entries");
  if (cdOffset + cdSize > len) throw new ZipFormatError("Corrupt ZIP central directory");

  const entries: ZipEntryInfo[] = [];
  let p = cdOffset;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let n = 0; n < totalEntries; n++) {
    if (p + 46 > len || view.getUint32(p, true) !== 0x02014b50) {
      throw new ZipFormatError("Corrupt ZIP central directory entry");
    }
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    if (p + 46 + nameLen > len) throw new ZipFormatError("Corrupt ZIP entry name");
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, compressedSize, uncompressedSize });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

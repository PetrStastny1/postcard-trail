export interface WebpDimensions {
  width: number
  height: number
}

/** A file that is not a WebP or whose header is cut off or damaged. The message says what was found. */
export class WebpHeaderError extends Error {}

// Bytes needed up to the end of the dimension fields, counted from the start of the file.
const headerLengths: Record<string, number> = { VP8X: 30, 'VP8 ': 30, VP8L: 25 }

/** Width and height from the VP8, VP8L or VP8X chunk that follows `RIFF....WEBP`. */
export function readWebpDimensions(file: Buffer): WebpDimensions {
  if (file.length < 16) throw new WebpHeaderError(`truncated header, the file has only ${file.length} bytes`)
  if (file.toString('latin1', 0, 4) !== 'RIFF' || file.toString('latin1', 8, 12) !== 'WEBP') {
    throw new WebpHeaderError(`no RIFF/WEBP signature, the file starts with ${file.toString('hex', 0, 12).replace(/(..)(?!$)/g, '$1 ')}`)
  }
  const declaredLength = file.readUInt32LE(4) + 8
  if (declaredLength !== file.length) {
    throw new WebpHeaderError(`the RIFF header declares ${declaredLength} bytes, the file has ${file.length}`)
  }
  const chunk = file.toString('latin1', 12, 16)
  const headerLength = headerLengths[chunk]
  if (headerLength === undefined) {
    throw new WebpHeaderError(`unknown first chunk ${JSON.stringify(chunk)}, expected VP8, VP8L or VP8X`)
  }
  if (file.length < headerLength) throw new WebpHeaderError(`truncated ${chunk.trim()} header`)
  if (chunk === 'VP8X') return { width: file.readUIntLE(24, 3) + 1, height: file.readUIntLE(27, 3) + 1 }
  if (chunk === 'VP8 ') {
    if (file[23] !== 0x9d || file[24] !== 0x01 || file[25] !== 0x2a) {
      throw new WebpHeaderError('damaged VP8 header, the frame start code is missing')
    }
    return { width: file.readUInt16LE(26) & 0x3fff, height: file.readUInt16LE(28) & 0x3fff }
  }
  if (file[20] !== 0x2f) throw new WebpHeaderError('damaged VP8L header, the signature byte is missing')
  const bits = file.readUInt32LE(21)
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
}

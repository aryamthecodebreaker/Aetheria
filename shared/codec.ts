import { CHUNK, HEIGHT } from './constants';

export function encodeRLE(data: Uint16Array): number[] {
  const out: number[] = [];
  for (let start = 0; start < data.length;) {
    const id = data[start];
    let end = start + 1;
    while (end < data.length && data[end] === id && end - start < 65535) end++;
    out.push(id, end - start);
    start = end;
  }
  return out;
}

export function decodeRLE(data: ArrayLike<number>, length = CHUNK * CHUNK * HEIGHT): Uint16Array {
  if (!Number.isSafeInteger(length) || length < 0 || length > CHUNK * CHUNK * HEIGHT) throw new RangeError('Invalid chunk length');
  if (!Number.isSafeInteger(data.length) || data.length < 0 || data.length % 2 !== 0 || data.length > length * 2) throw new RangeError('Invalid RLE pairs');
  let total = 0;
  for (let i = 0; i < data.length; i += 2) {
    const id = data[i], count = data[i + 1];
    if (!Number.isInteger(id) || id < 0 || id > 65535 || !Number.isInteger(count) || count <= 0 || count > 65535) throw new RangeError('Invalid RLE run');
    total += count;
    if (total > length) throw new RangeError('RLE exceeds chunk length');
  }
  if (total !== length) throw new RangeError('RLE does not fill chunk');
  const out = new Uint16Array(length);
  let offset = 0;
  for (let i = 0; i < data.length; i += 2) {
    out.fill(data[i], offset, offset + data[i + 1]);
    offset += data[i + 1];
  }
  return out;
}

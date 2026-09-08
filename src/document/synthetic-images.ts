type Pixel = readonly [red: number, green: number, blue: number];

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function uint32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ]);
}

function join(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;

  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }

  return ((b << 16) | a) >>> 0;
}

function zlibStore(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];

  for (let offset = 0; offset < bytes.length; offset += 65535) {
    const length = Math.min(65535, bytes.length - offset);
    const finalBlock = offset + length === bytes.length ? 1 : 0;
    const inverseLength = (~length) & 0xffff;
    parts.push(
      new Uint8Array([
        finalBlock,
        length & 255,
        (length >>> 8) & 255,
        inverseLength & 255,
        (inverseLength >>> 8) & 255,
      ]),
      new Uint8Array(bytes.slice(offset, offset + length)),
    );
  }

  parts.push(uint32(adler32(bytes)));
  return join(parts);
}

function chunk(name: string, data: Uint8Array): Uint8Array {
  const type = new TextEncoder().encode(name);
  const body = join([type, data]);
  return join([uint32(data.length), body, uint32(crc32(body))]);
}

function makePng(
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => Pixel,
): Uint8Array {
  const rows = new Uint8Array(height * (1 + width * 3));
  let offset = 0;

  for (let y = 0; y < height; y += 1) {
    rows[offset++] = 0;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixelAt(x, y);
      rows.set([red, green, blue], offset);
      offset += 3;
    }
  }

  const header = join([
    uint32(width),
    uint32(height),
    new Uint8Array([8, 2, 0, 0, 0]),
  ]);

  return join([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", zlibStore(rows)),
    chunk("IEND", new Uint8Array()),
  ]);
}

export function makeSyntheticPhoto(): Uint8Array {
  return makePng(160, 120, (x, y) => {
    const face = (x - 80) ** 2 + (y - 48) ** 2 < 25 ** 2;
    const shoulders = y > 76 && Math.abs(x - 80) < 48 - (y - 76) / 2;
    if (face) return [224, 176, 132];
    if (shoulders) return [42, 74, 110];
    return [224 - Math.floor(y / 4), 234 - Math.floor(y / 5), 239];
  });
}

export function makeSyntheticSignature(): Uint8Array {
  return makePng(300, 80, (x, y) => {
    const strokeY = 42 + Math.round(15 * Math.sin(x / 23));
    const flourishY = 53 + Math.round(7 * Math.sin(x / 11));
    const ink = Math.abs(y - strokeY) <= 2 || (x > 80 && Math.abs(y - flourishY) <= 1);
    return ink ? [25, 34, 45] : [255, 255, 255];
  });
}

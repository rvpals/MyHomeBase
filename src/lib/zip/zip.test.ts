import { describe, expect, it } from "vitest";
import { buildZip, crc32 } from "./index";

const encoder = new TextEncoder();

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

/**
 * A deliberately independent reader, rather than asserting on byte offsets inline.
 *
 * The point of these tests is that a real extractor can open what `buildZip` writes,
 * and the only honest way to check that without shelling out to `unzip` is to parse the
 * archive back the way an extractor does: find the end-of-central-directory record,
 * walk the directory, follow each offset to the local header, and read the bytes there.
 * A test that only checked `archive[0] === 0x50` would pass on a file nothing can open.
 */
function readZip(archive: Uint8Array): { names: string[]; files: Map<string, string> } {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();

  // The EOCD is the last 22 bytes when there's no archive comment, which is the only
  // kind this writer produces.
  const eocd = archive.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);

  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);

  const names: string[] = [];
  const files = new Map<string, string>();

  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    const storedCrc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(archive.subarray(cursor + 46, cursor + 46 + nameLength));

    // Follow the directory's offset to the local header, exactly as an extractor does —
    // this is what catches an offset that was computed against the wrong pass.
    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const dataStart = localOffset + 30 + localNameLength;
    const data = archive.subarray(dataStart, dataStart + size);

    // The checksum an extractor would verify before reporting the file as intact.
    expect(crc32(data)).toBe(storedCrc);

    names.push(name);
    files.set(name, decoder.decode(data));
    cursor += 46 + nameLength;
  }

  return { names, files };
}

describe("crc32", () => {
  // The published check values for CRC-32. If the lookup table were built with a
  // sign-propagating shift, or the wrong polynomial, these are what would catch it —
  // and every entry in every archive would otherwise report as corrupt.
  it("matches the published check values", () => {
    expect(crc32(bytes(""))).toBe(0);
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(bytes("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });

  it("stays unsigned for inputs that set the high bit", () => {
    // A `>>` instead of `>>>` anywhere in the table or the loop produces a negative
    // number here, which `DataView.setUint32` would then write as its two's complement.
    const crc = crc32(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    expect(crc).toBeGreaterThanOrEqual(0);
    expect(crc).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("buildZip", () => {
  it("round-trips every entry's name and bytes", () => {
    const archive = buildZip([
      { name: "first.txt", data: bytes("hello") },
      { name: "second.txt", data: bytes("world, at some length") },
    ]);

    const { names, files } = readZip(archive);
    expect(names).toEqual(["first.txt", "second.txt"]);
    expect(files.get("first.txt")).toBe("hello");
    expect(files.get("second.txt")).toBe("world, at some length");
  });

  it("keeps folder paths and non-ASCII names intact", () => {
    // The case this writer exists for: a photo archive full of folders like
    // `2019-06-09 Von Thun Farm`. Without the UTF-8 flag an extractor is entitled to
    // read the name as code page 437 and mangle the accent.
    const archive = buildZip([
      { name: "2019/Café Découverte/IMG_0001.jpg", data: bytes("jpeg-ish") },
    ]);

    const { names, files } = readZip(archive);
    expect(names).toEqual(["2019/Café Découverte/IMG_0001.jpg"]);
    expect(files.get("2019/Café Découverte/IMG_0001.jpg")).toBe("jpeg-ish");
  });

  it("handles an empty file without corrupting the offsets that follow", () => {
    // A zero-length entry is the case where a size/offset bug hides: the next local
    // header starts immediately after the name, with no data in between.
    const archive = buildZip([
      { name: "empty.txt", data: new Uint8Array(0) },
      { name: "after.txt", data: bytes("still readable") },
    ]);

    const { files } = readZip(archive);
    expect(files.get("empty.txt")).toBe("");
    expect(files.get("after.txt")).toBe("still readable");
  });

  it("writes exactly the bytes it sized itself for", () => {
    // `ByteWriter.finish` throws when the write and the arithmetic disagree, so this
    // asserts the computed total is the real one rather than trusting the happy path.
    const archive = buildZip([{ name: "a.txt", data: bytes("abc") }]);
    // 30-byte local header + 5-byte name + 3 bytes + 46-byte central entry + 5-byte
    // name + 22-byte EOCD.
    expect(archive.length).toBe(30 + 5 + 3 + 46 + 5 + 22);
  });

  it("refuses an empty archive", () => {
    // A zip with no entries is a valid file that opens onto nothing, which reads to the
    // person who clicked Download as a broken feature rather than an empty selection.
    expect(() => buildZip([])).toThrow(/at least one file/);
  });

  it("refuses a duplicate name rather than choosing for the caller", () => {
    expect(() =>
      buildZip([
        { name: "same.jpg", data: bytes("one") },
        { name: "same.jpg", data: bytes("two") },
      ]),
    ).toThrow(/Duplicate/);
  });

  it("refuses names that would extract outside the archive", () => {
    // The output is a file someone double-clicks, so a traversal is rejected here as
    // well as upstream — the same belt-and-braces the photo route applies to its path.
    expect(() => buildZip([{ name: "../escape.txt", data: bytes("x") }])).toThrow(/upwards/);
    expect(() => buildZip([{ name: "a/../../b.txt", data: bytes("x") }])).toThrow(/upwards/);
    expect(() => buildZip([{ name: "/absolute.txt", data: bytes("x") }])).toThrow(/relative/);
    expect(() => buildZip([{ name: "C:/windows.txt", data: bytes("x") }])).toThrow(/relative/);
    expect(() => buildZip([{ name: "back\\slash.txt", data: bytes("x") }])).toThrow(
      /forward slashes/,
    );
    expect(() => buildZip([{ name: "", data: bytes("x") }])).toThrow(/needs a name/);
  });
});

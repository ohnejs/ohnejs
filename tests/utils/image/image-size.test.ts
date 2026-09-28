import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { imageSize } from '../../../src/utils/image/image-size.ts';

type Part = string | number[] | Uint8Array;

function bytes(...parts: Part[]): Uint8Array {
  const chunks = parts.map((part) =>
    typeof part === 'string'
      ? Uint8Array.from(part, (char) => char.charCodeAt(0))
      : Uint8Array.from(part),
  );
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function u16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function u32(value: number): number[] {
  return [...u16(value >>> 16), ...u16(value & 0xffff)];
}

function u16le(value: number): number[] {
  return u16(value).reverse();
}

function u24le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}

function u32le(value: number): number[] {
  return u32(value).reverse();
}

function box(type: string, ...payload: Part[]): Uint8Array {
  const body = bytes(...payload);
  return bytes(u32(8 + body.length), type, body);
}

function svg(markup: string): Uint8Array {
  return new TextEncoder().encode(markup);
}

const PNG = bytes('\x89PNG\r\n\x1a\n', u32(13), 'IHDR', u32(640), u32(480), [8, 6, 0, 0, 0]);
const GIF = bytes('GIF89a', u16le(320), u16le(200), [0xf7, 0, 0]);
const SOI = [0xff, 0xd8];
const APP0 = bytes([0xff, 0xe0], u16(16), 'JFIF\0', [1, 1, 0], u16(72), u16(72), [0, 0]);
const DHT = bytes([0xff, 0xc4], u16(5), [0, 0, 0]);

function sof(marker: number, width: number, height: number): Uint8Array {
  return bytes([0xff, marker], u16(11), [8], u16(height), u16(width), [1, 1, 0x11, 0]);
}

function exif(orientation: number, little = false): Uint8Array {
  const order = little ? 'II' : 'MM';
  const n16 = little ? u16le : u16;
  const n32 = little ? u32le : u32;
  const tiff = bytes(
    order,
    n16(42),
    n32(8),
    n16(1),
    n16(0x0112),
    n16(3),
    n32(1),
    n16(orientation),
    [0, 0],
  );
  return bytes([0xff, 0xe1], u16(2 + 6 + tiff.length), 'Exif\0\0', tiff);
}

function isobmff(major: string, compatible: string[], ...meta: Uint8Array[]): Uint8Array {
  const ftyp = box('ftyp', major, u32(0), ...compatible);
  return bytes(ftyp, box('meta', u32(0), ...meta));
}

const ISPE = box('ispe', u32(0), u32(1200), u32(800));
const PITM = box('pitm', u32(0), u16(1));
const IPMA = box('ipma', u32(0), u32(1), u16(1), [2, 0x81, 0x02]);
const IPRP = box('iprp', box('ipco', box('hvcC', [1, 2, 3]), ISPE), IPMA);

describe('imageSize', () => {
  it('reads a PNG header', () => {
    deepStrictEqual(imageSize(PNG), { width: 640, height: 480, type: 'image/png' });
  });

  it('reads a GIF logical screen descriptor', () => {
    deepStrictEqual(imageSize(GIF), { width: 320, height: 200, type: 'image/gif' });
  });

  it('reads a WebP VP8 key frame', () => {
    const webp = bytes(
      'RIFF',
      u32le(0),
      'WEBP',
      'VP8 ',
      u32le(0),
      [0, 0, 0],
      [0x9d, 0x01, 0x2a],
      u16le(300),
      u16le(150),
    );
    deepStrictEqual(imageSize(webp), { width: 300, height: 150, type: 'image/webp' });
  });

  it('reads a WebP VP8L header', () => {
    const webp = bytes('RIFF', u32le(0), 'WEBP', 'VP8L', u32le(0), [0x2f], u32le(99 | (49 << 14)));
    deepStrictEqual(imageSize(webp), { width: 100, height: 50, type: 'image/webp' });
  });

  it('reads a WebP VP8X canvas', () => {
    const webp = bytes(
      'RIFF',
      u32le(0),
      'WEBP',
      'VP8X',
      u32le(10),
      [0x10, 0, 0, 0],
      u24le(1919),
      u24le(1079),
    );
    deepStrictEqual(imageSize(webp), { width: 1920, height: 1080, type: 'image/webp' });
  });

  it('reads a baseline JPEG frame header', () => {
    const jpeg = bytes(SOI, APP0, DHT, sof(0xc0, 200, 100));
    deepStrictEqual(imageSize(jpeg), { width: 200, height: 100, type: 'image/jpeg' });
  });

  it('reads a progressive JPEG frame header past fill bytes and standalone markers', () => {
    const jpeg = bytes(SOI, [0xff, 0xff, 0xff, 0x01], [0xff, 0xd0], APP0, sof(0xc2, 200, 100));
    deepStrictEqual(imageSize(jpeg), { width: 200, height: 100, type: 'image/jpeg' });
  });

  it('swaps a JPEG size for an EXIF orientation of 5 to 8', () => {
    const rotated = bytes(SOI, exif(6), sof(0xc0, 200, 100));
    deepStrictEqual(imageSize(rotated), { width: 100, height: 200, type: 'image/jpeg' });

    const littleEndian = bytes(SOI, APP0, exif(8, true), sof(0xc0, 200, 100));
    deepStrictEqual(imageSize(littleEndian), { width: 100, height: 200, type: 'image/jpeg' });

    const upright = bytes(SOI, exif(1), sof(0xc0, 200, 100));
    deepStrictEqual(imageSize(upright), { width: 200, height: 100, type: 'image/jpeg' });
  });

  it('ignores an APP1 segment that is not EXIF', () => {
    const xmp = bytes([0xff, 0xe1], u16(31), 'http://ns.adobe.com/xap/1.0/\0');
    const jpeg = bytes(SOI, xmp, sof(0xc0, 200, 100));
    deepStrictEqual(imageSize(jpeg), { width: 200, height: 100, type: 'image/jpeg' });
  });

  it('gives no answer for a JPEG whose height waits for a DNL marker', () => {
    strictEqual(imageSize(bytes(SOI, sof(0xc0, 200, 0))), undefined);
  });

  it('reads an AVIF ispe box', () => {
    const avif = isobmff('avif', ['avif', 'mif1', 'miaf'], PITM, IPRP);
    deepStrictEqual(imageSize(avif), { width: 1200, height: 800, type: 'image/avif' });
  });

  it('maps HEIF brands to their media type', () => {
    strictEqual(imageSize(isobmff('heic', ['mif1', 'heic'], IPRP))?.type, 'image/heic');
    strictEqual(imageSize(isobmff('mif1', ['heix'], IPRP))?.type, 'image/heic');
    strictEqual(imageSize(isobmff('mif1', ['heif'], IPRP))?.type, 'image/heif');
    strictEqual(imageSize(isobmff('mif1', [], IPRP))?.type, 'image/heif');
  });

  it('prefers an AVIF brand over a generic HEIF brand', () => {
    strictEqual(imageSize(isobmff('mif1', ['avif'], IPRP))?.type, 'image/avif');
  });

  it('gives no answer for an unknown ISOBMFF brand', () => {
    strictEqual(imageSize(isobmff('isom', ['mp41'], IPRP)), undefined);
  });

  it('sizes a tiled HEIC by its primary item, not by its first tile', () => {
    const tile = box('ispe', u32(0), u32(1024), u32(1024));
    const grid = box('ispe', u32(0), u32(6016), u32(6016));
    const ipco = box('ipco', box('hvcC', [1]), tile, grid, box('irot', [1]));
    const ipma = box('ipma', u32(0), u32(2), u16(1), [2, 0x81, 0x02], u16(37), [2, 0x03, 0x04]);
    const pitm = box('pitm', u32(0), u16(37));
    const heic = isobmff('heic', ['mif1'], pitm, box('iprp', ipco, ipma));
    deepStrictEqual(imageSize(heic), { width: 6016, height: 6016, type: 'image/heic' });
  });

  it('reads 32-bit item IDs and 15-bit property indices', () => {
    const pitm = box('pitm', [1, 0, 0, 0], u32(70000));
    const flags = [1, 0, 0, 1];
    const ipma = box('ipma', flags, u32(2), u32(1), [1], u16(0x8001), u32(70000), [1], u16(2));
    const ipco = box('ipco', box('ispe', u32(0), u32(1), u32(1)), ISPE);
    const heif = isobmff('mif1', [], pitm, box('iprp', ipco, ipma));
    deepStrictEqual(imageSize(heif), { width: 1200, height: 800, type: 'image/heif' });
  });

  it('falls back to the first ispe when the primary item cannot be resolved', () => {
    const ipco = box('ipco', ISPE, box('ispe', u32(0), u32(1), u32(1)));
    const size = { width: 1200, height: 800, type: 'image/avif' };
    deepStrictEqual(imageSize(isobmff('avif', [], box('iprp', ipco))), size);
    const dangling = box('ipma', u32(0), u32(1), u16(1), [1, 0x09]);
    deepStrictEqual(imageSize(isobmff('avif', [], PITM, box('iprp', ipco, dangling))), size);
  });

  it('follows a 64-bit box size', () => {
    const large = bytes(u32(1), 'meta', u32(0), u32(16 + 4 + IPRP.length), u32(0), IPRP);
    const avif = bytes(box('ftyp', 'avif', u32(0)), large);
    deepStrictEqual(imageSize(avif), { width: 1200, height: 800, type: 'image/avif' });
  });

  it('reads SVG width and height in px or unitless', () => {
    const type = 'image/svg+xml';
    const plain = svg('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"/>');
    deepStrictEqual(imageSize(plain), { width: 24, height: 16, type });
    const px = svg("<svg width='24px' height='16.5px'></svg>");
    deepStrictEqual(imageSize(px), { width: 24, height: 16.5, type });
    const spaced = svg('<svg\n  width = "24"\n  height="16"\n>');
    deepStrictEqual(imageSize(spaced), { width: 24, height: 16, type });
  });

  it('never reads a size from inside another SVG attribute value', () => {
    const type = 'image/svg+xml';
    const nested = svg(
      `<svg width="100" height="80" data-x=" width='5'" aria-label="a height='1'"/>`,
    );
    deepStrictEqual(imageSize(nested), { width: 100, height: 80, type });
    const decoy = svg(`<svg data-x=' viewBox="0 0 1 1"' viewBox="0 0 24 16"/>`);
    deepStrictEqual(imageSize(decoy), { width: 24, height: 16, type });
  });

  it('falls back to the SVG viewBox', () => {
    const type = 'image/svg+xml';
    const only = svg('<svg viewBox="0 0 24 16"/>');
    deepStrictEqual(imageSize(only), { width: 24, height: 16, type });
    const percent = svg('<svg width="100%" height="100%" viewBox="10,10,24,16"/>');
    deepStrictEqual(imageSize(percent), { width: 24, height: 16, type });
    const partial = svg('<svg width="24" viewBox="0 0 48 32"/>');
    deepStrictEqual(imageSize(partial), { width: 48, height: 32, type });
  });

  it('skips a BOM, XML declaration, doctype, and comments before the SVG root', () => {
    const markup =
      '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n' +
      '  <!ENTITY ns_svg "http://www.w3.org/2000/svg">\n]>\n' +
      '<!-- <svg width="1" height="1"> -->\n' +
      '<svg xmlns="&ns_svg;" width="24" height="16" viewBox="0 0 48 32"><path d="M0 0h24v16H0z"/></svg>';
    deepStrictEqual(imageSize(svg(markup)), { width: 24, height: 16, type: 'image/svg+xml' });
  });

  it('treats an SVG length that is not positive as absent', () => {
    const negative = svg('<svg width="-24" height="-16" viewBox="0 0 48 32"/>');
    deepStrictEqual(imageSize(negative), { width: 48, height: 32, type: 'image/svg+xml' });
    strictEqual(imageSize(svg('<svg width="-24" height="16"/>')), undefined);
    strictEqual(imageSize(svg('<svg width="0" height="16"/>')), undefined);
  });

  it('scans a long prologue without stalling', () => {
    const prologue = '<?pi a?>'.repeat(2000) + '<!-- - -- --->'.repeat(2000);
    const markup = svg(prologue + '<svg width="24" height="16"/>');
    deepStrictEqual(imageSize(markup), { width: 24, height: 16, type: 'image/svg+xml' });
    strictEqual(imageSize(svg(prologue + 'x')), undefined);
  });

  it('gives no answer for an SVG length in another unit', () => {
    strictEqual(imageSize(svg('<svg width="10em" height="10em" viewBox="0 0 24 16"/>')), undefined);
    strictEqual(imageSize(svg('<svg width="10mm" height="5mm"/>')), undefined);
  });

  it('gives no answer for an SVG without a usable size', () => {
    strictEqual(imageSize(svg('<svg xmlns="http://www.w3.org/2000/svg"/>')), undefined);
    strictEqual(imageSize(svg('<svg width="100%" height="100%"/>')), undefined);
    strictEqual(imageSize(svg('<svg viewBox="0 0 0 16"/>')), undefined);
    strictEqual(imageSize(svg('<svg viewBox="0 0 24"/>')), undefined);
  });

  it('does not mistake an HTML document with an inline svg for an image', () => {
    const html = svg('<!doctype html><html><body><svg width="24" height="16"/></body></html>');
    strictEqual(imageSize(html), undefined);
    strictEqual(imageSize(svg('<svgx width="24" height="16"/>')), undefined);
  });

  it('reads from a view into a larger buffer', () => {
    const padded = bytes([0, 0, 0], PNG).subarray(3);
    deepStrictEqual(imageSize(padded), { width: 640, height: 480, type: 'image/png' });
  });

  it('gives no answer for a truncated header', () => {
    strictEqual(imageSize(PNG.subarray(0, 23)), undefined);
    strictEqual(imageSize(GIF.subarray(0, 9)), undefined);
    const webp = bytes('RIFF', u32le(0), 'WEBP', 'VP8L', u32le(0), [0x2f, 1, 2]);
    strictEqual(imageSize(webp), undefined);
    strictEqual(imageSize(bytes(SOI, APP0, DHT)), undefined);
    strictEqual(imageSize(bytes(SOI, APP0, sof(0xc0, 200, 100).subarray(0, 8))), undefined);
    const avif = isobmff('avif', ['mif1'], PITM, box('iprp', box('ipco', ISPE)));
    strictEqual(imageSize(avif.subarray(0, avif.length - 5)), undefined);
    const markup = svg('<svg xmlns="http://www.w3.org/2000/svg" width="24" heigh');
    strictEqual(imageSize(markup), undefined);
  });

  it('gives no answer for empty, random, or foreign bytes', () => {
    strictEqual(imageSize(new Uint8Array(0)), undefined);
    strictEqual(imageSize(crypto.getRandomValues(new Uint8Array(4096))), undefined);
    strictEqual(imageSize(bytes('%PDF-1.7\n')), undefined);
    strictEqual(imageSize(bytes([0xff, 0xd8, 0x00, 0x00])), undefined);
    strictEqual(imageSize(bytes([0xff, 0xd8, 0xff, 0xd9])), undefined);
  });
});

import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { sniffMediaType } from '../../../src/utils/mime/sniff-media-type.ts';

function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function ebml(docType: string): Uint8Array {
  const header = [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01];
  const sizes = [0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08];
  const type = [0x42, 0x82, 0x80 | docType.length, ...latin1(docType)];
  return new Uint8Array([...header, ...sizes, ...type, 0x42, 0x87, 0x81, 0x04]);
}

describe('sniffMediaType', () => {
  it('recognises raster images', () => {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
    strictEqual(sniffMediaType(new Uint8Array(png)), 'image/png');
    strictEqual(sniffMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])), 'image/jpeg');
    strictEqual(sniffMediaType(latin1('GIF89a\x01\x00\x01\x00')), 'image/gif');
    strictEqual(sniffMediaType(latin1('GIF87a\x01\x00\x01\x00')), 'image/gif');
    strictEqual(sniffMediaType(latin1('RIFF\x24\x00\x00\x00WEBPVP8 ')), 'image/webp');
    strictEqual(sniffMediaType(latin1('BM\x3a\0\0\0\0\0\0\0\x36\0\0\0\x28\0\0\0')), 'image/bmp');
    strictEqual(sniffMediaType(latin1('BM\x1e\0\0\0\0\0\0\0\x1a\0\0\0\x0c\0\0\0')), 'image/bmp');
    strictEqual(
      sniffMediaType(new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01, 0x00])),
      'image/x-icon',
    );
    strictEqual(sniffMediaType(new Uint8Array([0x49, 0x49, 0x2a, 0x00])), 'image/tiff');
    strictEqual(sniffMediaType(new Uint8Array([0x4d, 0x4d, 0x00, 0x2a])), 'image/tiff');
  });

  it('recognises HEIF-family images by their ftyp brand', () => {
    strictEqual(sniffMediaType(latin1('\0\0\0\x1cftypavif\0\0\0\0avifmif1')), 'image/avif');
    strictEqual(sniffMediaType(latin1('\0\0\0\x1cftypavis\0\0\0\0')), 'image/avif');
    for (const brand of ['heic', 'heix', 'hevc', 'hevx']) {
      strictEqual(sniffMediaType(latin1(`\0\0\0\x18ftyp${brand}\0\0\0\0`)), 'image/heic');
    }
    strictEqual(sniffMediaType(latin1('\0\0\0\x18ftypmif1\0\0\0\0')), 'image/heif');
    strictEqual(sniffMediaType(latin1('\0\0\0\x18ftypmsf1\0\0\0\0')), 'image/heif');
  });

  it('recognises an SVG root', () => {
    strictEqual(
      sniffMediaType(utf8('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
      'image/svg+xml',
    );
    strictEqual(sniffMediaType(utf8('<svg>')), 'image/svg+xml');
    strictEqual(sniffMediaType(utf8('<svg/>')), 'image/svg+xml');
    strictEqual(sniffMediaType(utf8('\n\t  <svg viewBox="0 0 1 1"/>')), 'image/svg+xml');
  });

  it('skips a BOM, the XML declaration, comments, and a DOCTYPE before the SVG root', () => {
    strictEqual(sniffMediaType(utf8('\uFEFF<svg/>')), 'image/svg+xml');
    strictEqual(
      sniffMediaType(utf8('<?xml version="1.0" encoding="UTF-8"?>\n<svg/>')),
      'image/svg+xml',
    );
    strictEqual(sniffMediaType(utf8('<!-- Generator: a > b -->\n<svg/>')), 'image/svg+xml');
    strictEqual(
      sniffMediaType(
        utf8(
          '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg/>',
        ),
      ),
      'image/svg+xml',
    );
    strictEqual(
      sniffMediaType(utf8('<!DOCTYPE svg [ <!ENTITY unit "10"> ]>\n<svg/>')),
      'image/svg+xml',
    );
    strictEqual(
      sniffMediaType(
        utf8('\uFEFF<?xml version="1.0"?>\n<!-- one -->\n<!DOCTYPE svg>\n<!-- two -->\n\n<svg/>'),
      ),
      'image/svg+xml',
    );
  });

  it('does not take other markup for SVG', () => {
    strictEqual(sniffMediaType(utf8('<svgfoo/>')), undefined);
    strictEqual(sniffMediaType(utf8('<!DOCTYPE html><html><svg/></html>')), undefined);
    strictEqual(sniffMediaType(utf8('<?xml version="1.0"?><root><svg/></root>')), undefined);
    strictEqual(sniffMediaType(utf8('<?xml version="1.0"?>')), undefined);
  });

  it('recognises documents and archives', () => {
    strictEqual(sniffMediaType(latin1('%PDF-1.7\n')), 'application/pdf');
    strictEqual(
      sniffMediaType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])),
      'application/zip',
    );
    strictEqual(sniffMediaType(new Uint8Array([0x1f, 0x8b, 0x08, 0x00])), 'application/gzip');
    strictEqual(
      sniffMediaType(new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04])),
      'application/x-7z-compressed',
    );
    strictEqual(sniffMediaType(latin1('Rar!\x1a\x07\x00')), 'application/vnd.rar');
    strictEqual(sniffMediaType(latin1('Rar!\x1a\x07\x01\x00')), 'application/vnd.rar');
  });

  it('recognises a tar block by the ustar mark at offset 257', () => {
    const block = new Uint8Array(512);
    block.set(latin1('README.md'), 0);
    block.set(latin1('ustar\0'), 257);
    strictEqual(sniffMediaType(block), 'application/x-tar');
    strictEqual(sniffMediaType(block.subarray(0, 260)), undefined);
  });

  it('recognises video containers', () => {
    for (const brand of ['isom', 'iso2', 'mp41', 'mp42', 'avc1']) {
      strictEqual(sniffMediaType(latin1(`\0\0\0\x18ftyp${brand}\0\0\0\0`)), 'video/mp4');
    }
    strictEqual(sniffMediaType(latin1('\0\0\0\x18ftypM4V \0\0\0\0')), 'video/x-m4v');
    strictEqual(sniffMediaType(latin1('\0\0\0\x14ftypqt  \0\0\0\0')), 'video/quicktime');
    strictEqual(sniffMediaType(ebml('webm')), 'video/webm');
    strictEqual(sniffMediaType(ebml('matroska')), 'video/x-matroska');
    strictEqual(sniffMediaType(latin1('RIFF\x00\x00\x00\x00AVI LIST')), 'video/x-msvideo');
  });

  it('recognises audio', () => {
    strictEqual(sniffMediaType(latin1('\0\0\0\x18ftypM4A \0\0\0\0')), 'audio/mp4');
    strictEqual(sniffMediaType(latin1('OggS\0\x02')), 'application/ogg');
    strictEqual(sniffMediaType(latin1('ID3\x04\0\0')), 'audio/mpeg');
    strictEqual(sniffMediaType(new Uint8Array([0xff, 0xfb, 0x90, 0x00])), 'audio/mpeg');
    strictEqual(sniffMediaType(new Uint8Array([0xff, 0xfa, 0x90, 0x00])), 'audio/mpeg');
    strictEqual(sniffMediaType(new Uint8Array([0xff, 0xf3, 0x80, 0x00])), 'audio/mpeg');
    strictEqual(sniffMediaType(new Uint8Array([0xff, 0xe3, 0x80, 0x00])), 'audio/mpeg');
    strictEqual(sniffMediaType(latin1('RIFF\x24\x08\x00\x00WAVEfmt ')), 'audio/wav');
    strictEqual(sniffMediaType(latin1('fLaC\0\0\0\x22')), 'audio/flac');
  });

  it('does not take a UTF-16 BOM or a reserved MPEG version for an audio frame', () => {
    strictEqual(sniffMediaType(new Uint8Array([0xff, 0xfe, 0x3c, 0x00])), undefined);
    strictEqual(sniffMediaType(new Uint8Array([0xff, 0xeb, 0x90, 0x00])), undefined);
    strictEqual(sniffMediaType(new Uint8Array([0xff])), undefined);
  });

  it('recognises fonts', () => {
    strictEqual(sniffMediaType(latin1('wOFF\0\x01\0\0')), 'font/woff');
    strictEqual(sniffMediaType(latin1('wOF2\0\x01\0\0')), 'font/woff2');
    strictEqual(sniffMediaType(new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x00, 0x0c])), 'font/ttf');
    strictEqual(sniffMediaType(latin1('OTTO\0\x0c')), 'font/otf');
  });

  it('recognises WebAssembly', () => {
    const wasm = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
    strictEqual(sniffMediaType(new Uint8Array(wasm)), 'application/wasm');
  });

  it('returns undefined for an unknown container form or brand', () => {
    strictEqual(sniffMediaType(latin1('RIFF\x00\x00\x00\x00ACON')), undefined);
    strictEqual(sniffMediaType(latin1('\0\0\0\x18ftyp3gp5\0\0\0\0')), undefined);
    strictEqual(sniffMediaType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80])), undefined);
  });

  it('does not take text that opens with a short signature for a binary format', () => {
    strictEqual(sniffMediaType(utf8('BMI,weight\n22.5,70\n')), undefined);
    strictEqual(sniffMediaType(utf8('BMW service log, 2024 and onward\n')), undefined);
    strictEqual(sniffMediaType(utf8('ID3 notes')), undefined);
    strictEqual(sniffMediaType(utf8('OTTO;Street;City\n')), undefined);
  });

  it('returns undefined for text and for an empty or short header', () => {
    strictEqual(sniffMediaType(utf8('hello')), undefined);
    strictEqual(sniffMediaType(utf8('{ "a": 1 }')), undefined);
    strictEqual(sniffMediaType(utf8('true')), undefined);
    strictEqual(sniffMediaType(new Uint8Array(0)), undefined);
    strictEqual(sniffMediaType(new Uint8Array([0x89])), undefined);
    strictEqual(sniffMediaType(new Uint8Array([0x50, 0x4b])), undefined);
  });

  it('never matches an inherited table name', () => {
    strictEqual(sniffMediaType(ebml('toString')), undefined);
    strictEqual(sniffMediaType(ebml('constructor')), undefined);
  });
});

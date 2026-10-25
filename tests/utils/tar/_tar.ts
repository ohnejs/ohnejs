const encoder = new TextEncoder();

/**
 * One entry for `tar`: its header fields and its data.
 */
export interface TarSpec {
  name: string;
  type?: string;
  data?: string | Uint8Array;
  prefix?: string;
  gnu?: boolean;
  size?: number;
}

/**
 * A tar archive of `specs`, closed by the two zero blocks.
 */
export function tar(...specs: TarSpec[]): Uint8Array {
  return concat(...specs.flatMap(entry), new Uint8Array(1024));
}

/**
 * A pax header entry carrying `records`, to place before the entry it describes.
 */
export function pax(records: Record<string, string>, type = 'x'): TarSpec {
  const lines = Object.entries(records).map(([key, value]) => {
    const body = ` ${key}=${value}\n`;
    let length = encoder.encode(body).length;
    while (String(length).length + encoder.encode(body).length !== length) {
      length = String(length).length + encoder.encode(body).length;
    }
    return `${length}${body}`;
  });
  return { name: 'PaxHeader', type, data: lines.join('') };
}

/**
 * The header block, then the data padded to whole blocks.
 */
function entry(spec: TarSpec): Uint8Array[] {
  const data =
    typeof spec.data === 'string' ? encoder.encode(spec.data) : (spec.data ?? new Uint8Array(0));
  const header = new Uint8Array(512);
  field(header, 0, spec.name);
  field(header, 100, '0000644\0');
  field(header, 124, `${(spec.size ?? data.length).toString(8).padStart(11, '0')}\0`);
  field(header, 136, '00000000000\0');
  field(header, 156, spec.type ?? '0');
  field(header, 257, spec.gnu ? 'ustar  \0' : 'ustar\u000000');
  field(header, 345, spec.prefix ?? '');
  field(header, 148, '        ');
  const sum = header.reduce((total, byte) => total + byte, 0);
  field(header, 148, `${sum.toString(8).padStart(6, '0')}\0 `);
  return [header, data, new Uint8Array((512 - (data.length % 512)) % 512)];
}

/**
 * Writes `text` into `header` at `start`.
 */
function field(header: Uint8Array, start: number, text: string): void {
  header.set(encoder.encode(text), start);
}

/**
 * The bytes of `parts`, one after another.
 */
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

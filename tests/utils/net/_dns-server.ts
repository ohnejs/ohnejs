import { createSocket } from 'node:dgram';

/**
 * The addresses one name answers with, per record type.
 */
export interface DNSRecords {
  A?: string[];
  AAAA?: string[];
}

/**
 * A DNS responder on `127.0.0.1`, for `Resolver.setServers`.
 */
export interface DNSServer {
  /**
   * The responder's address, as `Resolver.setServers` takes it.
   */
  servers: string[];

  /**
   * Names and their records, read on every query, so a test can rebind a name between two lookups.
   */
  zone: Map<string, DNSRecords>;

  /**
   * Every question asked, as `'A loop.test'`.
   */
  queries: string[];

  /**
   * Stops the responder.
   */
  close: () => Promise<void>;
}

const A = 1;
const AAAA = 28;

/**
 * Header flags of a recursive answer: found, and no such name.
 */
const NOERROR = 0x8180;
const NXDOMAIN = 0x8183;

/**
 * Starts a UDP DNS responder on `127.0.0.1` that answers from `zone` with a TTL of `0`.
 * A name outside the zone is `NXDOMAIN`; a name without records of the asked type answers empty.
 */
export async function startDNSServer(zone: Record<string, DNSRecords>): Promise<DNSServer> {
  const socket = createSocket('udp4');
  const server: DNSServer = {
    servers: [],
    zone: new Map(Object.entries(zone)),
    queries: [],
    close: () => new Promise((resolve) => socket.close(() => resolve())),
  };
  socket.on('message', (query, remote) => {
    socket.send(answer(query, server), remote.port, remote.address);
  });
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  server.servers.push(`127.0.0.1:${socket.address().port}`);
  return server;
}

/**
 * The response to one query: its question echoed, then one record per address.
 */
function answer(query: Buffer, server: DNSServer): Buffer {
  const labels: string[] = [];
  let offset = 12;
  for (let length = query[offset]; length > 0; length = query[offset]) {
    labels.push(query.toString('latin1', offset + 1, offset + 1 + length));
    offset += length + 1;
  }
  const type = query.readUInt16BE(offset + 1);
  const name = labels.join('.').toLowerCase();
  const kind = type === A ? 'A' : type === AAAA ? 'AAAA' : undefined;
  server.queries.push(`${kind ?? type} ${name}`);

  const records = server.zone.get(name);
  const addresses = (kind && records?.[kind]) ?? [];
  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2);
  header.writeUInt16BE(records ? NOERROR : NXDOMAIN, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(addresses.length, 6);
  const question = query.subarray(12, offset + 5);
  return Buffer.concat([header, question, ...addresses.map((address) => record(type, address))]);
}

/**
 * One answer record, named by a pointer back to the question.
 */
function record(type: number, address: string): Buffer {
  const data = type === A ? Buffer.from(address.split('.').map(Number)) : ipv6Bytes(address);
  const head = Buffer.alloc(12);
  head.writeUInt16BE(0xc00c, 0);
  head.writeUInt16BE(type, 2);
  head.writeUInt16BE(1, 4);
  head.writeUInt32BE(0, 6);
  head.writeUInt16BE(data.length, 10);
  return Buffer.concat([head, data]);
}

/**
 * The 16 bytes of an IPv6 address, a dotted IPv4 tail included.
 */
function ipv6Bytes(address: string): Buffer {
  const groups = (part: string): string[] =>
    part === ''
      ? []
      : part.split(':').flatMap((group) => {
          if (!group.includes('.')) return [group];
          const hex = Buffer.from(group.split('.').map(Number)).toString('hex');
          return [hex.slice(0, 4), hex.slice(4)];
        });
  const [head = '', tail] = address.split('::');
  const left = groups(head);
  const right = groups(tail ?? '');
  const zeros = Array<string>(8 - left.length - right.length).fill('0');
  return Buffer.from(
    [...left, ...zeros, ...right].map((group) => group.padStart(4, '0')).join(''),
    'hex',
  );
}

import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  formatSIP,
  isSIPRequest,
  parseSIP,
  type SIPMessage,
  type SIPRequest,
  type SIPResponse,
} from '../../../src/utils/index.ts';

const REGISTER = [
  'REGISTER sip:127.0.0.1 SIP/2.0',
  'Via: SIP/2.0/WS df7jal23ls0d.invalid;branch=z9hG4bK776;rport',
  'Max-Forwards: 70',
  'From: <sip:owner@127.0.0.1>;tag=a6c8',
  'To: <sip:owner@127.0.0.1>',
  'Call-ID: 3f1c9e',
  'CSeq: 1 REGISTER',
  'Contact: <sip:x@df7jal23ls0d.invalid;transport=ws>;expires=600',
  'Content-Length: 0',
  '',
  '',
].join('\r\n');

const UNAUTHORIZED = [
  'SIP/2.0 401 Unauthorized',
  'Via: SIP/2.0/WS df7jal23ls0d.invalid;branch=z9hG4bK776;rport=5060;received=127.0.0.1',
  'Call-ID: 3f1c9e',
  'CSeq: 1 REGISTER',
  'WWW-Authenticate: Digest realm="asterisk",nonce="1732a7",algorithm=SHA-256,qop="auth"',
  'WWW-Authenticate: Digest realm="asterisk",nonce="1732a8",algorithm=MD5,qop="auth"',
  'Content-Length: 0',
  '',
  '',
].join('\r\n');

const SDP =
  'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nc=IN IP4 127.0.0.1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

const INVITE = [
  'INVITE sip:owner@127.0.0.1 SIP/2.0',
  'Via: SIP/2.0/WS 127.0.0.1:8088;branch=z9hG4bK1',
  'From: "Jürgen Müller" <sip:+4989123456@127.0.0.1>;tag=9f',
  'To: <sip:owner@127.0.0.1>',
  'Call-ID: inv-1',
  'CSeq: 102 INVITE',
  'Content-Type: application/sdp',
  `Content-Length: ${new TextEncoder().encode(SDP).byteLength}`,
  '',
  SDP,
].join('\r\n');

const OK = [
  'SIP/2.0 200 OK',
  'Via: SIP/2.0/WS a.invalid;branch=z9hG4bK1',
  'Via: SIP/2.0/UDP 10.0.0.1;branch=z9hG4bK2, SIP/2.0/UDP 10.0.0.2;branch=z9hG4bK3',
  'Call-ID: inv-1',
  'CSeq: 102 INVITE',
  'Content-Length: 0',
  '',
  '',
].join('\r\n');

function roundTrip(text: string): SIPMessage {
  const message = parseSIP(text)!;
  strictEqual(formatSIP(message), text);
  deepStrictEqual(parseSIP(formatSIP(message)), message);
  return message;
}

describe('parseSIP', () => {
  it('round-trips a REGISTER', () => {
    const message = roundTrip(REGISTER);
    strictEqual(isSIPRequest(message), true);
    deepStrictEqual(message.headers[0], [
      'Via',
      'SIP/2.0/WS df7jal23ls0d.invalid;branch=z9hG4bK776;rport',
    ]);
    strictEqual(message.body, '');
  });

  it('round-trips a 401 with two challenges', () => {
    const message = roundTrip(UNAUTHORIZED) as SIPResponse;
    deepStrictEqual([message.status, message.reason], [401, 'Unauthorized']);
    strictEqual(message.headers.filter(([name]) => name === 'WWW-Authenticate').length, 2);
  });

  it('round-trips an INVITE with an SDP body and a UTF-8 display name', () => {
    const message = roundTrip(INVITE) as SIPRequest;
    strictEqual(message.method, 'INVITE');
    strictEqual(message.body, SDP);
    deepStrictEqual(message.headers[1], [
      'From',
      '"Jürgen Müller" <sip:+4989123456@127.0.0.1>;tag=9f',
    ]);
  });

  it('round-trips a 200 with several `Via` lines in order', () => {
    const message = roundTrip(OK);
    deepStrictEqual(
      message.headers.filter(([name]) => name === 'Via').map(([, value]) => value),
      [
        'SIP/2.0/WS a.invalid;branch=z9hG4bK1',
        'SIP/2.0/UDP 10.0.0.1;branch=z9hG4bK2, SIP/2.0/UDP 10.0.0.2;branch=z9hG4bK3',
      ],
    );
  });

  it('expands compact names and canonical casing', () => {
    const message = parseSIP(
      'SIP/2.0 180 Ringing\r\nv: SIP/2.0/WS a\r\ni: c1\r\nf: <sip:a@b>\r\nt: <sip:c@d>\r\ncseq: 1 INVITE\r\nX-Custom: y\r\nl: 0\r\n\r\n',
    )!;
    deepStrictEqual(
      message.headers.map(([name]) => name),
      ['Via', 'Call-ID', 'From', 'To', 'CSeq', 'X-Custom', 'Content-Length'],
    );
  });

  it('cuts the body to `Content-Length` in UTF-8 bytes', () => {
    const message = parseSIP('MESSAGE sip:a@b SIP/2.0\r\nContent-Length: 3\r\n\r\nüxyz')!;
    strictEqual(message.body, 'üx');
    strictEqual(formatSIP({ ...message, body: 'ü' }).endsWith('Content-Length: 2\r\n\r\nü'), true);
  });

  it('keeps the whole rest as body without `Content-Length`', () => {
    strictEqual(parseSIP('MESSAGE sip:a@b SIP/2.0\r\n\r\nhello')!.body, 'hello');
  });

  it('unfolds folded lines and reads LF line ends', () => {
    const message = parseSIP(
      'OPTIONS sip:a@b SIP/2.0\nSubject: one\n  two\n\tthree\nCall-ID: x\n\n',
    )!;
    deepStrictEqual(message.headers, [
      ['Subject', 'one two three'],
      ['Call-ID', 'x'],
    ]);
  });

  it('reads an empty reason phrase', () => {
    const message = parseSIP('SIP/2.0 200\r\n\r\n')!;
    deepStrictEqual([isSIPRequest(message), 'reason' in message && message.reason], [false, '']);
  });

  it('returns `null` for a keepalive and for anything but SIP/2.0', () => {
    strictEqual(parseSIP('\r\n\r\n'), null);
    strictEqual(parseSIP(''), null);
    strictEqual(parseSIP('GET / HTTP/1.1\r\nHost: x\r\n\r\n'), null);
    strictEqual(parseSIP('SIP/3.0 200 OK\r\n\r\n'), null);
  });
});

describe('formatSIP', () => {
  it('rewrites `Content-Length` in place, and appends it when missing', () => {
    strictEqual(
      formatSIP({
        status: 200,
        reason: 'OK',
        headers: [
          ['l', '99'],
          ['Call-ID', 'a'],
        ],
        body: 'ab',
      }),
      'SIP/2.0 200 OK\r\nContent-Length: 2\r\nCall-ID: a\r\n\r\nab',
    );
    strictEqual(
      formatSIP({ method: 'BYE', uri: 'sip:a@b', headers: [['Call-ID', 'a']], body: '' }),
      'BYE sip:a@b SIP/2.0\r\nCall-ID: a\r\nContent-Length: 0\r\n\r\n',
    );
  });
});

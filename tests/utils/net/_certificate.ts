/**
 * A self-signed certificate naming `dalaran.test` alone, valid until 2126.
 * Left untrusted it proves a refusal; trusted, it proves the check runs against the hostname.
 */
export const DALARAN_CERT = `-----BEGIN CERTIFICATE-----
MIIBnjCCAUSgAwIBAgIUbww2xBoQ7n6+jkBhM6W/tWpHfJYwCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMZGFsYXJhbi50ZXN0MCAXDTI2MDkyNDIzNDMxNloYDzIxMjYw
ODMxMjM0MzE2WjAXMRUwEwYDVQQDDAxkYWxhcmFuLnRlc3QwWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAATMSVdNHue1EH8o+akbUa814rdy2a1hr/H/kmEXvliAFK3I
0o0//9E2ctkzkqt5hZMT9J1elzUbhcom03CwIg0ro2wwajAdBgNVHQ4EFgQU6Mw7
7AtfkHM+D2Tn1k7IGc4sP8IwHwYDVR0jBBgwFoAU6Mw77AtfkHM+D2Tn1k7IGc4s
P8IwDwYDVR0TAQH/BAUwAwEB/zAXBgNVHREEEDAOggxkYWxhcmFuLnRlc3QwCgYI
KoZIzj0EAwIDSAAwRQIhAIseCFqtzIGguvjNemUWc0bNat7okQtBSvWgmq1eQnwr
AiB7dl69gOpTVa/3rStojbHogoYx59zZNxi4ciO65pRWxw==
-----END CERTIFICATE-----
`;

/**
 * The private key of `DALARAN_CERT`.
 */
export const DALARAN_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQga0qJtfTEp0mr16ri
OiryeMjev/e85CDuJlmOVfLgeiihRANCAATMSVdNHue1EH8o+akbUa814rdy2a1h
r/H/kmEXvliAFK3I0o0//9E2ctkzkqt5hZMT9J1elzUbhcom03CwIg0r
-----END PRIVATE KEY-----
`;

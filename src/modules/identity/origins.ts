/** Exact authentication origins; do not trust arbitrary Host headers. */
export function trustedOrigins() {
  const baseURL = process.env.BETTER_AUTH_URL;
  return [
    ...(baseURL ? [new URL(baseURL).origin] : []),
    "http://macmini:3001",
  ];
}

export function isTrustedOrigin(origin: string | null) {
  return origin !== null && trustedOrigins().includes(origin);
}

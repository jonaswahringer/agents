// Which header can be believed depends entirely on what sits in front of the
// process, so this reads the one the proxy controls and ignores the rest.
//
// Measured on this host: Tailscale Serve sets X-Forwarded-For to the tailnet
// peer and replaces any value the client sent, while it passes CF-Connecting-IP
// and X-Real-IP straight through from the client. Trusting either of those
// ahead of X-Forwarded-For let any tailnet member forge source_ip and slip the
// per-IP rate limit with one header.
//
// So: if a proxy set X-Forwarded-For, that is the answer and nothing else is
// consulted. The fallbacks only apply when no proxy is in front at all, which
// here means a caller already on this machine talking to 127.0.0.1 — and on
// Cloudflare, where cf-connecting-ip is set by the edge and cannot be forged.
export function clientIp(request) {
  const forwarded = forwardedFor(request);
  if (forwarded) return forwarded;
  return cleanHeader(request, "cf-connecting-ip") || cleanHeader(request, "x-real-ip");
}

export function requestId(request) {
  return cleanHeader(request, "cf-ray") || cleanHeader(request, "x-request-id");
}

function forwardedFor(request) {
  const header = cleanHeader(request, "x-forwarded-for");
  if (!header) return null;
  // The entry the nearest trusted proxy appended is the first one Serve writes;
  // anything after it came from the client.
  const first = header.split(",")[0]?.trim();
  return first || null;
}

function cleanHeader(request, name) {
  const value = request.headers.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

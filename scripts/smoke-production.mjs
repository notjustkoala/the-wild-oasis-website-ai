const rawUrl = process.env.GUEST_PRODUCTION_URL;

function productionUrl(value) {
  if (!value) throw new Error("GUEST_PRODUCTION_URL is required.");
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const privateIpv4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname);
  const reserved = hostname === "localhost" || hostname === "::1" || privateIpv4 ||
    /(?:\.local|\.test|\.invalid|\.example)$/.test(hostname) ||
    /^(?:example\.com|example\.net|example\.org)$/.test(hostname);
  if (url.protocol !== "https:" || reserved || url.username || url.password) {
    throw new Error("Use a credential-free, public HTTPS Guest deployment URL; local/private/placeholder hosts are refused.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

try {
  const url = productionUrl(rawUrl);
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": "wild-oasis-production-smoke/1.0" },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Guest returned HTTP ${response.status}.`);
  if (!/<html/i.test(body) || !/The Wild Oasis/i.test(body)) {
    throw new Error("Guest response did not contain the expected app markers.");
  }
  console.log(`Guest production smoke passed: ${url.origin} (HTTP ${response.status}).`);
} catch (error) {
  console.error(`Guest production smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}

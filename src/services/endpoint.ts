const protocolPattern = /^[a-z][a-z\d+.-]*:\/\//i;

export function normalizeOllamaBaseUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const candidate = protocolPattern.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  try {
    const url = new URL(candidate);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return trimmed.replace(/\/+$/, "");
    }

    const path = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${path}${url.search}`;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

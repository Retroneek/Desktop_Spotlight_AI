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
      return "";
    }

    let path = url.pathname.replace(/\/+$/, "");
    // Ollama's REST routes already append /api. Accepting a pasted
    // /api endpoint is convenient, but retaining it would request /api/api/*.
    if (/\/api$/i.test(path)) {
      path = path.slice(0, -4).replace(/\/+$/, "");
    }
    return `${url.origin}${path}`;
  } catch {
    return "";
  }
}

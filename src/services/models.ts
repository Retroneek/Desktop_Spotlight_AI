export function getModelName(model: unknown) {
  if (typeof model === "string") {
    return model;
  }

  if (typeof model === "object" && model !== null) {
    const candidate = model as {
      name?: unknown;
      model?: unknown;
    };

    if (typeof candidate.name === "string") {
      return candidate.name;
    }

    if (typeof candidate.model === "string") {
      return candidate.model;
    }
  }

  return undefined;
}

export function getModelList(models: unknown) {
  if (Array.isArray(models)) {
    return models;
  }

  if (typeof models === "object" && models !== null) {
    const candidate = models as {
      models?: unknown;
    };

    if (Array.isArray(candidate.models)) {
      return candidate.models;
    }
  }

  return [];
}

export function getModelPreferenceScore(modelName: string) {
  const normalized = modelName.toLowerCase();
  const parameterMatch = normalized.match(
    /(?:^|[:_-])(\d+(?:\.\d+)?)b(?:$|[-_])/,
  );
  const parameterScore = parameterMatch
    ? Math.min(Number(parameterMatch[1]), 100)
    : 0;

  return (
    (/(?:coder|codeqwen|starcoder|deepseek-coder)/.test(normalized)
      ? 10_000
      : 0) +
    parameterScore * 10 -
    (/(?:embed|vision)/.test(normalized) ? 20_000 : 0)
  );
}

export function getModelDisplayName(modelName: string) {
  const withoutNamespace = modelName.split("/").pop() ?? modelName;
  const baseName = withoutNamespace.replace(/:.+$/i, "");
  const normalized = baseName.toLowerCase();
  const friendlyMatches: Array<[RegExp, string]> = [
    [/^qwen(?:-| )?2(?:\.| )?5[-_ ]?coder\b/i, "Qwen 2.5 Coder"],
    [/^llama(?:-| )?3(?:\.| )?2\b/i, "Llama 3.2"],
    [/^llama(?:-| )?3(?:\.| )?1\b/i, "Llama 3.1"],
    [/^codellama\b/i, "Code Llama"],
    [/^mistral\b/i, "Mistral"],
    [/^mixtral\b/i, "Mixtral"],
    [/^phi(?:-| )?3\b/i, "Phi 3"],
    [/^qwen(?:-| )?2(?:\.| )?5\b/i, "Qwen 2.5"],
    [/^gemma(?:-| )?2\b/i, "Gemma 2"],
    [/^deepseek(?:-| )?coder\b/i, "DeepSeek Coder"],
  ];

  for (const [pattern, label] of friendlyMatches) {
    if (pattern.test(normalized)) {
      return label;
    }
  }

  const titled = baseName
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());

  return titled.length <= 18 ? titled : `${titled.slice(0, 15)}...`;
}

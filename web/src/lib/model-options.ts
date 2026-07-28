export interface ModelOption {
  value: string;
  name: string;
}

/**
 * Keep custom and legacy configured models visible without mutating config.
 * Only an explicit provider or model change is allowed to replace them.
 */
export function mergeModelOptions(
  catalog: readonly ModelOption[],
  configuredModel: string
): ModelOption[] {
  const options = [...catalog];
  if (!configuredModel || options.some((model) => model.value === configuredModel)) {
    return options;
  }

  return [...options, { value: configuredModel, name: configuredModel }];
}

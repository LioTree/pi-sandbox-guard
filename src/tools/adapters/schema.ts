export function cloneParametersWithPathDescription<T extends { properties?: { path?: { description?: string } } }>(
  parameters: T,
  description: string,
): T {
  const clonedParameters = {
    ...parameters,
    properties: parameters.properties ? { ...parameters.properties } : parameters.properties,
  };

  if (parameters.properties?.path) {
    clonedParameters.properties = {
      ...clonedParameters.properties,
      path: {
        ...parameters.properties.path,
        description,
      },
    };
  }

  return clonedParameters;
}

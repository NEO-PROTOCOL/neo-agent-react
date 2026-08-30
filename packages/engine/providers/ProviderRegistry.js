export class ProviderRegistry {
  constructor(adapters = []) {
    this.adapters = [];
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter) {
    if (
      !adapter?.id ||
      typeof adapter.supports !== "function" ||
      typeof adapter.isConfigured !== "function" ||
      typeof adapter.execute !== "function"
    ) {
      throw new Error("Adapter de provider invalido");
    }
    if (this.adapters.some((current) => current.id === adapter.id)) {
      throw new Error(`Provider duplicado: ${adapter.id}`);
    }
    this.adapters.push(adapter);
    return this;
  }

  resolve(providerId) {
    const adapter = this.adapters.find((candidate) => candidate.supports(providerId));
    if (!adapter) throw new Error(`Provider nao registrado: ${providerId}`);
    return adapter;
  }
}

export class ProviderAdapter {
  constructor({ id, aliases = [] }) {
    if (!id) throw new Error("ProviderAdapter exige id");
    this.id = id;
    this.aliases = aliases;
  }

  supports(providerId) {
    return providerId === this.id || this.aliases.includes(providerId);
  }

  isConfigured() {
    return true;
  }

  async execute() {
    throw new Error(`Provider ${this.id} nao implementa execute()`);
  }
}

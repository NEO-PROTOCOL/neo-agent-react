export class BaseMemoryAdapter {
  async get(key) {
    throw new Error("Método 'get' não implementado");
  }

  async set(key, value, ttlSeconds) {
    throw new Error("Método 'set' não implementado");
  }

  async delete(key) {
    throw new Error("Método 'delete' não implementado");
  }
}

export class InMemoryAdapter extends BaseMemoryAdapter {
  constructor() {
    super();
    this.store = new Map();
  }

  async get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt && item.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key, value, ttlSeconds) {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return true;
  }

  async delete(key) {
    return this.store.delete(key);
  }

  async clear() {
    this.store.clear();
  }
}

export class RedisMemoryAdapter extends BaseMemoryAdapter {
  constructor(redisClient) {
    super();
    this.client = redisClient;
  }

  async get(key) {
    if (!this.client) throw new Error("Cliente Redis não inicializado");
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  async set(key, value, ttlSeconds) {
    if (!this.client) throw new Error("Cliente Redis não inicializado");
    const payload = typeof value === "string" ? value : JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.set(key, payload, { EX: ttlSeconds });
    } else {
      await this.client.set(key, payload);
    }
    return true;
  }

  async delete(key) {
    if (!this.client) throw new Error("Cliente Redis não inicializado");
    await this.client.del(key);
    return true;
  }
}

const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function safeKey(key) {
  if (PROTO_KEYS.has(key)) throw new Error(`Chave de caminho proibida: "${key}"`);
  return key;
}

export class StateReducer {
  reduce(context, requiredKeys = []) {
    if (!context || typeof context !== "object" || Array.isArray(context)) {
      return {};
    }

    if (!requiredKeys.length) {
      return context;
    }

    const reduced = {};
    for (const keyPath of requiredKeys) {
      const value = this.getByPath(context, keyPath);
      if (value !== undefined) {
        this.setByPath(reduced, keyPath, value);
      }
    }

    return reduced;
  }

  getByPath(source, path) {
    return path
      .split(".")
      .reduce((acc, key) => {
        if (acc === null || acc === undefined) return undefined;
        safeKey(key); // throws on __proto__ etc.
        return acc[key];
      }, source);
  }

  setByPath(target, path, value) {
    const parts = path.split(".");
    let current = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = safeKey(parts[i]);
      if (!current[key] || typeof current[key] !== "object") {
        current[key] = {};
      }
      current = current[key];
    }
    const lastKey = safeKey(parts[parts.length - 1]);
    current[lastKey] = value;
  }
}

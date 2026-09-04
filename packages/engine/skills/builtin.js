import { defineSkill } from "./contracts.js";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const BLOCKED_HEADERS = new Set([
  "host",
  "authorization",
  "x-forwarded-for",
  "x-real-ip",
  "x-forwarded-host",
]);

// Blocks RFC-1918, loopback, link-local, and cloud metadata ranges
const PRIVATE_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // AWS/GCP metadata IP
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

function assertSafeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`URL inválida: ${rawUrl}`);
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Protocolo não permitido: ${parsed.protocol}`);
  }
  const { hostname } = parsed;
  for (const pattern of PRIVATE_HOSTNAME_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new Error(`Acesso bloqueado: host privado ou local (${hostname})`);
    }
  }
  return parsed;
}

function sanitizeHeaders(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const safe = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key === "string" && !BLOCKED_HEADERS.has(key.toLowerCase())) {
      safe[key] = String(value);
    }
  }
  return safe;
}

const webSearchSkill = defineSkill({
  name: "web_search",
  description: "Busca web simulada/deterministica para desenvolvimento local",
  parametersSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
  async run(params) {
    const query = String(params?.query || "").trim().slice(0, 500);
    return {
      query,
      results: query
        ? [
            {
              title: `Resultado local para: ${query}`,
              url: "https://example.com",
              snippet: "Stub de busca para fluxo deterministico.",
            },
          ]
        : [],
    };
  },
});

const httpRequestSkill = defineSkill({
  name: "http_request",
  description: "Executa chamada HTTP externa e retorna status/body resumido",
  parametersSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      headers: { type: "object" },
      body: { type: "object" },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async run(params) {
    const rawUrl = String(params?.url || "").trim();
    if (!rawUrl) throw new Error("Parâmetro 'url' é obrigatório em http_request");

    assertSafeUrl(rawUrl); // throws on private/invalid URL

    const method = String(params?.method || "GET").toUpperCase();
    if (!ALLOWED_METHODS.has(method)) {
      throw new Error(`Método HTTP não permitido: ${method}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(rawUrl, {
        method,
        headers: sanitizeHeaders(params?.headers),
        body: params?.body ? JSON.stringify(params.body) : undefined,
        signal: controller.signal,
        redirect: "manual", // prevent redirect to internal hosts
      });

      const text = await response.text();
      return {
        url: rawUrl,
        method,
        status: response.status,
        ok: response.ok,
        bodyPreview: text.slice(0, 500),
      };
    } catch (err) {
      if (err.name === "AbortError") throw new Error("http_request timeout após 10s");
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  },
});

const dbWriteSkill = defineSkill({
  name: "db_write",
  description: "Stub de persistencia externa",
  parametersSchema: {
    type: "object",
    properties: {
      table: { type: "string" },
      record: { type: "object" },
    },
    required: ["table", "record"],
    additionalProperties: false,
  },
  async run(params, context) {
    return {
      persisted: true,
      table: params?.table || "events",
      record: params?.record || {},
      flowId: context?.flowId,
      note: "Substituir por adapter real de banco",
    };
  },
});

import { MACOS_SKILLS } from "./macos.js";

export const BUILTIN_SKILLS = [
  webSearchSkill,
  httpRequestSkill,
  dbWriteSkill,
  ...MACOS_SKILLS,
];

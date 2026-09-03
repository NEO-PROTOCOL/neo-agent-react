import { SkillRequestSignatureVerifier, TimestampVerifier } from "ask-sdk-express-adapter";
import { checksum, safeText } from "./ConversationGateway.js";

export const ALEXA_PATH = "/channels/alexa";
export const isAlexaRoute = (request) => request.routeOptions?.config?.authentication === "alexa-signature";

// ASK SDK 2.14.0 retains URL, CA chain, SAN, validity and RSA verification.
// Only its unbounded certificate download is replaced. Regression-tested on upgrade.
export class BoundedAlexaSignatureVerifier extends SkillRequestSignatureVerifier {
  constructor({ fetchImpl = fetch } = {}) { super(); this.fetchImpl = fetchImpl; }
  async _getCertChainByUrl(url) {
    const response = await this.fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(1500) });
    if (!response.ok || !response.body) throw new Error("CERTIFICATE_UNAVAILABLE");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32768) throw new Error("CERTIFICATE_TOO_LARGE");
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks).toString("utf8");
    } finally { await reader.cancel(); }
  }
  async verify(raw, headers) {
    if (this.certCache.size > 16) this.certCache.clear();
    // SDK's cache otherwise skips checking expiry on later requests.
    for (const [url, cert] of this.certCache) {
      try { this._validateCertChain(cert); } catch { this.certCache.delete(url); }
    }
    return super.verify(raw, headers);
  }
}

export function alexaConfig(env = process.env) {
  const taskIds = [...new Set((env.ALEXA_TASK_IDS || "").split(",").map((id) => id.trim()).filter(Boolean))];
  return { enabled: env.ALEXA_ENABLED === "true", skillId: env.ALEXA_SKILL_ID,
    userId: env.ALEXA_ALLOWED_USER_ID, taskIds,
    configured: /^amzn1\.ask\.skill\.[\w-]+$/.test(env.ALEXA_SKILL_ID || "")
      && Boolean(env.ALEXA_ALLOWED_USER_ID) && taskIds.length > 0 && taskIds.length <= 10
      && taskIds.every((id) => /^[\w-]{1,128}$/.test(id)) };
}

export function alexaResponse(text, { closed = false, silent = false } = {}) {
  if (silent) return { version: "1.0", response: {} };
  return { version: "1.0", response: {
    outputSpeech: { type: "PlainText", text: safeText(text, 1600) }, shouldEndSession: closed,
    ...(!closed ? {
      reprompt: { outputSpeech: { type: "PlainText", text: "Qual informação da tarefa você quer consultar?" } },
      directives: [{ type: "Dialog.ElicitSlot", slotToElicit: "query", updatedIntent: {
        name: "ConversationIntent", confirmationStatus: "NONE",
        slots: { query: { name: "query", confirmationStatus: "NONE" } },
      } }],
    } : {}),
  } };
}

export function normalizeAlexa(envelope, config, raw, now = Date.now()) {
  const request = envelope?.request;
  const system = envelope?.context?.System;
  const session = envelope?.session;
  const timestamp = Date.parse(request?.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 150000) throw new Error("INVALID_TIMESTAMP");
  if (system?.application?.applicationId !== config.skillId
    || session?.application?.applicationId !== config.skillId) throw new Error("INVALID_SKILL");
  if (system?.user?.userId !== config.userId || session?.user?.userId !== config.userId) throw new Error("UNAUTHORIZED_USER");
  if (request.locale !== "pt-BR" || typeof request.requestId !== "string" || request.requestId.length > 256
    || !request.requestId || typeof session.sessionId !== "string" || !session.sessionId || session.sessionId.length > 256) {
    throw new Error("INVALID_ENVELOPE");
  }
  let kind;
  let text = "";
  if (request.type === "LaunchRequest") kind = "LAUNCH";
  else if (request.type === "SessionEndedRequest") kind = "SESSION_ENDED";
  else if (request.type === "IntentRequest") {
    if (["AMAZON.StopIntent", "AMAZON.CancelIntent"].includes(request.intent?.name)) kind = "STOP";
    else if (["AMAZON.HelpIntent", "AMAZON.FallbackIntent"].includes(request.intent?.name)) kind = "HELP";
    else if (request.intent?.name === "ConversationIntent") {
      kind = "QUERY";
      if (request.dialogState === "COMPLETED") throw new Error("UNSUPPORTED_DIALOG_STATE");
      const value = request.intent.slots?.query?.value;
      if (typeof value !== "string" || !value.trim() || value.length > 1200) throw new Error("INVALID_QUERY");
      text = safeText(value);
    }
  }
  if (!kind) throw new Error("UNSUPPORTED_REQUEST");
  // Never trust client-provided sessionAttributes for identity or task routing.
  return { actorHash: checksum(`${config.skillId}:${config.userId}`),
    sessionHash: checksum(session.sessionId), requestId: request.requestId,
    checksum: checksum(raw), timestamp: request.timestamp, kind, text };
}

export async function registerAlexaChannel(app, { config, gateway, store,
  signatureVerifier = new BoundedAlexaSignatureVerifier(), timestampVerifier = new TimestampVerifier(),
  now = () => Date.now() }) {
  await app.register(async (channel) => {
    channel.removeContentTypeParser("application/json");
    channel.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
    channel.post(ALEXA_PATH, { bodyLimit: 32768, config: { authentication: "alexa-signature" } }, async (request, reply) => {
      if (!config.enabled || !config.configured) return reply.code(503).send({ error: "alexa_disabled" });
      let input;
      try {
        if (!Buffer.isBuffer(request.body)) throw new Error("INVALID_BODY");
        const raw = request.body.toString("utf8");
        const headers = request.headers;
        if (typeof headers["signature-256"] !== "string" || typeof headers.signaturecertchainurl !== "string") throw new Error("UNSIGNED_REQUEST");
        await signatureVerifier.verify(raw, headers);
        await timestampVerifier.verify(raw);
        input = normalizeAlexa(JSON.parse(raw), config, raw, now());
      } catch {
        request.log.warn({ event: "alexa_request_rejected", reason: "verification_failed" });
        return reply.code(400).send({ error: "invalid_alexa_request" });
      }
      let timer;
      try {
        input.deadline = Date.now() + 4500;
        const result = await Promise.race([gateway.handle(input), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("CONVERSATION_DEADLINE")), 5000);
        })]);
        request.log.info({ event: "alexa_turn_completed", request_hash: checksum(input.requestId), replayed: result.replayed });
        return result.response;
      } catch (error) {
        const codes = ["CONVERSATION_BUSY", "REQUEST_ID_CONFLICT", "STALE_CONVERSATION_REQUEST", "CONVERSATION_RATE_LIMIT"];
        const reason = codes.includes(error.code) ? error.code : "conversation_unavailable";
        request.log.warn({ event: "alexa_turn_unavailable", reason, request_hash: checksum(input.requestId) });
        return reply.code(reason === "CONVERSATION_RATE_LIMIT" ? 429 : 503).send({ error: "conversation_unavailable" });
      } finally { clearTimeout(timer); }
    });
  });
  return { async health() {
    if (!config.enabled) return "disabled";
    if (!config.configured) return "unavailable";
    try { await store.isReady(); return "ok"; } catch { return "unavailable"; }
  } };
}

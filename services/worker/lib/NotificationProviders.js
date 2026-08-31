import { createHmac } from "node:crypto";

function safeText(value, max = 900) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

class InternalHttpProvider {
  constructor({ id, baseUrl, secret, nexusSecret, fetchImpl = globalThis.fetch, timeoutMs = 10_000 }) {
    this.id = id;
    this.baseUrl = baseUrl?.replace(/\/$/, "");
    this.secret = secret;
    this.nexusSecret = nexusSecret;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  isEnabled() {
    return Boolean(this.baseUrl && (this.secret || this.nexusSecret) && this.fetchImpl);
  }

  async post(payload) {
    if (!this.isEnabled()) return { status: "disabled" };
    const rawBody = JSON.stringify(payload);
    const headers = { "content-type": "application/json" };
    if (this.nexusSecret) {
      headers["x-nexus-signature"] = `sha256=${createHmac("sha256", this.nexusSecret)
        .update(rawBody)
        .digest("hex")}`;
    } else {
      headers.authorization = `Bearer ${this.secret}`;
    }
    const response = await this.fetchImpl(`${this.baseUrl}/send`, {
      method: "POST",
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`${this.id} provider returned HTTP ${response.status}`);
    return response.json();
  }
}

export class ResendProvider extends InternalHttpProvider {
  constructor(options = {}) {
    super({
      id: "resend",
      baseUrl: options.baseUrl ?? process.env.RESEND_PROVIDER_URL,
      secret: options.secret ?? process.env.PROVIDER_SECRET,
      nexusSecret: options.nexusSecret ?? process.env.NEXUS_SECRET,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
    this.recipient = options.recipient ?? process.env.AGENT_EMAIL_TO;
    this.senderEmail = options.senderEmail ?? process.env.AGENT_EMAIL_FROM;
    this.senderName = options.senderName ?? process.env.AGENT_EMAIL_SENDER_NAME ?? "NΞØ Agent";
  }

  isEnabled() {
    return Boolean(this.recipient && this.senderEmail && super.isEnabled());
  }

  async send(notification) {
    if (!this.isEnabled()) return { status: "disabled" };
    return this.post({
      event_id: notification.dedupe_key,
      user_id: "neo-operator",
      domain_id: "neo-protocol",
      org_id: "NEO-PROTOCOL",
      project_id: "neo-protocol",
      email: this.recipient,
      template_id: "agent-report",
      template_version: "1.0",
      sender_email: this.senderEmail,
      sender_name: this.senderName,
      extra_payload: notification.payload,
    });
  }
}

export class TelegramProvider extends InternalHttpProvider {
  constructor(options = {}) {
    super({
      id: "telegram",
      baseUrl: options.baseUrl ?? process.env.TELEGRAM_PROVIDER_URL,
      secret: options.secret ?? process.env.PROVIDER_SECRET,
      nexusSecret: options.nexusSecret ?? process.env.NEXUS_SECRET,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
    this.chatId = options.chatId ?? process.env.AGENT_TELEGRAM_CHAT_ID;
  }

  isEnabled() {
    return Boolean(this.chatId && super.isEnabled());
  }

  async send(notification) {
    if (!this.isEnabled()) return { status: "disabled" };
    return this.post({
      event_id: notification.dedupe_key,
      user_id: "neo-operator",
      domain_id: "neo-protocol",
      org_id: "NEO-PROTOCOL",
      project_id: "neo-protocol",
      chat_id: this.chatId,
      template_id: "agent-alert",
      extra_payload: notification.payload,
    });
  }
}

export class IFTTTProvider {
  constructor({
    enabled = process.env.IFTTT_ENABLED === "true",
    webhookKey = process.env.IFTTT_WEBHOOK_KEY,
    eventName = process.env.IFTTT_EVENT_NAME,
    fetchImpl = globalThis.fetch,
    timeoutMs = 8_000,
  } = {}) {
    this.id = "ifttt";
    this.enabled = enabled;
    this.webhookKey = webhookKey;
    this.eventName = eventName;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  isEnabled() {
    return Boolean(
      this.enabled &&
        this.webhookKey &&
        this.eventName &&
        /^[A-Za-z0-9_]+$/.test(this.eventName) &&
        this.fetchImpl
    );
  }

  async send(notification) {
    if (!this.isEnabled()) return { status: "disabled" };
    const event = encodeURIComponent(this.eventName);
    const key = encodeURIComponent(this.webhookKey);
    const response = await this.fetchImpl(
      `https://maker.ifttt.com/trigger/${event}/with/key/${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          value1: safeText(notification.payload.title),
          value2: safeText(notification.payload.summary),
          value3: safeText(notification.payload.task_id || notification.kind),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      }
    );
    if (!response.ok) throw new Error(`ifttt provider returned HTTP ${response.status}`);
    return { status: "sent", event_name: this.eventName };
  }
}

export class NotificationProviderRegistry {
  constructor(providers = []) {
    this.providers = new Map(providers.map((provider) => [provider.id || provider.constructor.name, provider]));
  }

  get(channel) {
    const provider = this.providers.get(channel);
    if (!provider) throw new Error(`Notification provider not registered: ${channel}`);
    return provider;
  }
}

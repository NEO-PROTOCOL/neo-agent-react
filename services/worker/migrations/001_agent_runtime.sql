CREATE SCHEMA IF NOT EXISTS agent_runtime;

CREATE TABLE IF NOT EXISTS agent_runtime.tasks (
  task_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'notion')),
  source_ref TEXT NOT NULL,
  source_revision TEXT,
  source_checksum CHAR(64) NOT NULL,
  intent JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  attempt SMALLINT NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tasks_source_revision_unique
  ON agent_runtime.tasks (
    source_type,
    source_ref,
    COALESCE(source_revision, source_checksum)
  );

CREATE INDEX IF NOT EXISTS tasks_status_updated_idx
  ON agent_runtime.tasks (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_runtime.task_events (
  sequence BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES agent_runtime.tasks(task_id) ON DELETE RESTRICT,
  record_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  previous_hash CHAR(64) NOT NULL,
  event_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, record_key, payload_sha256)
);

CREATE INDEX IF NOT EXISTS task_events_context_idx
  ON agent_runtime.task_events (task_id, record_key, sequence DESC);

CREATE OR REPLACE FUNCTION agent_runtime.reject_task_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'agent_runtime.task_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS task_events_append_only ON agent_runtime.task_events;
CREATE TRIGGER task_events_append_only
  BEFORE UPDATE OR DELETE ON agent_runtime.task_events
  FOR EACH ROW EXECUTE FUNCTION agent_runtime.reject_task_event_mutation();

CREATE TABLE IF NOT EXISTS agent_runtime.approvals (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES agent_runtime.tasks(task_id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'NEEDS_HUMAN', 'REJECTED')),
  decided_by TEXT NOT NULL,
  authority_rule TEXT NOT NULL,
  review_ref TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_runtime.notification_outbox (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT REFERENCES agent_runtime.tasks(task_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('resend', 'telegram', 'ifttt')),
  dedupe_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SENDING', 'RETRY', 'SENT', 'SKIPPED', 'DEAD')),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_ref TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dedupe_key, channel)
);

CREATE INDEX IF NOT EXISTS notification_outbox_dispatch_idx
  ON agent_runtime.notification_outbox (status, available_at, id);

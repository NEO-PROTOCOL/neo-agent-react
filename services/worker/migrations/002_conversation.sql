BEGIN;

-- Separate from the immutable task ledger. No migration of existing tasks.
CREATE TABLE IF NOT EXISTS agent_runtime.conversation_sessions (
  conversation_id TEXT PRIMARY KEY,
  actor_hash CHAR(64) NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel = 'alexa'),
  channel_session_hash CHAR(64) NOT NULL,
  context JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runtime.conversation_turns (
  sequence BIGSERIAL PRIMARY KEY,
  turn_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL REFERENCES agent_runtime.conversation_sessions(conversation_id),
  request_id TEXT NOT NULL,
  request_checksum CHAR(64) NOT NULL,
  channel_session_hash CHAR(64) NOT NULL,
  request_timestamp TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL,
  input_text TEXT NOT NULL,
  response JSONB NOT NULL,
  evidence JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (conversation_id, request_id)
);

CREATE INDEX IF NOT EXISTS conversation_turns_recent_idx
  ON agent_runtime.conversation_turns (conversation_id, sequence DESC);
CREATE INDEX IF NOT EXISTS conversation_turns_expiration_idx
  ON agent_runtime.conversation_turns (expires_at);

-- References only. This read-only cut never promotes turns to durable memory.
CREATE TABLE IF NOT EXISTS agent_runtime.durable_memory_refs (
  id TEXT PRIMARY KEY,
  actor_hash CHAR(64) NOT NULL,
  memory_ref TEXT NOT NULL,
  source_turn_id TEXT NOT NULL,
  consent_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (actor_hash, memory_ref)
);

COMMIT;

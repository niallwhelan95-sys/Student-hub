-- Margin initial schema. Works on PGlite (local) and hosted Postgres with pgvector.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE student_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  university text,
  programme text,
  year_of_study text,
  semester text,
  learning_prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  assistance_level text NOT NULL DEFAULT 'collaborative',
  accessibility_notes text,
  onboarding jsonb NOT NULL DEFAULT '{"completedSteps":[],"skippedSteps":[]}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code text,
  name text NOT NULL,
  description text,
  coordinator text,
  lecturers jsonb NOT NULL DEFAULT '[]'::jsonb,
  color text NOT NULL DEFAULT 'teal',
  archived boolean NOT NULL DEFAULT false,
  profile_summary text,
  profile_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX modules_user_idx ON modules(user_id);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  module_id uuid REFERENCES modules(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'general',
  pinned boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  working_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ts tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, ''))) STORED
);
CREATE INDEX conversations_user_idx ON conversations(user_id, updated_at DESC);
CREATE INDEX conversations_ts_idx ON conversations USING gin(ts);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'complete',
  error text,
  model text,
  usage jsonb,
  input_mode text NOT NULL DEFAULT 'text',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  ts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at);
CREATE INDEX messages_ts_idx ON messages USING gin(ts);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id uuid REFERENCES modules(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  kind text NOT NULL DEFAULT 'unknown',
  status text NOT NULL DEFAULT 'queued',
  status_detail text,
  page_count integer,
  summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicate_of uuid REFERENCES documents(id) ON DELETE SET NULL,
  is_own_writing boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX documents_user_idx ON documents(user_id, created_at DESC);
CREATE INDEX documents_module_idx ON documents(module_id);
CREATE INDEX documents_sha_idx ON documents(user_id, sha256);

CREATE TABLE document_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id uuid,
  ordinal integer NOT NULL,
  location_label text,
  page_start integer,
  page_end integer,
  heading text,
  content text NOT NULL,
  token_estimate integer NOT NULL DEFAULT 0,
  embedding vector,
  embedding_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  ts tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(heading, '') || ' ' || content)) STORED
);
CREATE INDEX document_sections_doc_idx ON document_sections(document_id, ordinal);
CREATE INDEX document_sections_user_idx ON document_sections(user_id, module_id);
CREATE INDEX document_sections_ts_idx ON document_sections USING gin(ts);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_after timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_pending_idx ON jobs(status, run_after);

CREATE TABLE memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL,
  module_id uuid REFERENCES modules(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  source_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  origin text NOT NULL DEFAULT 'extracted',
  confidence real NOT NULL DEFAULT 0.8,
  stability text NOT NULL DEFAULT 'stable',
  expires_at timestamptz,
  pinned boolean NOT NULL DEFAULT false,
  superseded_by uuid REFERENCES memories(id) ON DELETE SET NULL,
  embedding vector,
  embedding_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX memories_user_idx ON memories(user_id, status, category);
CREATE INDEX memories_ts_idx ON memories USING gin(ts);

CREATE TABLE deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id uuid REFERENCES modules(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  kind text NOT NULL DEFAULT 'assignment',
  status text NOT NULL DEFAULT 'confirmed',
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  source_excerpt text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deadlines_user_idx ON deadlines(user_id, due_at);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id uuid REFERENCES modules(id) ON DELETE SET NULL,
  title text NOT NULL,
  details text,
  done_when text,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'todo',
  priority text NOT NULL DEFAULT 'essential',
  estimate_minutes integer,
  source_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX tasks_user_idx ON tasks(user_id, status);

CREATE TABLE writing_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  title text NOT NULL,
  context text NOT NULL DEFAULT 'general',
  origin text NOT NULL DEFAULT 'paste',
  is_spoken boolean NOT NULL DEFAULT false,
  raw_text text NOT NULL,
  clean_text text NOT NULL,
  exclusion_notes text,
  word_count integer NOT NULL DEFAULT 0,
  stats jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX writing_samples_user_idx ON writing_samples(user_id, context);

CREATE TABLE writing_passages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id uuid NOT NULL REFERENCES writing_samples(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context text NOT NULL,
  content text NOT NULL,
  embedding vector,
  embedding_model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX writing_passages_user_idx ON writing_passages(user_id, context);

CREATE TABLE writing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context text NOT NULL DEFAULT 'general',
  profile jsonb,
  stats jsonb,
  sample_count integer NOT NULL DEFAULT 0,
  word_count integer NOT NULL DEFAULT 0,
  confidence text NOT NULL DEFAULT 'low',
  user_notes text,
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, context)
);

CREATE TABLE ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_user_idx ON ai_usage(user_id, created_at);

-- Test-only contract for the Supabase objects used by application migrations.
-- Notifications are recorded so tests can inspect payloads and transaction
-- behavior. This does not emulate WebSocket delivery or Supabase's service.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

CREATE SCHEMA IF NOT EXISTS realtime;
CREATE TABLE IF NOT EXISTS realtime.messages (
  extension text NOT NULL DEFAULT 'broadcast',
  topic text NOT NULL,
  event text NOT NULL,
  payload jsonb NOT NULL,
  private boolean NOT NULL DEFAULT true
);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA auth, realtime TO authenticated;
GRANT SELECT, INSERT ON realtime.messages TO authenticated;

CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('realtime.topic', true), '');
$$;

CREATE OR REPLACE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO realtime.messages (payload, event, topic, private)
  VALUES (payload, event, topic, private);
$$;
REVOKE ALL ON FUNCTION realtime.send(jsonb, text, text, boolean) FROM PUBLIC;

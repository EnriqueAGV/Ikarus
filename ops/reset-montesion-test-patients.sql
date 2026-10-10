-- Permanently reset ONLY disposable patient data in the authorized test clinic.
-- Before running: stop test messages, let active agent replies finish, and
-- cancel pending Inngest runs for this clinic's old clients/appointments.
-- Keep a database backup. No uploaded files were present in the preview.
-- This transaction preserves clinic configuration and all record guards.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- Briefly prevent writes during the checks and deletion; concurrent writes
-- resume after commit. These locks also cover dependent-table inserts.
LOCK TABLE public.clients, public.messages, public.appointments,
  public.consents, public.access_log, public.clinical_notes,
  public.note_addenda, public.prescriptions, public.attachments,
  public.staff_reply_attempts IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  clinic CONSTANT uuid := 'b00a967b-6943-4f01-8c61-f2441a12a1ed';
  entry record;
  actual bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = clinic AND name = 'Clinica MonteSion') THEN
    RAISE EXCEPTION 'Expected test clinic not found; nothing deleted';
  END IF;

  -- Require the exact inventory reviewed by the user. If anything changed,
  -- rerun the preview and review it before updating these expected counts.
  FOR entry IN SELECT * FROM (VALUES
    ('clients', 2), ('messages', 42), ('appointments', 2), ('consents', 2),
    ('access_log', 15), ('clinical_notes', 1), ('note_addenda', 0),
    ('prescriptions', 0), ('attachments', 0), ('staff_reply_attempts', 0)
  ) AS inventory(table_name, expected)
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE business_id = $1', entry.table_name)
      INTO actual USING clinic;
    IF actual <> entry.expected THEN
      RAISE EXCEPTION 'Inventory changed in %: expected %, found %. Nothing deleted.', entry.table_name, entry.expected, actual;
    END IF;
    -- No cross-clinic dependent rows may be affected, even by FK cascades.
    IF entry.table_name NOT IN ('clients', 'note_addenda') THEN
      EXECUTE format('SELECT count(*) FROM public.%I r JOIN public.clients c ON c.id = r.client_id WHERE r.business_id <> c.business_id AND (r.business_id = $1 OR c.business_id = $1)', entry.table_name)
        INTO actual USING clinic;
      IF actual <> 0 THEN RAISE EXCEPTION 'Cross-clinic references in %; nothing deleted', entry.table_name; END IF;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.clinical_notes WHERE business_id = clinic AND status = 'signed') THEN
    RAISE EXCEPTION 'Signed note found; nothing deleted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.clients d JOIN public.clients t ON t.id = d.holder_id OR t.id = d.merged_into_id
    WHERE d.business_id <> t.business_id AND clinic IN (d.business_id, t.business_id)
  ) THEN RAISE EXCEPTION 'Cross-clinic household or merge link; nothing deleted'; END IF;
END;
$$;

-- Delete order respects all FK constraints. Signed notes remain protected.
DELETE FROM public.clinical_notes WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed';
DELETE FROM public.consents WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed';
DELETE FROM public.staff_reply_attempts WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed';
DELETE FROM public.messages WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed';
DELETE FROM public.access_log WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed';
DELETE FROM public.appointments WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed';
UPDATE public.clients SET holder_id = NULL, merged_into_id = NULL
WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed';
DELETE FROM public.clients WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed';

SELECT
  (SELECT count(*) FROM public.clients WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed') AS remaining_patients,
  (SELECT count(*) FROM public.messages WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed') AS remaining_messages,
  (SELECT count(*) FROM public.appointments WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed') AS remaining_appointments,
  (SELECT count(*) FROM public.businesses WHERE id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed') AS clinic_preserved;
COMMIT;

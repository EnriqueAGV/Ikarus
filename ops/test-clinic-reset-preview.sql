-- Read-only inventory for the explicitly authorized disposable test clinic.
-- Run against production in the Supabase SQL editor before any reset.
-- This file deletes nothing and does not disable any record protections.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH counts AS (
SELECT 'clients' AS table_name, count(*) AS rows FROM public.clients WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed'::uuid
UNION ALL SELECT 'messages', count(*) FROM public.messages WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed'::uuid
UNION ALL SELECT 'appointments', count(*) FROM public.appointments WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed'::uuid
UNION ALL SELECT 'consents', count(*) FROM public.consents WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed'::uuid
UNION ALL SELECT 'access_log', count(*) FROM public.access_log WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed'::uuid
UNION ALL SELECT 'clinical_notes', count(*) FROM public.clinical_notes WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed'::uuid
UNION ALL SELECT 'signed_clinical_notes', count(*) FROM public.clinical_notes WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed'::uuid AND status = 'signed'
UNION ALL SELECT 'note_addenda', count(*) FROM public.note_addenda WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed'::uuid
UNION ALL SELECT 'prescriptions', count(*) FROM public.prescriptions WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed'::uuid
UNION ALL SELECT 'attachments', count(*) FROM public.attachments WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed'::uuid
UNION ALL SELECT 'staff_reply_attempts', count(*) FROM public.staff_reply_attempts WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed'::uuid
), links AS (
SELECT count(*) AS cross_clinic_links
FROM public.clients AS dependent JOIN public.clients AS target
ON target.id = dependent.holder_id OR target.id = dependent.merged_into_id
WHERE dependent.business_id <> target.business_id
AND 'b00a967b-6943-4f01-8c61-f2441a12a1ed'::uuid IN (dependent.business_id, target.business_id)
)

-- Capture this manifest before removing attachment rows. Files live in the
-- private Supabase bucket "records" and require separate Storage API removal.
-- One result set: SQL editors often only display the final SELECT.
SELECT 'clinic_found' AS item, count(*)::text AS value FROM public.businesses
WHERE id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed'::uuid
UNION ALL SELECT 'clinic_name', name FROM public.businesses
WHERE id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed'::uuid
UNION ALL SELECT table_name, rows::text FROM counts
UNION ALL SELECT 'cross_clinic_links', cross_clinic_links::text FROM links
UNION ALL SELECT 'storage_manifest', coalesce(jsonb_agg(jsonb_build_object('id', id, 'storage_path', storage_path)), '[]'::jsonb)::text
FROM public.attachments
WHERE business_id = 'b00a967b-6943-4f01-8c61-f2441a12a1ed'::uuid;

ROLLBACK;

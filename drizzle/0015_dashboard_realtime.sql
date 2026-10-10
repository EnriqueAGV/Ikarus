-- Only change notifications travel over Realtime. Patient records remain
-- inaccessible through the Data API (the existing table RLS stays closed).
CREATE FUNCTION public.can_receive_dashboard_changes(topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE topic = 'dashboard:' || b.id::text
      AND (
        EXISTS (SELECT 1 FROM public.business_members m
                WHERE m.business_id = b.id AND m.user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.profiles p
                   WHERE p.id = auth.uid() AND p.is_super_admin)
      )
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.can_receive_dashboard_changes(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.can_receive_dashboard_changes(text) TO authenticated;
--> statement-breakpoint
CREATE POLICY dashboard_changes_read ON realtime.messages
FOR SELECT TO authenticated
USING (
  extension = 'broadcast'
  AND public.can_receive_dashboard_changes((SELECT realtime.topic()))
);
--> statement-breakpoint
CREATE FUNCTION public.notify_dashboard_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  clinic_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    clinic_id := OLD.business_id;
  ELSE
    clinic_id := NEW.business_id;
  END IF;
  PERFORM realtime.send('{}'::jsonb, 'changed', 'dashboard:' || clinic_id::text, true);
  -- Also invalidate the original clinic if a row ever changes ownership.
  IF TG_OP = 'UPDATE' AND OLD.business_id IS DISTINCT FROM NEW.business_id THEN
    PERFORM realtime.send('{}'::jsonb, 'changed', 'dashboard:' || OLD.business_id::text, true);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notify_dashboard_change() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER clients_dashboard_change
AFTER INSERT OR UPDATE OR DELETE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.notify_dashboard_change();
--> statement-breakpoint
CREATE TRIGGER appointments_dashboard_change
AFTER INSERT OR UPDATE OR DELETE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.notify_dashboard_change();
--> statement-breakpoint
CREATE TRIGGER time_blocks_dashboard_change
AFTER INSERT OR UPDATE OR DELETE ON public.time_blocks
FOR EACH ROW EXECUTE FUNCTION public.notify_dashboard_change();
--> statement-breakpoint
CREATE TRIGGER messages_dashboard_change
AFTER INSERT OR UPDATE OR DELETE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.notify_dashboard_change();

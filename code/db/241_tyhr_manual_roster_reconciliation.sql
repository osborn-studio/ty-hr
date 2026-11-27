-- Explicit HR reconciliation freezes the current employee-month roster semantics.
-- An inherited stale report without this new evidence cannot become current.
CREATE OR REPLACE FUNCTION fn_ty_time_report_roster_current(report_key bigint,employment_key bigint DEFAULT NULL)RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE origin public.ty_time_report_version%ROWTYPE;r public.ty_time_report_version%ROWTYPE;seen bigint[];e record;keys bigint[];capture jsonb;BEGIN
 SELECT*INTO origin FROM public.ty_time_report_version WHERE id=report_key;IF NOT FOUND THEN RETURN false;END IF;
 SELECT array_agg(DISTINCT l.person_id ORDER BY l.person_id)INTO keys FROM public.ty_time_report_line l WHERE l.report_id=report_key AND(employment_key IS NULL OR l.employment_id=employment_key);
 IF keys IS NULL THEN RETURN false;END IF;PERFORM public.fn_ty_leave_roster_lock_people(keys);
 FOR e IN SELECT DISTINCT employment_id FROM public.ty_time_report_line WHERE report_id=report_key AND(employment_key IS NULL OR employment_id=employment_key)LOOP
  r:=origin;seen:='{}';
  LOOP
   IF r.id=ANY(seen)OR array_length(seen,1)>100 OR r.group_id<>origin.group_id OR r.period<>origin.period THEN RETURN false;END IF;seen:=array_append(seen,r.id);
   SELECT s.manual_basis->'roster_snapshot'INTO capture FROM public.ty_time_leave_report_source s WHERE s.report_id=r.id AND s.employment_id=e.employment_id AND s.mode='manual'AND s.manual_basis->>'kind'='reviewed_reconciliation'AND length(btrim(s.manual_basis->>'reason'))>=4 AND length(btrim(s.manual_basis->>'evidence_ref'))>=4;
   IF capture IS NOT NULL THEN
    IF capture->>'version'IS DISTINCT FROM'240'OR capture->>'employment_id'IS DISTINCT FROM e.employment_id::text OR capture->>'period'IS DISTINCT FROM origin.period::text OR jsonb_typeof(capture->'days')IS DISTINCT FROM'array'OR capture->'days'IS DISTINCT FROM public.fn_ty_time_roster_semantics(e.employment_id,origin.period,NULL,NULL,true)THEN RETURN false;END IF;
    EXIT;
   END IF;
   IF r.source_report_id IS NOT NULL THEN
    SELECT*INTO r FROM public.ty_time_report_version WHERE id=r.source_report_id;IF NOT FOUND THEN RETURN false;END IF;
   ELSE
    IF r.source_plan_id IS NOT NULL OR r.source_period_id IS NOT NULL THEN
     IF public.fn_ty_time_roster_semantics(e.employment_id,r.period,r.source_plan_id,r.source_period_id,false)IS DISTINCT FROM public.fn_ty_time_roster_semantics(e.employment_id,r.period,NULL,NULL,true)THEN RETURN false;END IF;
    END IF;EXIT;
   END IF;
  END LOOP;
 END LOOP;RETURN true;
END;$$;

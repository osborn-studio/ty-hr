-- Published schedule changes invalidate only the affected employee-month for new adoption.
-- Historical confirmed wages and payments are not reevaluated by reads.
CREATE FUNCTION fn_ty_time_roster_semantics(eid bigint,month_key date,source_plan bigint DEFAULT NULL,source_period bigint DEFAULT NULL,use_live boolean DEFAULT false)RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE d date;kind text;plan_key bigint;period_key bigint;day_key bigint;n integer;segments jsonb;result jsonb:='[]';BEGIN
 FOR d IN SELECT x::date FROM generate_series(date_trunc('month',month_key)::timestamp,(date_trunc('month',month_key)+interval'1 month'-interval'1 day')::timestamp,interval'1 day')x LOOP
  kind:='unscheduled';plan_key:=source_plan;period_key:=source_period;day_key:=NULL;segments:='[]';
  IF use_live THEN
   SELECT count(*)INTO n FROM public.ty_time_plan_day x JOIN public.ty_time_plan_version p ON p.id=x.plan_id WHERE x.employment_id=eid AND x.work_date=d AND p.status='published';
   IF n>1 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='同一雇佣日期有多个正式排班，请先核定唯一来源';END IF;
   SELECT x.plan_id INTO plan_key FROM public.ty_time_plan_day x JOIN public.ty_time_plan_version p ON p.id=x.plan_id WHERE x.employment_id=eid AND x.work_date=d AND p.status='published';
   IF plan_key IS NULL THEN
    SELECT count(*)INTO n FROM public.ty_roster_day x JOIN public.ty_roster_period p ON p.id=x.period_id WHERE x.employment_id=eid AND x.work_date=d AND p.status IN('published','closed');
    IF n>1 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='同一雇佣日期有多个旧排班基线，请先核定唯一来源';END IF;
    SELECT x.period_id INTO period_key FROM public.ty_roster_day x JOIN public.ty_roster_period p ON p.id=x.period_id WHERE x.employment_id=eid AND x.work_date=d AND p.status IN('published','closed');
   END IF;
  END IF;
  IF plan_key IS NOT NULL THEN
   SELECT x.id,x.day_kind INTO day_key,kind FROM public.ty_time_plan_day x WHERE x.plan_id=plan_key AND x.employment_id=eid AND x.work_date=d;
   IF day_key IS NULL THEN kind:='unscheduled';END IF;
   SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]')INTO segments FROM(SELECT jsonb_build_object('start',s.start_at,'end',s.end_at,'work_company_id',s.work_company_id,'department_id',s.department_id,'work_area_id',s.work_area_id,'overtime',s.overtime,'leave_kind',s.leave_kind,'breaks',(SELECT coalesce(jsonb_agg(jsonb_build_object('start',(b->>'start_at')::timestamptz,'end',(b->>'end_at')::timestamptz)ORDER BY(b->>'start_at')::timestamptz,(b->>'end_at')::timestamptz),'[]')FROM jsonb_array_elements(s.breaks)b))v FROM public.ty_time_plan_segment s WHERE s.plan_id=plan_key AND s.employment_id=eid AND s.work_date=d AND s.state='active')z;
  ELSIF period_key IS NOT NULL THEN
   SELECT x.id,x.day_kind INTO day_key,kind FROM public.ty_roster_day x WHERE x.period_id=period_key AND x.employment_id=eid AND x.work_date=d;
   IF day_key IS NULL THEN kind:='unscheduled';END IF;
   SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]')INTO segments FROM(SELECT jsonb_build_object('start',s.start_at AT TIME ZONE'Asia/Shanghai','end',s.end_at AT TIME ZONE'Asia/Shanghai','work_company_id',s.work_company_id,'department_id',s.department_id,'work_area_id',s.work_area_id,'overtime',s.overtime,'leave_kind',s.leave_kind,'breaks','[]'::jsonb)v FROM public.ty_roster_segment s WHERE s.day_id=day_key)z;
  END IF;
  result:=result||jsonb_build_array(jsonb_build_object('work_date',d::text,'day_kind',coalesce(kind,'unscheduled'),'segments',segments));
 END LOOP;RETURN result;
END;$$;
CREATE FUNCTION fn_ty_time_report_roster_current(report_key bigint,employment_key bigint DEFAULT NULL)RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE r public.ty_time_report_version%ROWTYPE;seen bigint[]:='{}';e record;keys bigint[];BEGIN
 SELECT*INTO r FROM public.ty_time_report_version WHERE id=report_key;IF NOT FOUND THEN RETURN false;END IF;
 WHILE r.source_report_id IS NOT NULL LOOP
  IF r.id=ANY(seen)OR array_length(seen,1)>100 THEN RETURN false;END IF;seen:=array_append(seen,r.id);
  SELECT*INTO r FROM public.ty_time_report_version WHERE id=r.source_report_id;IF NOT FOUND THEN RETURN false;END IF;
 END LOOP;
 IF r.source_plan_id IS NULL AND r.source_period_id IS NULL THEN RETURN true;END IF;
 SELECT array_agg(DISTINCT l.person_id ORDER BY l.person_id)INTO keys FROM public.ty_time_report_line l WHERE l.report_id=report_key AND(employment_key IS NULL OR l.employment_id=employment_key);
 IF keys IS NULL THEN RETURN false;END IF;PERFORM public.fn_ty_leave_roster_lock_people(keys);
 FOR e IN SELECT DISTINCT employment_id FROM public.ty_time_report_line WHERE report_id=report_key AND(employment_key IS NULL OR employment_id=employment_key)LOOP
  IF public.fn_ty_time_roster_semantics(e.employment_id,r.period,r.source_plan_id,r.source_period_id,false)IS DISTINCT FROM public.fn_ty_time_roster_semantics(e.employment_id,r.period,NULL,NULL,true)THEN RETURN false;END IF;
 END LOOP;RETURN true;
END;$$;
CREATE OR REPLACE FUNCTION fn_ty_time_leave_current(report_key bigint,employment_key bigint DEFAULT NULL)RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE s record;line_row record;request jsonb;expected jsonb;actual jsonb;BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ty_time_report_line WHERE report_id=report_key AND(employment_key IS NULL OR employment_id=employment_key))THEN RETURN false;END IF;
 FOR s IN SELECT*FROM public.ty_time_leave_report_source WHERE report_id=report_key AND(employment_key IS NULL OR employment_id=employment_key)LOOP
  IF s.manifest IS DISTINCT FROM public.fn_ty_time_leave_manifest(s.employment_id,s.period)OR s.geometry IS DISTINCT FROM public.fn_ty_time_leave_geometry(s.report_id,s.employment_id)THEN RETURN false;END IF;
  IF s.mode='manual'AND s.manual_basis->>'kind'='excel_import'AND NOT EXISTS(SELECT 1 FROM public.ty_time_import_batch b WHERE b.id=(s.manual_basis->>'import_batch_id')::bigint AND b.status='applied'AND b.result_report_id=s.report_id)THEN RETURN false;END IF;
  FOR line_row IN SELECT id,paid_leave_minutes,unpaid_leave_minutes FROM public.ty_time_report_line WHERE report_id=s.report_id AND employment_id=s.employment_id LOOP
   FOR request IN SELECT value FROM jsonb_array_elements(s.manifest->'requests')LOOP
    expected:=public.fn_ty_time_leave_expected(line_row.id,(request->>'id')::bigint);IF s.mode='manual'AND expected IS NOT NULL AND line_row.paid_leave_minutes=0 AND line_row.unpaid_leave_minutes=0 THEN RETURN false;END IF;
    SELECT jsonb_build_object('request_id',x.request_id,'fact_id',x.fact_id,'classification',x.classification,'minutes',x.minutes,'baseline_overlap',x.baseline_overlap,'intervals',x.intervals,'components',x.components,'basis',x.basis)INTO actual FROM public.ty_time_leave_report_line x WHERE x.line_id=line_row.id AND x.request_id=(request->>'id')::bigint;
    IF actual IS DISTINCT FROM expected THEN RETURN false;END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.ty_time_report_line l WHERE l.report_id=report_key AND(employment_key IS NULL OR l.employment_id=employment_key)AND NOT EXISTS(SELECT 1 FROM public.ty_time_leave_report_source captured WHERE captured.report_id=l.report_id AND captured.employment_id=l.employment_id))THEN RETURN false;END IF;
 RETURN public.fn_ty_time_report_roster_current(report_key,employment_key);
END;$$;

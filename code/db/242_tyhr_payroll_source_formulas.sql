-- Exact function parity and approved cross-module formula authority. Existing roots and source guards are retained.
CREATE FUNCTION fn_ty_formula_isqrt(v numeric)RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=''AS $$DECLARE x numeric:=trunc(v);y numeric;BEGIN IF v<0 OR v<>trunc(v)THEN RAISE EXCEPTION 'Invalid integer square root';END IF;IF x<2 THEN RETURN x;END IF;y:=div(x+1,2);WHILE y<x LOOP x:=y;y:=div(x+div(v,x),2);END LOOP;RETURN x;END;$$;
CREATE OR REPLACE FUNCTION fn_ty_payroll_ast_meta(p_ast jsonb,p_depth integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE typ text:=jsonb_typeof(p_ast); op text; a jsonb; child jsonb;
 vars jsonb:='[]'; count_nodes integer:=1; argc integer; lo integer; hi integer;
BEGIN
 IF p_depth>30 OR p_ast IS NULL OR typ NOT IN ('number','string','boolean','object') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='薪酬公式节点无效或过深';
 END IF;
 IF typ IN ('number','string','boolean') THEN RETURN jsonb_build_object('vars',vars,'count',count_nodes);END IF;
 IF p_ast?'var' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_ast))<>1 OR jsonb_typeof(p_ast->'var') IS DISTINCT FROM 'string' OR p_ast->>'var' !~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='薪酬公式变量名无效';
  END IF;
  RETURN jsonb_build_object('vars',jsonb_build_array(p_ast->>'var'),'count',1);
 END IF;
 op:=p_ast->>'op';
 IF (SELECT count(*) FROM jsonb_object_keys(p_ast))<>2 OR NOT(p_ast?'args') OR jsonb_typeof(p_ast->'args')<>'array' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='薪酬公式结构无效';
 END IF;
 CASE op
  WHEN 'add','multiply','and','or' THEN lo:=2;hi:=20;
  WHEN 'min','max','greatest','least','coalesce' THEN lo:=1;hi:=20;
  WHEN 'subtract','divide','eq','ne','lt','lte','gt','gte','mod','power' THEN lo:=2;hi:=2;
  WHEN 'ceil','floor','abs','sqrt','max0','min0','not' THEN lo:=1;hi:=1;
  WHEN 'prorata' THEN lo:=3;hi:=3;
  WHEN 'if' THEN lo:=3;hi:=3;
  WHEN 'round' THEN lo:=1;hi:=2;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='薪酬公式使用了不支持的操作';
 END CASE;
 argc:=jsonb_array_length(p_ast->'args');
 IF argc<lo OR argc>hi THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='薪酬公式参数数量错误';END IF;
 FOR a IN SELECT * FROM jsonb_array_elements(p_ast->'args') LOOP
  child:=public.fn_ty_payroll_ast_meta(a,p_depth+1);
  vars:=vars||(child->'vars');count_nodes:=count_nodes+(child->>'count')::integer;
  IF count_nodes>300 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='薪酬公式节点数量超限';END IF;
 END LOOP;
 RETURN jsonb_build_object('vars',vars,'count',count_nodes);
END $$;
CREATE OR REPLACE FUNCTION fn_ty_payroll_eval_node(p_ast jsonb,p_context jsonb,p_depth integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE op text; args jsonb; child jsonb; other jsonb; values_json jsonb:='[]';
 used jsonb:='[]'; a jsonb; value jsonb; left_num jsonb; right_num jsonb;
 n numeric; d numeric; bn numeric; bd numeric; comparison numeric; eq_value boolean;
 i integer; places integer:=2; chosen integer;
BEGIN
 IF p_depth>30 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='薪酬公式过深';END IF;
 IF jsonb_typeof(p_ast)<>'object' THEN RETURN jsonb_build_object('v',p_ast,'used',used);END IF;
 IF p_ast?'var' THEN
  IF NOT(p_context?(p_ast->>'var')) OR p_context->(p_ast->>'var') IN ('null'::jsonb,'""'::jsonb) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='薪酬公式缺少输入：'||(p_ast->>'var');
  END IF;
  RETURN jsonb_build_object('v',p_context->(p_ast->>'var'),'used',jsonb_build_array(p_ast->>'var'));
 END IF;
 op:=p_ast->>'op';args:=p_ast->'args';
 IF op='if' THEN
  child:=public.fn_ty_payroll_eval_node(args->0,p_context,p_depth+1);
  IF jsonb_typeof(child->'v')<>'boolean' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='IF条件需要明确真假';END IF;
  chosen:=CASE WHEN child->'v'='true'::jsonb THEN 1 ELSE 2 END;
  other:=public.fn_ty_payroll_eval_node(args->chosen,p_context,p_depth+1);
  RETURN jsonb_build_object('v',other->'v','used',(child->'used')||(other->'used'));
 END IF;
 IF op IN ('and','or') THEN
  FOR a IN SELECT * FROM jsonb_array_elements(args) LOOP
   child:=public.fn_ty_payroll_eval_node(a,p_context,p_depth+1);used:=used||(child->'used');
   IF jsonb_typeof(child->'v')<>'boolean' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='逻辑运算需要明确真假';END IF;
   IF (op='and' AND child->'v'='false'::jsonb) OR (op='or' AND child->'v'='true'::jsonb) THEN
    RETURN jsonb_build_object('v',child->'v','used',used);
   END IF;
  END LOOP;
  RETURN jsonb_build_object('v',to_jsonb(op='and'),'used',used);
 END IF;
 IF op='not' THEN child:=public.fn_ty_payroll_eval_node(args->0,p_context,p_depth+1);IF jsonb_typeof(child->'v')<>'boolean'THEN RAISE EXCEPTION 'NOT requires boolean';END IF;RETURN jsonb_build_object('v',to_jsonb(NOT(child->'v'='true'::jsonb)),'used',child->'used');END IF;
 IF op='coalesce'THEN FOR a IN SELECT * FROM jsonb_array_elements(args)LOOP child:=public.fn_ty_payroll_eval_node(a,p_context,p_depth+1);used:=used||(child->'used');IF child->'v'NOT IN('null'::jsonb,'""'::jsonb)THEN RETURN jsonb_build_object('v',child->'v','used',used);END IF;END LOOP;RAISE EXCEPTION 'COALESCE no known value';END IF;
 IF op='prorata'THEN RETURN public.fn_ty_payroll_eval_node(jsonb_build_object('op','divide','args',jsonb_build_array(jsonb_build_object('op','multiply','args',jsonb_build_array(args->0,args->1)),args->2)),p_context,p_depth+1);END IF;
 FOR a IN SELECT * FROM jsonb_array_elements(args) LOOP
  child:=public.fn_ty_payroll_eval_node(a,p_context,p_depth+1);
  values_json:=values_json||jsonb_build_array(child->'v');used:=used||(child->'used');
 END LOOP;
 IF op IN ('eq','ne') THEN
  BEGIN
   left_num:=public.fn_ty_payroll_number(values_json->0);right_num:=public.fn_ty_payroll_number(values_json->1);
   eq_value:=(left_num->>'n')::numeric*(right_num->>'d')::numeric=(right_num->>'n')::numeric*(left_num->>'d')::numeric;
  EXCEPTION WHEN check_violation THEN eq_value:=values_json->0=values_json->1; END;
  RETURN jsonb_build_object('v',to_jsonb(CASE WHEN op='eq' THEN eq_value ELSE NOT eq_value END),'used',used);
 END IF;
 left_num:=public.fn_ty_payroll_number(values_json->0);n:=(left_num->>'n')::numeric;d:=(left_num->>'d')::numeric;
 IF op IN('ceil','floor','abs','max0','min0','sqrt')THEN
 CASE op WHEN 'ceil'THEN n:=div(n,d)+CASE WHEN n>0 AND mod(n,d)<>0 THEN 1 ELSE 0 END;d:=1;
 WHEN 'floor'THEN n:=div(n,d)-CASE WHEN n<0 AND mod(n,d)<>0 THEN 1 ELSE 0 END;d:=1;
 WHEN 'abs'THEN n:=abs(n);WHEN 'max0'THEN n:=greatest(n,0);WHEN 'min0'THEN n:=least(n,0);
 WHEN 'sqrt'THEN IF n<0 THEN RAISE EXCEPTION 'SQRT negative';END IF;bn:=public.fn_ty_formula_isqrt(n);bd:=public.fn_ty_formula_isqrt(d);IF bn*bn<>n OR bd*bd<>d THEN RAISE EXCEPTION 'SQRT requires exact rational result';END IF;n:=bn;d:=bd;
 END CASE;RETURN jsonb_build_object('v',public.fn_ty_payroll_fraction(n,d),'used',used);END IF;
 IF op IN('power','mod')THEN right_num:=public.fn_ty_payroll_number(values_json->1);bn:=(right_num->>'n')::numeric;bd:=(right_num->>'d')::numeric;
 IF op='power'THEN IF mod(bn,bd)<>0 OR abs(bn/bd)>16 OR(n=0 AND bn<=0)THEN RAISE EXCEPTION 'POWER integer exponent -16..16';END IF;chosen:=div(bn,bd)::integer;IF chosen<0 THEN value:=public.fn_ty_payroll_fraction(power(d,-chosen),power(n,-chosen));ELSE value:=public.fn_ty_payroll_fraction(power(n,chosen),power(d,chosen));END IF;
 ELSE IF bn=0 THEN RAISE EXCEPTION 'MOD divisor zero';END IF;value:=public.fn_ty_payroll_fraction(n*bd-div(n*bd,d*bn)*bn*d,d*bd);END IF;RETURN jsonb_build_object('v',value,'used',used);END IF;
 IF op='round' THEN
  IF jsonb_array_length(values_json)=2 THEN
   right_num:=public.fn_ty_payroll_number(values_json->1);bn:=(right_num->>'n')::numeric;bd:=(right_num->>'d')::numeric;
   IF mod(bn,bd)<>0 OR bn<0 OR bn>8*bd THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ROUND小数位须为0至8的整数';END IF;
   places:=div(bn,bd)::integer;
  END IF;
  RETURN jsonb_build_object('v',public.fn_ty_payroll_round_fraction(left_num,places),'used',used);
 END IF;
 FOR i IN 1..jsonb_array_length(values_json)-1 LOOP
  right_num:=public.fn_ty_payroll_number(values_json->i);bn:=(right_num->>'n')::numeric;bd:=(right_num->>'d')::numeric;
  comparison:=n*bd-bn*d;
  CASE op
   WHEN 'add' THEN n:=n*bd+bn*d;d:=d*bd;
   WHEN 'subtract' THEN n:=n*bd-bn*d;d:=d*bd;
   WHEN 'multiply' THEN n:=n*bn;d:=d*bd;
   WHEN 'divide' THEN n:=n*bd;d:=d*bn;
   WHEN 'min','least' THEN IF comparison>=0 THEN n:=bn;d:=bd;END IF;
   WHEN 'max','greatest' THEN IF comparison<=0 THEN n:=bn;d:=bd;END IF;
   WHEN 'lt','lte','gt','gte' THEN
    RETURN jsonb_build_object('v',to_jsonb(CASE op WHEN 'lt' THEN comparison<0 WHEN 'lte' THEN comparison<=0 WHEN 'gt' THEN comparison>0 ELSE comparison>=0 END),'used',used);
   ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='薪酬公式操作无效';
  END CASE;
  value:=public.fn_ty_payroll_fraction(n,d);n:=(value->>'n')::numeric;d:=(value->>'d')::numeric;
 END LOOP;
 RETURN jsonb_build_object('v',public.fn_ty_payroll_fraction(n,d),'used',used);
END $$;
CREATE FUNCTION fn_ty_pay_formula_mapped_code(batch_key bigint,domain_key text,code_key text)RETURNS text LANGUAGE plpgsql STABLE SET search_path=''AS $$DECLARE result text;BEGIN SELECT f->>'target_code'INTO result FROM public.ty_pay_batch b JOIN public.ty_pay_config book ON book.id=b.rulebook_id CROSS JOIN LATERAL jsonb_array_elements(coalesce(book.data->'source_formulas','[]'))f WHERE b.id=batch_key AND f->>'domain'=domain_key AND f->>'source_code'=code_key;RETURN coalesce(result,code_key);END;$$;
CREATE FUNCTION fn_ty_source_formula_config_guard()RETURNS trigger LANGUAGE plpgsql SET search_path=''AS $$DECLARE f jsonb;c text;source public.ty_pay_item_catalog;target public.ty_pay_item_catalog;seen text[]:='{}';v text;BEGIN
 IF NEW.kind<>'rulebook'THEN RETURN NEW;END IF;IF jsonb_typeof(coalesce(NEW.data->'source_formulas','[]'))<>'array'OR jsonb_array_length(coalesce(NEW.data->'source_formulas','[]'))>100 THEN RAISE EXCEPTION 'Invalid source formula list';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(coalesce(NEW.data->'source_formulas','[]'))LOOP
 IF f->>'domain'NOT IN('performance_award','training_award','performance_result','people_candidate','leave_cash','leave_pay','contract_terms')OR jsonb_typeof(f->'auto_include')IS DISTINCT FROM'boolean'OR jsonb_typeof(f->'required')IS DISTINCT FROM'boolean'OR length(coalesce(f->>'formula',''))=0 THEN RAISE EXCEPTION 'Invalid source formula configuration';END IF;
 IF(f->>'auto_include')::boolean AND f->>'domain'NOT IN('performance_award','training_award','performance_result','people_candidate')THEN RAISE EXCEPTION 'Source requires explicit original adoption';END IF;
 c:=(f->>'domain')||':'||(f->>'source_code');IF c=ANY(seen)THEN RAISE EXCEPTION 'Duplicate source formula';END IF;seen:=array_append(seen,c);
 SELECT*INTO source FROM public.ty_pay_item_catalog WHERE code=f->>'source_code';SELECT*INTO target FROM public.ty_pay_item_catalog WHERE code=f->>'target_code';
 IF source.code IS NULL OR target.code IS NULL OR source.category<>target.category OR source.output_ledger<>target.output_ledger OR source.unit<>target.unit OR target.unit<>'currency_amount'OR source.metadata->>'employee_cash_wage_effect'IS DISTINCT FROM target.metadata->>'employee_cash_wage_effect'OR target.system NOT IN('COMMON',NEW.system)OR source.system NOT IN('COMMON',NEW.system)THEN RAISE EXCEPTION 'Source formula cannot change ledger nature, unit or currency system';END IF;
 FOREACH c IN ARRAY ARRAY[source.code,target.code]LOOP IF c LIKE'CUST_G%'AND NOT EXISTS(SELECT 1 FROM public.ty_pay_setup_item WHERE code=c AND group_id=NEW.group_id AND status='approved')THEN RAISE EXCEPTION 'Source formula custom item belongs to another group';END IF;END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(NEW.data->'rules','[]'))r WHERE r->>'code'=target.code)THEN RAISE EXCEPTION 'Source item is also generated as ordinary wage';END IF;
 PERFORM public.fn_ty_payroll_ast_meta(f->'compiled'->'formula');FOR c IN SELECT jsonb_array_elements_text(public.fn_ty_payroll_ast_meta(f->'compiled'->'formula')->'vars')LOOP IF c<>'source_amount'AND NOT(NEW.data->'inputs'?c)AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(NEW.data->'rules','[]'))r WHERE r->>'code'=c)THEN RAISE EXCEPTION 'Unknown source formula variable';END IF;END LOOP;
 IF NEW.status='approved'AND(EXISTS(SELECT 1 FROM unnest(ARRAY['hk_adw','cn_average','cn_annual_leave','ordinary_wage'])k WHERE f->'wage_tags'->>k IS NULL OR f->'wage_tags'->>k NOT IN('include','exclude','not_applicable')))THEN RAISE EXCEPTION 'Source formula wage classification pending review';END IF;
 END LOOP;RETURN NEW;END;$$;
CREATE TRIGGER zz_source_formula_config BEFORE INSERT OR UPDATE ON ty_pay_config FOR EACH ROW EXECUTE FUNCTION fn_ty_source_formula_config_guard();
-- Preserve each adapter's original parent, identity, version, publication and appeal checks.
DO $$DECLARE name text;d text;needle text;BEGIN
 FOREACH name IN ARRAY ARRAY['fn_ty_pr_pay_key(bigint,bigint)','fn_ty_lr_pay_key(bigint,bigint)']LOOP
 SELECT pg_get_functiondef(('public.'||name)::regprocedure)INTO d;needle:='p.item_code IS DISTINCT FROM i.code';IF strpos(d,needle)=0 THEN RAISE EXCEPTION '242 adapter key prerequisite drifted';END IF;d:=replace(d,needle,'public.fn_ty_pay_formula_mapped_code(batch_key,a.source_domain,p.item_code) IS DISTINCT FROM i.code');EXECUTE d;END LOOP;
 FOREACH name IN ARRAY ARRAY['fn_ty_pr_pay_expected(bigint,bigint)','fn_ty_lr_pay_expected(bigint,bigint)']LOOP
 SELECT pg_get_functiondef(('public.'||name)::regprocedure)INTO d;needle:=substring(d from 'IF tags[?]''wage_tags''[[:space:]]*THEN[[:space:]]*tags[[:space:]]*:?=[[:space:]]*tags->''wage_tags'';[[:space:]]*END IF;');IF needle IS NULL THEN RAISE EXCEPTION '242 adapter tags prerequisite drifted';END IF;
 d:=replace(d,needle,needle||' IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(book.data->''source_formulas'',''[]''))f WHERE f->>''domain''=a.source_domain AND f->>''source_code''=p.item_code)THEN SELECT f->''wage_tags''INTO tags FROM jsonb_array_elements(book.data->''source_formulas'')f WHERE f->>''domain''=a.source_domain AND f->>''source_code''=p.item_code;END IF;');EXECUTE d;END LOOP;
END;$$;
CREATE FUNCTION fn_ty_pay_formula_source_code(batch_key bigint,adoption_key bigint)RETURNS text LANGUAGE plpgsql STABLE SET search_path=''AS $$DECLARE a public.ty_pay_adoption;code text;c public.ty_ps_candidate;b public.ty_pay_batch;fee text;BEGIN SELECT*INTO a FROM public.ty_pay_adoption WHERE id=adoption_key AND batch_id=batch_key;SELECT*INTO b FROM public.ty_pay_batch WHERE id=batch_key;
 CASE a.source_domain WHEN'performance_award'THEN SELECT p.item_code INTO code FROM public.ty_pr_award_revision r JOIN public.ty_pr_award_parent p ON p.id=r.parent_id WHERE r.id=a.source_id::bigint;
 WHEN'training_award'THEN SELECT p.item_code INTO code FROM public.ty_lr_application r JOIN public.ty_lr_award_parent p ON p.current_application_id=r.id WHERE r.id=a.source_id::bigint;
 WHEN'performance_result'THEN code:='QUARTERLY_PERFORMANCE';
 WHEN'people_candidate'THEN SELECT*INTO c FROM public.ty_ps_candidate WHERE id=a.source_id::bigint;IF c.kind='employee_charge'THEN SELECT d.fee_kind INTO fee FROM public.ty_dorm_charge r JOIN public.ty_dorm_bill d ON d.id=r.bill_id WHERE c.source_ref='dorm_charge:'||r.id;code:=CASE WHEN fee IN('water','electricity')THEN'HOUSING_UTILITIES_OFFSET'ELSE'HOUSING_RENT_OFFSET'END;ELSIF c.kind='noncash_benefit'THEN code:=CASE WHEN b.system='HK_PAYROLL'THEN'HK_HOUSING_RENTAL_VALUE'ELSE'CN_INKIND_TAX_REFERENCE'END;ELSIF c.kind='company_cost'THEN code:='ER_INKIND_WELFARE_COST';END IF;
 ELSE SELECT i.code INTO code FROM public.ty_pay_item i WHERE i.adoption_id=a.id;END CASE;RETURN code;END;$$;
-- Extract the installed authoritative context resolver, including235 contract
-- references, rather than introducing a second interpretation of profile/time inputs.
DO $migration$DECLARE d text;body text;start_at integer;end_at integer;BEGIN
 SELECT pg_get_functiondef('public.fn_ty_pay_authority_guard()'::regprocedure)INTO d;
 start_at:=strpos(d,'SELECT * INTO p FROM public.ty_pay_config WHERE id=(a.source_snapshot->>''profile_id'')::bigint;');end_at:=strpos(d,'ELSIF a.source_domain=''leave_cash''THEN');IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION '242 context prerequisite drifted';END IF;body:=substr(d,start_at,end_at-start_at);body:=replace(body,'NEW.','batch_row.');
 EXECUTE $def$CREATE FUNCTION public.fn_ty_pay_source_formula_expected(batch_key bigint,adoption_key bigint,raw_target numeric)RETURNS numeric LANGUAGE plpgsql SET search_path=''AS $fn$
 DECLARE a public.ty_pay_adoption;i public.ty_pay_item;r public.ty_pay_row;p public.ty_pay_config;book public.ty_pay_config;batch_row public.ty_pay_batch;v jsonb;ctx jsonb;entry record;rule jsonb;result jsonb;expected numeric;metric text;number_value numeric;unknowns integer;rid bigint;state text;m jsonb;source_code text;
 BEGIN SELECT*INTO a FROM public.ty_pay_adoption WHERE id=adoption_key AND batch_id=batch_key;SELECT*INTO batch_row FROM public.ty_pay_batch WHERE id=batch_key;SELECT*INTO book FROM public.ty_pay_config WHERE id=batch_row.rulebook_id;SELECT*INTO i FROM public.ty_pay_item WHERE adoption_id=a.id;SELECT*INTO r FROM public.ty_pay_row WHERE id=i.row_id;source_code:=public.fn_ty_pay_formula_source_code(batch_key,adoption_key);
 SELECT f INTO m FROM jsonb_array_elements(coalesce(book.data->'source_formulas','[]'))f WHERE f->>'domain'=a.source_domain AND f->>'source_code'=source_code;
 IF m IS NULL THEN IF a.source_snapshot?'source_formula'THEN RAISE EXCEPTION 'Unconfigured source formula';END IF;RETURN raw_target;END IF;
 IF raw_target IS NULL OR m->>'target_code'IS DISTINCT FROM i.code OR a.source_snapshot->'source_formula'->>'formula'IS DISTINCT FROM m->>'formula'OR(a.source_snapshot->'source_formula'->>'original_target')::numeric IS DISTINCT FROM raw_target THEN RAISE EXCEPTION 'Formula does not match original authority and approved scheme';END IF;
 $def$||body||$def$
 IF p.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.ty_pay_config c WHERE c.id=p.id AND c.group_id=batch_row.group_id AND c.person_id=r.person_id AND c.company_id=batch_row.company_id AND c.id=(SELECT x.id FROM public.ty_pay_config x WHERE x.company_id=c.company_id AND x.employment_id=c.employment_id AND x.kind='profile'AND x.system=c.system AND x.status='approved'AND x.valid_from<=batch_row.period AND(x.valid_to IS NULL OR x.valid_to>=batch_row.period+interval'1 month')ORDER BY x.revision DESC,x.id DESC LIMIT 1))THEN RAISE EXCEPTION 'Formula employee profile no longer current';END IF;
 IF rid IS NOT NULL AND(NOT public.fn_ty_time_leave_current(rid,r.employment_id)OR NOT public.fn_ty_time_report_roster_current(rid,r.employment_id))THEN RAISE EXCEPTION 'Formula attendance source changed';END IF;
 ctx:=ctx||jsonb_build_object('source_amount',raw_target::text);result:=public.fn_ty_payroll_eval(m->'compiled'->'formula',ctx);expected:=public.fn_ty_payroll_money(result->'v');
 IF expected<0 OR a.source_domain IN('leave_cash','leave_pay','contract_terms')AND expected<>raw_target OR a.source_domain='people_candidate'AND expected>raw_target THEN RAISE EXCEPTION 'Formula exceeds original authorized amount';END IF;
 IF NOT(i.wage_tags@>(m->'wage_tags'))THEN RAISE EXCEPTION 'Formula wage classification mismatch';END IF;RETURN expected;END;$fn$;$def$;
 SELECT pg_get_functiondef('public.fn_ty_pay_authority_guard()'::regprocedure)INTO d;
 IF strpos(d,'IF expected IS NULL OR a.target<>expected THEN')=0 THEN RAISE EXCEPTION '242 final authority prerequisite drifted';END IF;
 d:=replace(d,'IF expected IS NULL OR a.target<>expected THEN','expected:=public.fn_ty_pay_source_formula_expected(NEW.id,a.id,expected); IF expected IS NULL OR a.target<>expected THEN');EXECUTE d;
END;$migration$;
DO $$DECLARE d text;needle text;BEGIN SELECT pg_get_functiondef('public.fn_ty_pay_source_treatments_guard()'::regprocedure)INTO d;needle:='tags:=book.data->''source_treatments''->x.source_domain->x.code;';IF strpos(d,needle)=0 THEN RAISE EXCEPTION '242 wage tag prerequisite drifted';END IF;d:=replace(d,'i.code,i.wage_tags,a.source_domain','i.code,i.wage_tags,a.source_domain,a.source_snapshot');d:=replace(d,needle,'tags:=CASE WHEN x.source_snapshot?''source_formula''THEN(SELECT f->''wage_tags''FROM jsonb_array_elements(coalesce(book.data->''source_formulas'',''[]''))f WHERE f->>''domain''=x.source_domain AND f->>''source_code''=x.source_snapshot->''source_formula''->>''source_code''AND f->>''target_code''=x.code)ELSE book.data->''source_treatments''->x.source_domain->x.code END;');EXECUTE d;END;$$;
CREATE FUNCTION fn_ty_pay_source_required_guard()RETURNS trigger LANGUAGE plpgsql SET search_path=''AS $$DECLARE f jsonb;e bigint;BEGIN IF NEW.status<>'confirmed'OR OLD.status='confirmed'THEN RETURN NEW;END IF;
 FOR f IN SELECT x FROM public.ty_pay_config b CROSS JOIN LATERAL jsonb_array_elements(coalesce(b.data->'source_formulas','[]'))x WHERE b.id=NEW.rulebook_id AND(x->>'auto_include')::boolean AND(x->>'required')::boolean LOOP
 FOR e IN SELECT employment_id FROM public.ty_pay_row WHERE batch_id=NEW.id LOOP IF NOT EXISTS(SELECT 1 FROM public.ty_pay_adoption a JOIN public.ty_pay_obligation o ON o.id=a.obligation_id WHERE a.batch_id=NEW.id AND o.employment_id=e AND a.source_domain=f->>'domain'AND public.fn_ty_pay_formula_source_code(NEW.id,a.id)=f->>'source_code')THEN RAISE EXCEPTION 'Required formula source missing for employee %',e;END IF;END LOOP;END LOOP;RETURN NEW;END;$$;
CREATE TRIGGER zz_pay_source_required BEFORE UPDATE ON ty_pay_batch FOR EACH ROW EXECUTE FUNCTION fn_ty_pay_source_required_guard();

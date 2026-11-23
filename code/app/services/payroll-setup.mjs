// Customer payroll setup uses the native immutable salary/configuration chain.
import{randomBytes}from'node:crypto';
import{one,q,id,text,same,bad,deny,conflict,missing,paging,search,hash,grantAllowsField}from'./platform-core.mjs';
import{payrollInternals as H,saveConfiguration,approveConfiguration,workspace as nativeWorkspace}from'./payroll-source.mjs';
import{companyDescendants,ledgerDescendants}from'./foundation.mjs';
import{sameHuman,humanIsPerson}from'./human-identity.mjs';
import{amount,plus,times,over,compare,minus,fraction}from'../payroll-calculations.mjs';
import{exactDecimal}from'../leave-calculations.mjs';
const systems={CN_PAYROLL:'CNY',HK_PAYROLL:'HKD'},labels={monthly:'基本月薪',hourly:'基本时薪',position:'岗位津贴',meal:'伙食津贴',transport:'交通津贴',minimum_guard:'最低工资保障核定值'};
const installed=async t=>!!(await one(t,"SELECT to_regclass('public.ty_pay_setup_item')IS NOT NULL ok")).ok;
async function ready(t){if(!await installed(t))bad('工资项目及员工定薪设置尚未安装');}
const ymd=v=>H.date(v),month=v=>{const s=ymd(v);if(!s.endsWith('-01'))bad('工资档案按整月生效，请选择月份首日；月中变更须先按分段规则核定');return s;};
async function scopeEmployment(t,key){const e=await H.employment(t,key),assignments=await q(t,"SELECT a.id,a.department_id,a.valid_from,a.valid_to,a.status,a.is_primary,d.name department_name FROM ty_position_assignment a JOIN ty_department d ON d.id=a.department_id WHERE a.employment_id=$1 AND a.status='active'AND a.valid_from<=app_today()AND(a.valid_to IS NULL OR a.valid_to>app_today())ORDER BY a.is_primary DESC,a.id",[e.id]);const primary=assignments.find(a=>a.is_primary);return{...e,employment_id:e.id,department_id:primary?.department_id,department_name:primary?.department_name||'未分配部门',assignment_snapshot:assignments};}
export async function completeSalaryGrant(t,u,resource,action,e,fields){const d=await H.access(t,u,resource,action,e,fields);if(!d.allowing_grants.some(g=>!(g.fields_deny||[]).length&&(g.source==='built_in_baseline'||fields.every(k=>grantAllowsField(g,k)))))deny('工资档案含受限字段，须由同一完整薪资授权办理，不能通过参数或前后差额绕过字段限制');return d;}
export async function salaryGrantIfInstalled(t,u,resource,action,e,fields){if(await installed(t))return completeSalaryGrant(t,u,resource,action,e,fields);}
async function readPerson(t,u,e){await completeSalaryGrant(t,u,'payroll_slips_read_all','read',e,['data','amount','person_number','full_name']);}
async function writePerson(t,u,e){await readPerson(t,u,e);await completeSalaryGrant(t,u,'payroll_sources','write',e,['data','evidence_ref']);}
async function may(t,fn){try{await fn();return true;}catch(e){if(String(e.message).startsWith('E_TY_FORBIDDEN:'))return false;throw e;}}
async function head(t,e,system){return one(t,"SELECT * FROM ty_pay_config WHERE employment_id=$1 AND kind='profile'AND system=$2 ORDER BY revision DESC,id DESC LIMIT 1",[e.id,system]);}
async function book(t,e,system,on,key){const b=key?await H.config(t,key):await one(t,`SELECT * FROM ty_pay_config WHERE company_id=$1 AND kind='rulebook' AND system=$2
  AND status='approved' AND stable_key NOT LIKE 'rulebook-copy:%' AND valid_from<=$3
  AND (valid_to IS NULL OR valid_to>=$4) ORDER BY revision DESC,id DESC LIMIT 1`,[e.company_id,system,on,H.monthEnd(on)]);if(!b||b.kind!=='rulebook'||b.status!=='approved'||!same(b.company_id,e.company_id)||b.system!==system||ymd(b.valid_from)>on||b.valid_to&&ymd(b.valid_to)<H.monthEnd(on))bad('请选择该公司、该体系及生效月份完整适用的已发布工资方案');const current=await one(t,"SELECT id FROM ty_pay_config WHERE company_id=$1 AND kind='rulebook'AND stable_key=$2 AND system=$3 AND status='approved'AND valid_from<=$4 AND(valid_to IS NULL OR valid_to>=$5)ORDER BY revision DESC,id DESC LIMIT 1",[e.company_id,b.stable_key,system,on,H.monthEnd(on)]);if(!same(current?.id,b.id))conflict('工资方案已有当期生效新版本，请重新选择方案并预检');return b;}
async function boundBook(t,e,system,on,profile){
 if(!profile?.data.setup_rulebook_id)return null;
 const bound=await H.config(t,profile.data.setup_rulebook_id);
 if(bound.kind!=='rulebook'||!same(bound.company_id,e.company_id)||bound.system!==system)return null;
 return await one(t,`SELECT * FROM ty_pay_config WHERE company_id=$1 AND kind='rulebook'
   AND system=$2 AND stable_key=$3 AND status='approved' AND valid_from<=$4
   AND(valid_to IS NULL OR valid_to>=$5) ORDER BY revision DESC,id DESC LIMIT 1`,
   [e.company_id,system,bound.stable_key,on,H.monthEnd(on)])||null;
}
async function staffBook(t,e,system,on,key,profile){
 if(key||!profile?.data.setup_rulebook_id)return book(t,e,system,on,key);
 const bound=await boundBook(t,e,system,on,profile);
 if(!bound)bad('员工已分配的工资方案不覆盖本月，请先重新分配方案');
 return bound;
}
async function visibleBook(t,u,b){
 if(!b)return null;
 const visible=await H.project(t,u,'payroll_config',b,b);
 return visible?.data?{id:visible.id,name:visible.data.name||visible.stable_key,revision:visible.revision}:null;
}
export async function copySchemes(t,{userId,input,operationId}){
 await ready(t);
 const group=id(input.group_id),source=await H.config(t,input.source_id);
 if(source.kind!=='rulebook'||!same(source.group_id,group)||source.status!=='approved')bad('请选择同集团已发布工资方案');
 await completeSalaryGrant(t,userId,'payroll_config','read',source,['data']);
 if(!Array.isArray(input.company_ids)||!input.company_ids.length||input.company_ids.length>50)bad('请选择1至50个复制目标');
 const targets=[...new Set(input.company_ids.map(v=>String(id(v))))].sort((a,b)=>Number(a)-Number(b));
 const name=text(input.name,'新方案名称',2,100),from=month(input.valid_from),evidence=text(input.evidence_ref,'复制核定依据',4);
 for(const target of targets){
   const c=await one(t,"SELECT * FROM ty_company WHERE id=$1 AND group_id=$2 AND status='active'",[target,group]);
   if(!c)bad('目标公司不属于当前集团或已停用');
   await H.access(t,userId,'payroll_config','write',c,['data','evidence_ref']);
 }
 return H.cmd(t,{userId,operationId,operation:'setup.schemes.copy',input,execute:async()=>{
   const configs=[];
   for(const company_id of targets){
     const enabled=await H.latest(t,{companyId:company_id,kind:'systems',on:from,end:H.monthEnd(from)});
     if(!enabled?.data.enabled_systems?.includes(source.system))bad('目标公司在生效月份尚未启用此算薪体系：'+company_id);
     const {compiled,policy_values,...original}=source.data;
     const data={...original,name,copied_from_rulebook_id:source.id,
       statutory_requirements:(original.statutory_requirements||[]).map(req=>({...req,evidence_ref:evidence}))};
     const result=await saveConfiguration(t,{userId,operationId:'copy:'+hash([operationId,company_id]).slice(0,48),input:{
       company_id,kind:'rulebook',system:source.system,stable_key:'rulebook-copy:'+hash([userId,operationId,company_id]).slice(0,36),
       valid_from:from,evidence_ref:evidence,data
     }});
     configs.push({company_id,id:result.config?.id??null});
   }
   return {configs};
 },receipt:async r=>({total:r.configs.length,configs:r.configs})});
}
export async function assertCatalogGroup(t,code,group){if(!String(code).startsWith('CUST_G'))return;if(!await installed(t))bad('自定义工资项目尚未安装');const row=await one(t,"SELECT * FROM ty_pay_setup_item WHERE code=$1 AND group_id=$2 AND status='approved'",[code,group]);if(!row)bad('自定义工资项目未发布或不属于当前集团');}
export async function assertBookGroup(t,data,group){for(const r of data.rules||[])await assertCatalogGroup(t,r.code,group);for(const r of data.source_formulas||[]){await assertCatalogGroup(t,r.source_code,group);await assertCatalogGroup(t,r.target_code,group);}for(const items of Object.values(data.source_treatments||{}))for(const code of Object.keys(items))await assertCatalogGroup(t,code,group);}
async function fieldsFor(t,u,e,b,on){const out=[];let locks=[];if((await one(t,"SELECT to_regclass('public.ty_cp_resolution')IS NOT NULL ok")).ok)locks=await q(t,"SELECT DISTINCT input_key FROM ty_cp_resolution WHERE employment_id=$1 AND rulebook_id=$2 AND pay_period=$3 AND mode='input'AND status='approved'",[e.id,b.id,on]);for(const[k,v]of Object.entries(b.data.inputs||{})){if(v.source!=='profile')continue;const key=v.key||k;const direct=(b.data.rules||[]).find(r=>r.formula===k),cat=direct?await one(t,'SELECT name FROM ty_pay_item_catalog WHERE code=$1',[direct.code]):null;out.push({key,label:labels[key]||cat?.name||v.label||key,unit:v.unit,source_key:k,locked:key==='minimum_guard'||locks.some(r=>r.input_key===k),source:locks.some(r=>r.input_key===k)?'contract_terms':key==='minimum_guard'?'minimum_wage_review':'salary_profile'});}return out;}
const inEmploymentMonth=(e,on)=>ymd(e.hire_date)<H.monthEnd(on)&&(!e.leave_date||ymd(e.leave_date)>=on);
const itemView=r=>({...r,custom:true});
export async function setupWorkspace(t,{userId,input}){await ready(t);const group=id(input.group_id),scope={group_id:group,...(input.company_id?{company_id:id(input.company_id)}:{})},view=input.view||'items';
 if(view==='items'){await H.access(t,userId,'payroll_config','read',scope,['code','name']);const predefined=(await nativeWorkspace(t,{userId,input:{...input,view:'catalog',page:1,page_size:200}})).rows||[],rows=[];for(const r of predefined)rows.push({...r,custom:String(r.code).startsWith('CUST_G'),display_code:r.code,status:'approved'});for(const r of await q(t,'SELECT * FROM ty_pay_setup_item WHERE group_id=$1 ORDER BY id DESC',[group])){const projected=await H.project(t,userId,'payroll_config',scope,itemView(r));if(!projected?.id||!projected.code||!projected.name)continue;const existing=rows.findIndex(x=>x.code===r.code);if(existing>=0)rows.splice(existing,1);projected.can_approve=r.status==='draft'&&!await sameHuman(t,r.created_by,userId)&&await may(t,()=>H.access(t,userId,'payroll_config','approve',scope,['data','status']));rows.push(projected);}rows.sort((a,b)=>Number(!!b.custom)-Number(!!a.custom)||Number(b.status==='draft')-Number(a.status==='draft')||String(a.display_code||a.code).localeCompare(String(b.display_code||b.code)));return{...paging(search(rows,input.q,['name','code','display_code']),input),capabilities:{can_configure:await may(t,()=>H.access(t,userId,'payroll_config','write',scope,['data','evidence_ref']))}};}
 if(view==='rulebooks'){const rows=await nativeWorkspace(t,{userId,input:{...input,view:'configs',kind:'rulebook',page:1,page_size:200}});return paging((rows.rows||[]).filter(r=>r.status==='approved'),input);}
 if(!['profiles','fields'].includes(view))bad('未知定薪视图');const system=input.system||'CN_PAYROLL';if(!systems[system])bad('请选择算薪体系');const on=month(input.on||new Date().toISOString().slice(0,7)+'-01');
 const filterEmploymentIds=input.employment_ids;
 if(filterEmploymentIds!==undefined&&(!Array.isArray(filterEmploymentIds)||!filterEmploymentIds.length||filterEmploymentIds.length>200||view!=='fields'))bad('工资参数查询须指定1至200段实际雇佣');
 const companyScope=input.scope_company_id?await companyDescendants(t,id(input.scope_company_id)):null;
 const ledgerScope=input.ledger_id?await ledgerDescendants(t,id(input.ledger_id)):null;
 const es=await q(t,"SELECT e.id,e.company_id,c.ledger_id FROM ty_employment e JOIN ty_company c ON c.id=e.company_id WHERE e.group_id=$1 AND e.status<>'cancelled'AND($2::bigint IS NULL OR e.company_id=$2)AND($3::bigint IS NULL OR e.id=$3)AND e.hire_date<$4::date AND(e.leave_date IS NULL OR e.leave_date>=$5::date)AND($6::bigint[] IS NULL OR e.id=ANY($6)) ORDER BY e.id",[group,input.company_id?id(input.company_id):null,input.employment_id?id(input.employment_id):null,H.monthEnd(on),on,filterEmploymentIds?.map(v=>id(v))||null]),rows=[],fieldsByEmployment={};
 for(const raw of es){if(companyScope&&!companyScope.includes(String(raw.company_id))||ledgerScope&&!ledgerScope.includes(String(raw.ledger_id)))continue;const e=await scopeEmployment(t,raw.id);if(input.department_id&&!same(e.department_id,input.department_id)||!await may(t,()=>readPerson(t,userId,e)))continue;const enabled=await H.latest(t,{companyId:e.company_id,kind:'systems',on,end:H.monthEnd(on)});if(enabled&&!enabled.data.enabled_systems?.includes(system))continue;const h=await head(t,e,system),current=await H.latest(t,{companyId:e.company_id,employmentId:e.id,kind:'profile',system,on,end:H.monthEnd(on)});
 const assigned=await boundBook(t,e,system,on,current);
 let b=null;
 try{b=input.rulebook_id?await book(t,e,system,on,input.rulebook_id):current?.data.setup_rulebook_id?assigned:await book(t,e,system,on);}
 catch(err){if(input.rulebook_id||!String(err.message).startsWith('E_TY_'))throw err;}
 const fields=b&&input.assignment_view!==true?await fieldsFor(t,userId,e,b,on):[];
 if(view==='fields'&&filterEmploymentIds){
   if(b&&await may(t,()=>writePerson(t,userId,e)))fieldsByEmployment[String(e.id)]=fields;
   continue;
 }
 if(view==='fields'){if(!input.employment_id)for(const f of fields){f.locked=f.key==='minimum_guard';f.source=f.locked?'minimum_wage_review':'salary_profile';}if(b)return{rows:fields,rulebook:{id:b.id,revision:b.revision,name:b.data.name},total:fields.length};continue;}
 const canAssign=inEmploymentMonth(e,on)&&await may(t,()=>writePerson(t,userId,e));
 const draft=h?.status==='draft'?h:null;rows.push({id:e.id,employment_id:e.id,person_id:e.person_id,person_number:e.person_number,full_name:e.full_name,company_id:e.company_id,company_name:e.company_name,department_id:e.department_id,department_name:e.department_name,system,scheme:await visibleBook(t,userId,assigned),has_assigned_scheme:!!current?.data.setup_rulebook_id,
 draft_scheme:input.assignment_view===true&&draft?await visibleBook(t,userId,await boundBook(t,e,system,ymd(h?.valid_from),draft)):null,
 can_assign:canAssign&&!draft,head_id:h?.id||0,head_revision:h?.revision||0,current_profile_id:current?.id||null,parameters:current?.data.parameters||{},fields,rulebook_id:b?.id||null,status:draft?'draft':current?'approved':'missing',draft_profile_id:draft?.id||null,draft_revision:draft?.revision||null,draft_parameters:draft?.data.parameters,can_write:!!b&&canAssign,can_approve:!!draft&&!await sameHuman(t,draft.created_by,userId)&&!await humanIsPerson(t,userId,e.group_id,e.person_id)&&await may(t,()=>completeSalaryGrant(t,userId,'payroll_confirm','approve',e,['data','status']))});}
 if(view==='fields'&&filterEmploymentIds){
  if(Object.keys(fieldsByEmployment).length!==new Set(filterEmploymentIds.map(String)).size)deny('部分人员已不在本店可办理范围，请重新选择');
  return {fields_by_employment:fieldsByEmployment};
 }
 if(view==='fields')return{rows:[],total:0};return{...paging(search(rows,input.q,['person_number','full_name','company_name','department_name']),input),capabilities:{can_set_profiles:rows.some(r=>r.can_write)}};
}
export async function saveItem(t,{userId,input,operationId}){await ready(t);const group=id(input.group_id),scope={group_id:group};await H.access(t,userId,'payroll_config','write',scope,['data','evidence_ref']);const display=text(input.display_code,'客户工资项目编码',2,40).toUpperCase();if(!/^[A-Z][A-Z0-9_]{1,39}$/.test(display))bad('项目编码须2至40位大写字母、数字或下划线，以字母开头');const code='CUST_G'+group+'_'+display;if(code.length>64)bad('工资项目编码过长');if(!['COMMON',...Object.keys(systems)].includes(input.system))bad('工资项目适用体系无效');if(!['cash_earnings','personal_deduction','employer_cost'].includes(input.category)||input.unit&&input.unit!=='currency_amount')bad('自定义项目请选择现金应发、个人扣项或雇主成本，金额单位固定');return H.cmd(t,{userId,operationId,operation:'setup.item.save',input,execute:async()=>{await t.query('SELECT id FROM ty_group WHERE id=$1 FOR UPDATE',[group]);if(await one(t,'SELECT 1 FROM ty_pay_setup_item WHERE group_id=$1 AND display_code=$2',[group,display]))conflict('该集团工资项目编码已存在，请使用新编码');return{id:(await one(t,'INSERT INTO ty_pay_setup_item(group_id,code,display_code,name,system,category,unit,evidence_ref,created_by)VALUES($1,$2,$3,$4,$5,$6,\'currency_amount\',$7,$8)RETURNING id',[group,code,display,text(input.name,'工资项目名称',2,100),input.system,input.category,text(input.evidence_ref,'设置依据',4),userId])).id};},receipt:async r=>({item:await H.project(t,userId,'payroll_config',scope,itemView(await one(t,'SELECT * FROM ty_pay_setup_item WHERE id=$1',[r.id])))})});}
export async function approveItem(t,{userId,input,operationId}){await ready(t);const item=await one(t,'SELECT * FROM ty_pay_setup_item WHERE id=$1',[id(input.id)]);if(!item)missing();await H.access(t,userId,'payroll_config','approve',item,['data','status']);return H.cmd(t,{userId,operationId,operation:'setup.item.approve',input,execute:async()=>{await t.query('SELECT id FROM ty_pay_setup_item WHERE id=$1 FOR UPDATE',[item.id]);if(await sameHuman(t,item.created_by,userId))deny('工资项目由另一自然人独立发布');if(item.status!=='draft'||Number(input.expected_revision)!==Number(item.revision))conflict('项目版本已处理');await t.query("UPDATE ty_pay_setup_item SET status='approved',approved_by=$2,approved_at=clock_timestamp()WHERE id=$1",[item.id,userId]);const metadata=(await one(t,'SELECT fn_ty_pay_setup_metadata($1,$2,$3,$4) metadata',[item.group_id,item.id,item.code,item.category])).metadata;const ledger={cash_earnings:'employee_gross_wage',personal_deduction:'employee_deduction',employer_cost:'employer_cost'}[item.category];await t.query('INSERT INTO ty_pay_item_catalog(code,name,system,category,unit,output_ledger,metadata)VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[item.code,item.name,item.system,item.category,item.unit,ledger,JSON.stringify(metadata)]);return{id:item.id};},receipt:async r=>({item:await H.project(t,userId,'payroll_config',item,itemView(await one(t,'SELECT * FROM ty_pay_setup_item WHERE id=$1',[r.id])))})});}
async function prepare(t,u,input,{lock=false}={}){const group=id(input.group_id),system=input.system;if(!systems[system])bad('请选择一种算薪体系');const from=month(input.valid_from),to=input.valid_to?month(input.valid_to):null;if(to&&to<=from)bad('结束月份须晚于生效月份');text(input.evidence_ref,'定薪调薪依据',4);if(!Array.isArray(input.rows)||!input.rows.length||input.rows.length>200)bad('请选择1至200条员工实际雇佣');const rows=[],seen=new Set();if(lock){const es=[];for(const r of input.rows)es.push(await H.employment(t,r.employment_id));for(const co of [...new Set(es.map(e=>String(e.company_id)))].sort((a,b)=>Number(a)-Number(b)))await t.query('SELECT id FROM ty_company WHERE id=$1 FOR UPDATE',[co]);for(const e of es.sort((a,b)=>Number(a.id)-Number(b.id)))await t.query('SELECT id FROM ty_employment WHERE id=$1 FOR UPDATE',[e.id]);}for(const request of [...input.rows].sort((a,b)=>Number(a.employment_id)-Number(b.employment_id))){const e=await scopeEmployment(t,request.employment_id);if(!same(e.group_id,group)||seen.has(String(e.id)))bad('员工不属于本集团或同一实际雇佣重复');seen.add(String(e.id));
 if(!inEmploymentMonth(e,from))bad('定薪生效月份不在实际入职至离职期间');await writePerson(t,u,e);const h=await head(t,e,system);if(String(request.expected_head_id??0)!==String(h?.id||0))conflict('员工工资档案已有新草稿或新发布版本，请刷新后重新预检');if(h?.status==='draft')conflict('此员工已有待核工资草稿，请先处理，不能叠加另一份调薪');const assignment=input.assign_scheme===true;
 if(assignment&&(!input.company_id||!same(input.company_id,e.company_id)||!input.rulebook_id))bad('方案分配须指定员工所在公司与已发布方案');
 const current=await H.latest(t,{companyId:e.company_id,employmentId:e.id,kind:'profile',system,on:from,end:H.monthEnd(from)});
 const b=await staffBook(t,e,system,from,input.rulebook_id,current);
 if(assignment){
   await H.access(t,u,'payroll_config','read',b,['data']);
   const enabled=await H.latest(t,{companyId:e.company_id,kind:'systems',on:from,end:H.monthEnd(from)});
   if(!enabled?.data.enabled_systems?.includes(system))bad('公司在生效月份尚未启用此算薪体系');
 }
 if(request.expected_rulebook_id&&!same(request.expected_rulebook_id,b.id))conflict('工资表所用方案已变化，请刷新工资表后重新修改');
 const fields=await fieldsFor(t,u,e,b,from),before=current?.data.parameters||{},parameters=structuredClone(before),changes=request.parameters;
 if(!changes||typeof changes!=='object'||Array.isArray(changes)||!assignment&&!Object.keys(changes).length)bad('请至少填写一个工资项目标准');
 if(assignment)for(const field of fields){
   if(parameters[field.key]?.unit!==field.unit)delete parameters[field.key];
 }
 const delta={};for(const[key,p]of Object.entries(changes)){const field=fields.find(f=>f.key===key);if(!field)bad('工资参数不属于该公司生效工资方案:'+key);if(field.locked)bad(field.label+'由'+(field.source==='contract_terms'?'已核合同条款':'最低工资保障核验')+'负责，请先在原业务核定');if(p?.unit!==field.unit)bad('工资项目单位不匹配');H.numeric(p.value);const mode=request.mode||'set';if(!['set','add','percent'].includes(mode))bad('调薪方式无效');if(mode!=='set'&&!before[key])bad('调薪前标准未知，不能按0增加或计算比例');const scale=field.unit==='currency_amount'||field.unit==='currency_per_month'?2:4;const value=mode==='set'?p.value:exactDecimal(fraction(mode==='add'?plus(before[key].value,p.value):times(before[key].value,plus('1',over(p.value,'100')))),scale);if(compare(value,'0')<0)bad('工资标准不能为负');parameters[key]={value,unit:field.unit};delta[key]=exactDecimal(fraction(minus(value,before[key]?.value||'0')),scale);}
 for(const f of fields)if(!f.locked&&!parameters[f.key])bad('首次定薪须填写方案所有必要工资标准:'+f.label);
 if(await one(t,"SELECT 1 FROM ty_pay_row r JOIN ty_pay_batch b ON b.id=r.batch_id WHERE r.employment_id=$1 AND b.system=$2 AND b.status='confirmed'AND b.period>=$3 AND($4::date IS NULL OR b.period<$4) LIMIT 1",[e.id,system,from,to]))bad('该生效范围已有确认工资，请通过更正流程处理，不能直接回填工资标准');
 const data={...(current?.data||{}),parameters,setup_rulebook_id:b.id,setup_rulebook_revision:b.revision};rows.push({...(assignment?{previous_scheme:await visibleBook(t,u,await boundBook(t,e,system,from,current)),scheme:await visibleBook(t,u,b)}:{}),employment_id:e.id,person_number:e.person_number,full_name:e.full_name,company_name:e.company_name,company_id:e.company_id,person_id:e.person_id,department_id:e.department_id,before,after:parameters,delta,head_id:h?.id||0,head_revision:h?.revision||0,rulebook_id:b.id,rulebook_hash:hash(b),assignment_hash:hash(e.assignment_snapshot),data});}return{group_id:group,system,valid_from:from,valid_to:to,evidence_ref:input.evidence_ref,rows};}
const publicPlan=p=>({rows:p.rows.map(({data,rulebook_hash,assignment_hash,...r})=>r),total:p.rows.length});
export async function previewProfiles(t,{userId,input,operationId}){await ready(t);return H.cmd(t,{userId,operationId,operation:'setup.profiles.preview',input,execute:async()=>{const plan=await prepare(t,userId,input),token=randomBytes(24).toString('hex'),row=await one(t,'INSERT INTO ty_pay_setup_preview(group_id,actor_id,token,request,plan,plan_hash)VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6)RETURNING id',[plan.group_id,userId,token,JSON.stringify(input),JSON.stringify(plan),hash(plan)]);return{id:row.id};},receipt:async r=>{const p=await one(t,'SELECT * FROM ty_pay_setup_preview WHERE id=$1',[r.id]);for(const row of p.plan.rows)await writePerson(t,userId,await scopeEmployment(t,row.employment_id));return{preview_id:p.id,token:p.token,...publicPlan(p.plan)};}});}

export async function saveProfiles(t,{userId,input,operationId}){await ready(t);const p=await one(t,'SELECT * FROM ty_pay_setup_preview WHERE id=$1 FOR UPDATE',[id(input.preview_id)]);if(!p||!same(p.actor_id,userId)||p.token!==input.token)deny('只能提交本人已核对的定薪预检');for(const r of p.plan.rows)await writePerson(t,userId,await scopeEmployment(t,r.employment_id));return H.cmd(t,{userId,operationId,operation:'setup.profiles.save',input,execute:async()=>{if(p.status==='saved')return{configs:p.result.configs};const now=await prepare(t,userId,p.request,{lock:true});if(hash(now)!==p.plan_hash)conflict('预检后人员、部门、工资标准或方案已变化，请重新预检');const configs=[];for(const r of now.rows){const out=await saveConfiguration(t,{userId,operationId:operationId+':'+r.employment_id,input:{company_id:r.company_id,employment_id:r.employment_id,kind:'profile',system:now.system,valid_from:now.valid_from,valid_to:now.valid_to||undefined,evidence_ref:now.evidence_ref,data:r.data}});configs.push({id:out.config.id,employment_id:r.employment_id,status:'draft',revision:out.config.revision});}await t.query("UPDATE ty_pay_setup_preview SET status='saved',result=$2::jsonb WHERE id=$1",[p.id,JSON.stringify({configs})]);return{configs};},receipt:async r=>({configs:r.configs,total:r.configs.length})});}
export async function approveProfiles(t,{userId,input,operationId}){await ready(t);if(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>200)bad('请选择1至200条待核工资档案');const ids=[...input.ids].sort((a,b)=>Number(a.id)-Number(b.id)),seen=new Set(),records=[];for(const r of ids){const c=await H.config(t,r.id);if(c.kind!=='profile'||!same(c.group_id,input.group_id)||seen.has(String(c.id)))bad('所选工资档案集团/种类不符或重复');seen.add(String(c.id));const e=await scopeEmployment(t,c.employment_id);if(!inEmploymentMonth(e,ymd(c.valid_from)))bad('待核工资生效月份已不在实际雇佣期间');if(!same((await head(t,e,c.system))?.id,c.id))conflict('工资档案已有新草稿或新版本，不能核准旧头');if(c.data.setup_rulebook_id)await book(t,e,c.system,ymd(c.valid_from),c.data.setup_rulebook_id);await readPerson(t,userId,e);await completeSalaryGrant(t,userId,'payroll_confirm','approve',e,['data','status']);if(await sameHuman(t,c.created_by,userId)||await humanIsPerson(t,userId,c.group_id,c.person_id))deny('工资档案须不同自然人复核且不能复核本人待遇');records.push({c,r});}
 return H.cmd(t,{userId,operationId,operation:'setup.profiles.approve',input,execute:async()=>{for(const co of [...new Set(records.map(x=>String(x.c.company_id)))].sort((a,b)=>Number(a)-Number(b)))await t.query('SELECT id FROM ty_company WHERE id=$1 FOR UPDATE',[co]);const configs=[];for(const{c,r}of records){const e=await scopeEmployment(t,c.employment_id);if(!inEmploymentMonth(e,ymd(c.valid_from)))bad('待核工资生效月份已不在实际雇佣期间');await readPerson(t,userId,e);await completeSalaryGrant(t,userId,'payroll_confirm','approve',e,['data','status']);if(!same((await head(t,e,c.system))?.id,c.id))conflict('工资档案已有新版本，请刷新待核列表');if(c.data.setup_rulebook_id)await book(t,e,c.system,ymd(c.valid_from),c.data.setup_rulebook_id);const out=await approveConfiguration(t,{userId,input:{id:c.id,expected_revision:r.expected_revision},operationId:operationId+':'+c.id});configs.push({id:out.config.id,employment_id:c.employment_id,status:'approved',revision:out.config.revision});}return{configs};},receipt:async r=>({configs:r.configs,total:r.configs.length})});}

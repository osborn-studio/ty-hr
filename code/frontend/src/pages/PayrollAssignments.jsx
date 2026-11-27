import React,{useState} from 'react';
import {Badge,Button,DataTable,ErrorState,Modal,Notice,PageHeading,useRemote} from '../components/UI.jsx';
import {BusinessTable,PrivateCommandFeedback,usePrivateCommands} from '../components/BusinessShared.jsx';
import PayrollFlow from '../components/PayrollFlow.jsx';
import {canRead} from '../domain.mjs';
import {PAYROLL_SYSTEMS} from '../payroll-model.mjs';
import {fieldLabel} from '../payroll-setup-model.mjs';

const query=(api,name,body,signal)=>api.request('/api/v2/query/'+name,{method:'POST',body,signal});
const date=value=>String(value||'').slice(0,10);
const label=scheme=>scheme?scheme.name+' · V'+scheme.revision:'未分配';

export default function PayrollAssignments({api,scope,scopeKey,session,notify,go}) {
 const [company,setCompany]=useState(''),[system,setSystem]=useState('CN_PAYROLL');
 const [month,setMonth]=useState(String(session.me.today).slice(0,7)),[search,setSearch]=useState(''),[q,setQuery]=useState('');
 const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(10),[selected,setSelected]=useState(new Map()),[dialog,setDialog]=useState(false),[picking,setPicking]=useState(false),[pickError,setPickError]=useState('');
 const filter={group_id:scope.group_id,company_id:company||undefined,scope_company_id:scope.company_id||undefined,ledger_id:scope.ledger_id||undefined,system,on:month+'-01',view:'profiles',assignment_view:true,q};
 const state=useRemote(signal=>query(api,'payroll.setup.workspace',{...filter,page,page_size:pageSize},signal),JSON.stringify([scopeKey,filter,page,pageSize]));
 const companies=useRemote(signal=>query(api,'payroll.native.workspace',{group_id:scope.group_id,company_id:scope.company_id||undefined,ledger_id:scope.ledger_id||undefined,view:'companies',page_size:200},signal),scopeKey);
 const commands=usePrivateCommands({api,session,notify,namespace:'payroll-assignment',onCompleted:result=>{if(result?.configs)state.reload();}});
 const change=fn=>{fn();setSelected(new Map());setPage(1);setPickError('');};
 const select=(row,checked)=>setSelected(old=>{
  const next=new Map(old);
  if(checked)next.set(String(row.employment_id),row);else next.delete(String(row.employment_id));
  return next;
 });
 const toggleable=(state.data?.rows||[]).filter(row=>company&&row.can_assign);
 async function selectAll(){
  setPicking(true);setPickError('');
  try{
   const first=await query(api,'payroll.setup.workspace',{...filter,page:1,page_size:100});
   if(first.total>200)throw new Error('一次最多选择200条雇佣，请缩小人员范围。');
   const rows=[...first.rows];
   if(first.total>100)rows.push(...(await query(api,'payroll.setup.workspace',{...filter,page:2,page_size:100})).rows);
   setSelected(new Map(rows.filter(row=>row.can_assign).map(row=>[String(row.employment_id),row])));
  }catch(error){setPickError(error.message);}finally{setPicking(false);}
 }
 const cols=[
  {key:'select',title:<input type="checkbox" aria-label="勾选本页可分配员工" disabled={!toggleable.length||picking}
   checked={toggleable.length>0&&toggleable.every(row=>selected.has(String(row.employment_id)))}
   onChange={e=>toggleable.forEach(row=>select(row,e.target.checked))}/>,
   render:row=><input type="checkbox" aria-label={'勾选 '+row.full_name} disabled={!company||!row.can_assign||picking} checked={selected.has(String(row.employment_id))} onChange={e=>select(row,e.target.checked)}/>},
  {key:'full_name',title:'员工',render:row=><span className="stacked-link"><b>{row.full_name}</b><small>{row.person_number} · 雇佣 #{row.employment_id}</small></span>},
  {key:'company_name',title:'公司 / 门店'},
  {key:'scheme',title:'当月已分配方案',render:row=>row.has_assigned_scheme?(row.scheme?label(row.scheme):'方案无当月版本或无查看权限'):'未显式分配'},
  {key:'draft_scheme',title:'待复核调整',render:row=>row.draft_profile_id?<Badge>{row.draft_scheme?label(row.draft_scheme):'工资档案待复核'}</Badge>:'—'},
  {key:'actions',title:'操作',render:row=>row.can_approve?<Button onClick={()=>go('payroll/setup/profiles')}>到工资档案复核</Button>:row.can_assign&&<Button disabled={picking} onClick={()=>{commands.clearError();setCompany(String(row.company_id));setSelected(new Map([[String(row.employment_id),row]]));setDialog(true);}}>分配方案</Button>},
 ];
 return <div className="payroll-setup">
  <PageHeading title="员工方案分配" description="查看每个人当月使用的方案。选择一家门店，或直接从员工行开始分配。" />
  <PayrollFlow section="assign" go={go} canConfigure={canRead(session.capabilities,'payroll_config')} />
  <PrivateCommandFeedback commands={commands}/>
  <form className="setup-selection" onSubmit={e=>{e.preventDefault();change(()=>setQuery(search));}}>
   <label>公司 / 门店<select value={company} disabled={picking} onChange={e=>change(()=>setCompany(e.target.value))}>
    <option value="">全部授权公司 / 门店</option>
    {(companies.data?.rows||[]).map(row=><option value={row.id} key={row.id}>{row.name}</option>)}
   </select></label>
   <label>算薪体系<select value={system} disabled={picking} onChange={e=>change(()=>setSystem(e.target.value))}>
    {PAYROLL_SYSTEMS.map(([id,name])=><option key={id} value={id}>{name}</option>)}
   </select></label>
   <label>生效月份<input type="month" required value={month} disabled={picking} onChange={e=>{if(e.target.value)change(()=>setMonth(e.target.value));}}/></label>
   <label>查找员工<input type="search" disabled={picking} value={search} onChange={e=>setSearch(e.target.value)} placeholder="姓名、永久编号、门店"/></label>
   <Button type="submit" disabled={picking}>查询</Button>
  </form>
  {companies.error&&<ErrorState error={companies.error} retry={companies.reload}/>}
  <section className="panel">
   <div className="setup-people-summary">
    <span>已选 {selected.size} 人</span>
    <Button disabled={!company||!state.data?.total} busy={picking} onClick={selectAll}>选择本店全部匹配人员</Button>
    <Button disabled={!selected.size||picking} onClick={()=>setSelected(new Map())}>清空</Button>
    <Button variant="primary" disabled={!selected.size||picking} onClick={()=>{commands.clearError();setDialog(true);}}>给所选人员分配方案</Button>
   </div>
   {pickError&&<Notice tone="danger">{pickError}</Notice>}
   <BusinessTable state={state} columns={cols} page={page} pageSize={pageSize} setPage={setPage} setPageSize={setPageSize}/>
  </section>
  {dialog&&<AssignDialog {...{api,company,system,month,scope,commands}} rows={[...selected.values()]}
    onClose={()=>setDialog(false)} onSaved={()=>{setDialog(false);setSelected(new Map());}}/>}
 </div>;
}

function AssignDialog({api,company,system,month,scope,commands,rows,onClose,onSaved}){
 const [book,setBook]=useState(''),[reason,setReason]=useState(''),[preview,setPreview]=useState(null),[values,setValues]=useState({}),[error,setError]=useState('');
 const base={group_id:scope.group_id,company_id:company,system,on:month+'-01'};
 const books=useRemote(async signal=>{
  const result=await query(api,'payroll.setup.workspace',{...base,view:'rulebooks',page_size:200},signal);
  const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10);
  const seen=new Set();
  return result.rows.filter(row=>{
   if(String(row.company_id)!==company||date(row.valid_from)>base.on||row.valid_to&&date(row.valid_to)<end||seen.has(row.stable_key))return false;
   seen.add(row.stable_key);return true;
  });
 },JSON.stringify(base));
 const fields=useRemote(async signal=>{
  if(!book)return {};
  return (await query(api,'payroll.setup.workspace',{...base,view:'fields',employment_ids:rows.map(row=>row.employment_id),rulebook_id:book},signal)).fields_by_employment;
 },JSON.stringify([base,book,rows.map(row=>row.employment_id)]));
 const missing=rows.flatMap(row=>(fields.data?.[row.employment_id]||[]).filter(f=>!f.locked&&row.parameters?.[f.key]?.unit!==f.unit).map(field=>({row,field})));
 async function check(event){
  event.preventDefault();setError('');
  const items=rows.map(row=>({employment_id:row.employment_id,expected_head_id:row.head_id,parameters:{}}));
  for(const {row,field} of missing){
   const value=values[row.employment_id+':'+field.key]?.trim();
   if(!value){setError('请填写 '+row.full_name+' 的 '+fieldLabel(field));return;}
   items.find(item=>String(item.employment_id)===String(row.employment_id)).parameters[field.key]={value,unit:field.unit};
  }
  const result=await commands.run('payroll.setup.profiles.preview',{...base,valid_from:base.on,
   assign_scheme:true,rulebook_id:book,evidence_ref:reason.trim(),rows:items});
  if(result)setPreview(result.result);
 }
 async function save(){
  const result=await commands.run('payroll.setup.profiles.save',{preview_id:preview.preview_id,token:preview.token});
  if(result)onSaved();
 }
 return <Modal wide title={'分配工资方案 · '+rows.length+' 人'} onClose={()=>!commands.busy&&onClose()}>
  <p>{rows[0]?.company_name}　{month} 生效</p>
  {(error||commands.error)&&<Notice tone="danger">{error||commands.error.message}</Notice>}
  {books.error&&<ErrorState error={books.error} retry={books.reload}/>}
  {fields.error&&<ErrorState error={fields.error} retry={fields.reload}/>}
  {preview?<><DataTable searchable={false} rows={preview.rows} getKey={row=>row.employment_id} columns={[
   {key:'full_name',title:'员工'},{key:'old',title:'当前方案',render:row=>label(row.previous_scheme)},
   {key:'new',title:'拟分配方案',render:row=>label(row.scheme)},
   {key:'added',title:'本次补录的工资参数',render:row=>Object.keys(row.delta||{}).length?Object.keys(row.delta).map(key=>fieldLabel((fields.data?.[row.employment_id]||[]).find(field=>field.key===key)||{key})).join('、'):'沿用适用的现行参数'}
  ]}/><div className="modal-actions"><Button disabled={commands.busy} onClick={()=>setPreview(null)}>返回修改</Button><Button variant="primary" busy={commands.busy} onClick={save}>确认并提交复核</Button></div></>:
  <form className="business-form" onSubmit={check}>
   <div className="form-fields">
    <label>选择已发布工资方案<select required value={book} onChange={e=>{setBook(e.target.value);setValues({});}}>
     <option value="">请选择</option>{(books.data||[]).map(row=><option key={row.id} value={row.id}>{row.data?.name||row.stable_key} · V{row.revision}</option>)}
    </select></label>
    <label>分配依据<input required minLength={4} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   </div>
   {books.data?.length===0&&<Notice>该门店本月没有已发布方案。请先建立或复制方案，再复核发布。</Notice>}
   {missing.length>0&&<><Notice>新方案还需要以下工资参数。确认后随方案一并提交复核。</Notice>
    <DataTable searchable={false} rows={missing} getKey={({row,field})=>row.employment_id+':'+field.key} columns={[
     {key:'name',title:'员工',render:({row})=>row.full_name},{key:'field',title:'工资参数',render:({field})=>fieldLabel(field)},
     {key:'value',title:'标准值',render:({row,field})=>{const key=row.employment_id+':'+field.key;return <input aria-label={row.full_name+' '+fieldLabel(field)} required inputMode="decimal" value={values[key]||''} onChange={e=>setValues(old=>({...old,[key]:e.target.value}))}/>;}}
    ]}/>
   </>}
   <div className="modal-actions"><Button onClick={onClose} disabled={commands.busy}>关闭</Button><Button type="submit" variant="primary" busy={commands.busy} disabled={!book||fields.loading||!fields.data}>预检方案变更</Button></div>
  </form>}
 </Modal>;
}

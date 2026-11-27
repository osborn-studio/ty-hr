import React,{useState} from 'react';
import {Button,Modal,Notice} from './UI.jsx';

export default function PayrollSchemeCopy({source,companies,scope,commands,onClose}) {
 const [targets,setTargets]=useState([]),[search,setSearch]=useState('');
 const [name,setName]=useState((source.data?.name||source.stable_key)+' 副本');
 const [month,setMonth]=useState(String(source.valid_from||'').slice(0,7));
 const [reason,setReason]=useState('');
 async function submit(event){
  event.preventDefault();
  const result=await commands.run('payroll.setup.schemes.copy',{
   group_id:scope.group_id,source_id:source.id,company_ids:targets,name,
   valid_from:month+'-01',evidence_ref:reason.trim()
  });
  if(result)onClose();
 }
 return <Modal title="批量复制工资方案" wide onClose={()=>!commands.busy&&onClose()}>
  <form className="business-form" onSubmit={submit}>
   <p><b>{source.data?.name||source.stable_key} · V{source.revision}</b>　{source.company_name}</p>
   <Notice>项目、公式和取数规则复制为各门店的独立草稿。请核对目标门店的适用条件，再由另一位有权限的人员发布。</Notice>
   {commands.error&&<Notice tone="danger">{commands.error.message}</Notice>}
   <div className="form-fields">
    <label>新方案名称<input required minLength={2} maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>生效月份<input type="month" required value={month} onChange={e=>setMonth(e.target.value)}/></label>
    <label>目标门店筛选<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="输入公司或门店名称"/></label>
    <label>核定依据<input required minLength={4} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   </div>
   <fieldset className="payroll-copy-targets"><legend>选择目标公司 / 门店</legend>
    {companies.filter(c=>String(c.name).includes(search.trim())).map(c=><label className="checkbox" key={c.id}>
     <input type="checkbox" checked={targets.includes(c.id)} onChange={e=>setTargets(old=>e.target.checked?[...old,c.id]:old.filter(id=>id!==c.id))}/>{c.name}
    </label>)}
   </fieldset>
   <div className="modal-actions"><Button onClick={onClose} disabled={commands.busy}>关闭</Button><Button type="submit" variant="primary" busy={commands.busy} disabled={!targets.length}>复制到 {targets.length} 家</Button></div>
  </form>
 </Modal>;
}

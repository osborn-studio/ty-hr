import React,{useState} from 'react';
import {Button} from '../UI.jsx';

function MultiChoice({label,options,selection,onChange,searchLabel}) {
 const [query,setQuery]=useState('');
 const filtered=options.filter(option=>option.label.toLowerCase().includes(query.trim().toLowerCase()));
 return <details className="roster-filter-picker">
  <summary>{label} <strong>{selection.length?(`已选 ${selection.length}`):'全部'}</strong></summary>
  <div className="roster-filter-dropdown">
   <input type="search" aria-label={searchLabel} placeholder={searchLabel} value={query} onChange={event=>setQuery(event.target.value)}/>
   <div className="roster-filter-options">
    {filtered.map(({id,label:name})=><label className="checkbox" key={id}>
     <input type="checkbox" checked={selection.includes(id)} onChange={event=>onChange(event.target.checked?[...selection,id]:selection.filter(value=>value!==id))}/>
     {name}
    </label>)}
    {!filtered.length&&<span className="subtle">当前没有匹配的选项</span>}
   </div>
   <Button disabled={!selection.length} onClick={()=>onChange([])}>清空选择</Button>
  </div>
 </details>;
}
export default function RosterFilters({stores,storeOptions,onStores,people,peopleOptions,onPeople,calendarView,onJump}) {
 const [time,setTime]=useState('09:00');
 return <div className="time-toolbar roster-scope-toolbar">
  <MultiChoice label="工作门店" searchLabel="查找公司或门店" selection={stores} onChange={onStores}
   options={storeOptions.map(row=>({id:String(row.id),label:row.name}))}/>
  <MultiChoice label="排班人员" searchLabel="查找姓名或永久编号" selection={people} onChange={onPeople}
   options={peopleOptions.filter(row=>row.employment_id&&(row.full_name||row.person_number)).map(row=>({id:String(row.employment_id),label:[row.full_name,row.person_number,row.home_company_name].filter(Boolean).join(' · ')}))}/>
  {calendarView==='day'&&<form className="inline-filters" onSubmit={event=>{event.preventDefault();if(time)onJump(time);}}>
   <label>定位时间<input type="time" aria-label="排班定位时间" required value={time} onChange={event=>setTime(event.target.value)}/></label>
   <Button type="submit">跳到时间</Button>
  </form>}
 </div>;
}

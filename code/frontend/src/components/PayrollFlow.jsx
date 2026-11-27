import React from 'react';

export default function PayrollFlow({section,go,canConfigure=true,canAssign=true}) {
 const steps=[
  ['items','工资项目','定义基本工资、津贴与扣款',canConfigure],
  ['schemes','工资方案与公式','组合项目、设公式、试算和发布',canConfigure],
  ['assign','员工方案分配','按门店或员工指定已发布方案',canAssign],
  ['profiles','员工工资档案','修改金额、Excel 导入与复核',canAssign],
 ];
 return <nav className="payroll-flow" aria-label="薪酬配置流程">
  {steps.filter(([, , ,visible])=>visible).map(([id,title,subtitle])=><button
    type="button" key={id} aria-current={section===id?'step':undefined}
    onClick={()=>go('payroll/setup/'+id)}>
   <strong>{title}</strong><small>{subtitle}</small>
  </button>)}
 </nav>;
}

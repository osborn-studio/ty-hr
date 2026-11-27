// A source-bound minimum-wage review is an approved salary parameter, never an
// assertion that a monthly-paid worker is exempt or that missing hours are zero.
import {one,q,bad,text,same} from './platform-core.mjs';
import {amount,plus,minus,times,over,compare,fraction,sum} from '../payroll-calculations.mjs';
import {standardPack} from '../payroll-standard-packs.mjs';

const ceilMoney=value=>{const f=fraction(value),n=BigInt(f.numerator)*100n,d=BigInt(f.denominator);if(n<0n)bad('工资保障金额不得为负');const c=(n+d-1n)/d;return `${c/100n}.${String(c%100n).padStart(2,'0')}`;};
function reviewed(d){if(!d||d.coverage!==true||d.classification_verified!==true)bad('最低工资适用范围及非工作时间给薪分类待核，月薪制不等于豁免');text(d.evidence_ref,'工资保障核定依据',4);if(d.non_working_cash==null||d.other_work_minutes==null||compare(d.non_working_cash,'0')<0||compare(d.other_work_minutes,'0')<0)bad('非工作时间给薪与其他受指示工作分钟须明确核定，未知不能当0');}
export function hongKongMinimumReview({time,period,classification}){
 reviewed(classification);const pack=standardPack('HK_SMW_20260501',period);
 if(!time||time.values.worked_minutes==null||time.values.overtime_minutes==null)bad('最低工资所需工时仍未知：请HR核实原卡或导入有据核勤新版本、独立确认后重算');
 const minutes=plus(plus(time.values.worked_minutes,time.values.overtime_minutes),classification.other_work_minutes);
 const working=over(times(minutes,pack.parameters.hourly_rate),'60'),required=ceilMoney(plus(working,classification.non_working_cash));
 return {kind:'HK_SMW',state:'reviewed',coverage:true,classification_verified:true,report_id:time.id,root_id:time.root_id,head_revision:time.head_revision,time_source_hash:time.hash,working_minutes:amount(minutes),other_work_minutes:String(classification.other_work_minutes),non_working_cash:amount(classification.non_working_cash),hourly_rate:pack.parameters.hourly_rate,required_total_cash:required,rounding:'ceil_total_to_cent_more_protective_enterprise_choice',evidence_ref:classification.evidence_ref,official_pack:pack.id,source_urls:pack.source_urls};
}
export async function minimumWageBasis(t,{userId,input}){
 const {payrollInternals:H}=await import('./payroll-source.mjs'),e=await H.employment(t,input.employment_id),c=await H.company(t,e.company_id),period=H.period(input.period);
 const assignment=await one(t,"SELECT department_id FROM ty_position_assignment WHERE employment_id=$1 AND is_primary AND status='active'AND valid_from<=app_today()AND(valid_to IS NULL OR valid_to>app_today())ORDER BY id LIMIT 1",[e.id]);e.department_id=assignment?.department_id;
 await H.access(t,userId,'payroll_sources','read',e,['data','amount','sources']);await(await import('./payroll-setup.mjs')).salaryGrantIfInstalled(t,userId,'payroll_sources','read',e,['data','amount','sources']);
 const locale=await one(t,'SELECT*FROM fn_ty_company_locale($1)',[c.id]);if(!['HK','CN'].includes(locale.region_code))bad('此地区工资保障核验尚未配置');if(locale.currency_code!==(locale.region_code==='HK'?'HKD':'CNY'))bad('工资保障适用地区与币种配置不一致');
 const system=locale.region_code==='HK'?'HK_PAYROLL':'CN_PAYROLL';
 const time=await H.timeSource(t,userId,{group_id:e.group_id,company_id:e.company_id,period,system},e,input.report_id);
 const basis=system==='HK_PAYROLL'?hongKongMinimumReview({time,period,classification:input.classification}):shanghaiMonthlyMinimumReview({time,period,classification:input.classification,employment:e,company:c});
 return {basis,approval_state:'candidate_requires_independent_salary_profile_approval',creates_payment:false};
}
// Exposes the already installed Shanghai monthly policy through the same review
// workflow. A CN location alone never supplies qualification or unknown hours.
export function shanghaiMonthlyMinimumReview({time,period,classification,employment,company}){
 if(period<'2025-07-01'||!String(company?.address||'').includes('上海'))bad('此核验仅支持已配置的上海月最低工资，请先明确实际工作地区');
 if(classification?.full_normal_month_qualification!==true)bad('须独立核实上海整月正常劳动资格，未知不能视为符合');
 if(!['FT','full_time'].includes(employment?.employment_type))bad('上海月标准须明确全日制资格，其他用工方式另行核定');
 const asDay=v=>String(v instanceof Date?v.toISOString():v).slice(0,10),end=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),0)).toISOString().slice(0,10);
 if(asDay(employment.hire_date)>period||employment.leave_date&&asDay(employment.leave_date)<end)bad('本月雇佣不覆盖整月，请按实际资格另行核定');
 if(!time||time.values.worked_minutes==null)bad('本月正常劳动核勤仍待核，请先核对并独立确认本人的考勤');
 text(classification.evidence_ref,'上海整月正常劳动核定依据',4);
 return{kind:'CN_SHANGHAI_MONTHLY',state:'reviewed',locality:'上海市',monthly_minimum:'2740',required_total_cash:'2740.00',full_normal_month_qualification:true,period,report_id:time.id,root_id:time.root_id,head_revision:time.head_revision,time_source_hash:time.hash,evidence_ref:classification.evidence_ref,source_urls:['https://rsj.sh.gov.cn/tgzfl_17732/20250714/t0035_1434097.html']};
}
export async function assertMinimumWageReviews(t,{batch,rule,employees,lines}){
 if(rule.data.minimum_wage_review_required!==true&&!employees.some(x=>x.relationship?.data.minimum_wage_standard))return;
 for(const {e,profile,time} of employees){const review=profile.config.data.minimum_wage_review;
  if(!review||review.state!=='reviewed')bad('本人工资保障核验待处理：请更新参数并由另一有权人员核准');
  const own=lines.filter(l=>same(l.scope.employment_id,e.id));
  if(batch.system==='HK_PAYROLL'){
   const computed=hongKongMinimumReview({time,period:String(batch.period instanceof Date?batch.period.toISOString():batch.period).slice(0,10),classification:review});
   for(const key of ['report_id','root_id','head_revision','time_source_hash','required_total_cash'])if(String(computed[key])!==String(review[key]))bad('工资保障核验所依核勤头、分钟或金额已变化，请重新取得基线并独立复核参数');
   const guaranteed=profile.config.data.parameters.minimum_guard;if(!guaranteed||compare(guaranteed.value,computed.required_total_cash)!==0)bad('最低工资保障参数不等于来源核验结果');
   const cash=sum(own.filter(l=>l.source_domain==='payroll_calculation'&&l.category==='cash_earnings').map(l=>l.target));
   if(compare(cash,computed.required_total_cash)<0)bad('本次固定保证工资低于已核工作时数及非工作时间给薪保障，请调整补足项目后重算');
  }else{
   if(review.kind!=='CN_SHANGHAI_MONTHLY'||review.locality!=='上海市'||review.monthly_minimum!=='2740'||review.full_normal_month_qualification!==true)bad('上海整月正常劳动最低工资资格及适用地区待核');text(review.evidence_ref,'最低工资资格及来源',4);
   if(profile.config.data.setup_rulebook_id&&!review.report_id)bad('新工资档案须通过工资保障核验绑定本人的当前已核考勤');
   if(review.report_id){const computed=shanghaiMonthlyMinimumReview({time,period:String(batch.period instanceof Date?batch.period.toISOString():batch.period).slice(0,10),classification:review,employment:e,company:await one(t,'SELECT address FROM ty_company WHERE id=$1',[e.company_id])});for(const key of['period','report_id','root_id','head_revision','time_source_hash'])if(String(review[key])!==String(computed[key]))bad('正常劳动资格所依工资月或考勤已变化，请重新核验工资保障');}
   const company=await one(t,'SELECT name,address FROM ty_company WHERE id=$1',[e.company_id]);if(!String(company?.address||'').includes('上海'))bad('上海标准不能由CN地区推断，须有明确本地公司地点');
   const eligible=sum(own.filter(l=>['BASIC_MONTHLY','POSITION_ALLOWANCE','CN_MIN_WAGE_TOPUP'].includes(l.code)).map(l=>l.target)),personal=sum(own.filter(l=>['CN_EMP_PENSION','CN_EMP_MEDICAL','CN_EMP_UNEMPLOYMENT','CN_EMP_HOUSING_FUND'].includes(l.code)).map(l=>l.target));
   if(compare(minus(eligible,personal),review.monthly_minimum)<0)bad('上海月最低工资不得把个人社保公积金、餐费交通津贴计入保障，请调整正常工资或补足后重算');
  }
 }
}

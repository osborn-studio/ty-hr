// Independent payroll setup integration/security review. Never uses a persistent demo DB.
import assert from'node:assert/strict';
import{createDb,withTx}from'../app/db.mjs';
import * as setup from'../app/services/payroll-setup.mjs';
import * as pay from'../app/services/payroll-source.mjs';
import{setupReviewFixture}from'./payroll-setup-review-fixture.mjs';
if(process.env.PGLITE_DATA_DIR||process.env.CONTROL_URL)throw Error('Persistent/control data forbidden');
if(process.env.DATABASE_URL){const u=new URL(process.env.DATABASE_URL);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||!/^\/tyhr_verify_[a-f0-9]{16}$/.test(u.pathname))throw Error('Runner owned empty PG only');}
const db=await createDb({url:process.env.DATABASE_URL||undefined});let checks=0;
const check=(name,v=true)=>{assert.ok(v,name);checks++;console.log('PASS '+name);};
try{
 const{one,run,cfg,grant,managed,relations}=await setupReviewFixture(db);
 const reject=async(name,fn,re=/E_TY_FORBIDDEN|独立|另一|不属于|已变化|重新预检|完整授权|工资档案|规则|方案|拒绝/)=>{await assert.rejects(fn,e=>re.test(e.message),name);check(name);};
 const query=(u,input={})=>withTx(db,t=>setup.setupWorkspace(t,{userId:u,input:{group_id:44900,company_id:44900,system:'CN_PAYROLL',on:'2026-11-01',...input}}));
 const item=(await run(setup.saveItem,{group_id:44900,display_code:'SERVICE_REWARD',name:'服务技能津贴',system:'CN_PAYROLL',category:'cash_earnings',unit:'currency_amount',evidence_ref:'服务技能津贴独立制度依据'})).item;
 check('new customer item is a draft rather than a preinstalled catalogue choice',item.status==='draft'&&item.code.startsWith('CUST_G44900_'));
 await reject('item author cannot independently publish own definition',()=>run(setup.approveItem,{id:item.id,expected_revision:1}),/另一|独立|人员/);
 await run(setup.approveItem,{id:item.id,expected_revision:1},44901);
 const deduction=(await run(setup.saveItem,{group_id:44900,display_code:'PROPERTY_FEE',name:'物品费用扣款',system:'COMMON',category:'personal_deduction',unit:'currency_amount',evidence_ref:'扣款性质独立核验依据'})).item;await run(setup.approveItem,{id:deduction.id,expected_revision:1},44901);
 check('ordinary custom deduction lowers net and never masquerades as leave gross reduction',(await one('SELECT metadata FROM ty_pay_item_catalog WHERE code=$1',[deduction.code])).metadata.employee_cash_wage_effect==='decrease_net');
 let foreign;try{foreign=await query(44900,{view:'items',group_id:44901,company_id:44902});}catch(e){assert.match(e.message,/E_TY_FORBIDDEN/);foreign={rows:[]};}check('a different tenant cannot see the custom code or infer it through catalogue rows',!foreign.rows.some(r=>r.code===item.code));
 const rule={inputs:{monthly:{unit:'currency_amount',source:'profile',key:'monthly'},skill:{unit:'currency_amount',source:'profile',key:'skill_amount'}},rules:[{code:'BASIC_MONTHLY',formula:'monthly',unit:'currency_amount',wage_tags:{hk_adw:'include',cn_average:'include',cn_annual_leave:'include',ordinary_wage:'include'}},{code:item.code,formula:'skill',unit:'currency_amount',wage_tags:{hk_adw:'include',cn_average:'include',cn_annual_leave:'include',ordinary_wage:'include'}}],statutory_requirements:[],calculation_authority:'external_reviewed_components',notice:'Independent isolated behavior fixture, not live tax law'};
 const book=await cfg('rulebook',44900,'CN_PAYROLL',rule),otherBook=await cfg('rulebook',44901,'CN_PAYROLL',rule);
 const params=(monthly='5000',skill='125.50')=>({monthly:{value:monthly,unit:'currency_amount'},skill_amount:{value:skill,unit:'currency_amount'}});
 const input=(rows,extra={})=>({group_id:44900,system:'CN_PAYROLL',rulebook_id:book.id,valid_from:'2026-10-01',valid_to:'2027-01-01',evidence_ref:'岗位标准与生效日期独立核验',rows,...extra});
 const initial=input([44900,44901].map(employment_id=>({employment_id,expected_head_id:0,mode:'set',parameters:params()})));
 const pre=await run(setup.previewProfiles,initial);check('preview preserves wages and creates no employee salary versions',Number((await one("SELECT count(*)n FROM ty_pay_config WHERE kind='profile'")).n)===0&&pre.total===2);
 const saved=await run(setup.saveProfiles,{preview_id:pre.preview_id,token:pre.token},44900,'SETUP-REVIEW-SAVE-EXACT');check('bulk submit creates two native draft salary versions',saved.configs.length===2&&saved.configs.every(r=>r.status==='draft'));
 const profileCount=Number((await one("SELECT count(*)n FROM ty_pay_config WHERE kind='profile'")).n);await run(setup.saveProfiles,{preview_id:pre.preview_id,token:pre.token},44900,'SETUP-REVIEW-SAVE-EXACT');check('retrying the same batch cannot append or reapply salary increases',Number((await one("SELECT count(*)n FROM ty_pay_config WHERE kind='profile'")).n)===profileCount);
 await reject('salary author cannot approve any part of own batch',()=>run(setup.approveProfiles,{group_id:44900,ids:saved.configs.map(r=>({id:r.id,expected_revision:r.revision}))}),/不同人员|自然人|另一|人员|独立/);
 await run(setup.approveProfiles,{group_id:44900,ids:saved.configs.map(r=>({id:r.id,expected_revision:r.revision}))},44901);
 check('bulk approval enters the original native salary source chain',Number((await one("SELECT count(*)n FROM ty_pay_config WHERE kind='profile'AND status='approved'")).n)===2);
 const batch=(await run(pay.createBatch,{company_id:44900,system:'CN_PAYROLL',rulebook_id:book.id,relationship_config_id:relations[44900].id,period:'2026-10',kind:'regular',label:'静安门店10月工资'})).batch;
 const preview=(await run(pay.previewSources,{batch_id:batch.id,expected_revision:batch.revision,employments:saved.configs.map(c=>({employment_id:c.employment_id,profile_id:c.id})),sources:[]})).preview;
 check('custom configured salary really enters original payroll calculation',preview.planned.lines.filter(l=>l.code===item.code).length===2&&preview.planned.lines.filter(l=>l.code===item.code).every(l=>l.target==='125.50'));
 await run(pay.reviewPreview,{id:preview.id,review_ref:'原生工资项目与定薪结果独立复核'},44901);await run(pay.adoptPreview,{id:preview.id});await run(pay.confirmBatch,{id:batch.id,expected_revision:batch.revision},44901);
 const original=await one('SELECT totals FROM ty_pay_row WHERE batch_id=$1 AND employment_id=44900',[batch.id]);check('original confirmed paycheck reflects base plus new custom item',original.totals.cash_gross==='5125.50');
 const heads=Object.fromEntries(saved.configs.map(c=>[c.employment_id,c.id]));
 const future=input([{employment_id:44900,expected_head_id:heads[44900],mode:'percent',parameters:{monthly:{value:'1.25',unit:'currency_amount'}}}],{valid_from:'2026-11-01'});
 const raised=await run(setup.previewProfiles,future);check('percentage increase uses exact old value and exposes a genuine delta',raised.rows[0].after.monthly.value==='5062.50'&&raised.rows[0].delta.monthly==='62.50');
 check('new preview and future salary do not overwrite confirmed October',(await one('SELECT totals FROM ty_pay_row WHERE batch_id=$1 AND employment_id=44900',[batch.id])).totals.cash_gross==='5125.50');
 const alternate=await cfg('rulebook',44900,'CN_PAYROLL',rule,{stable_key:'INDEPENDENT-ALTERNATE-PLAN'});
 const alternateBatch=(await run(pay.createBatch,{company_id:44900,system:'CN_PAYROLL',rulebook_id:alternate.id,relationship_config_id:relations[44900].id,period:'2026-11',kind:'regular',label:'另一个方案的11月工资'})).batch;
 await reject('a salary configured for plan A cannot silently feed a different payroll plan B',()=>run(pay.previewSources,{batch_id:alternateBatch.id,expected_revision:alternateBatch.revision,employments:[{employment_id:44900,profile_id:saved.configs.find(c=>String(c.employment_id)==='44900').id}],sources:[]}),/方案|不符|绑定/);

 for(const res of['payroll_slips_read_all','payroll_sources','payroll_confirm'])await managed(44902,res);
 await grant(44902,'payroll_slips_read_all',['read'],{departments:[44900]});await grant(44902,'payroll_sources',['write'],{departments:[44900]});
 const dept=await query(44902,{view:'profiles'});check('department salary view includes only authorized front-of-house employee before pagination and count',dept.total===1&&String(dept.rows[0].employment_id)==='44900');
 check('hidden back-of-house name cannot act as a salary count oracle',(await query(44902,{view:'profiles',q:'宋晚晴'})).total===0);
 await reject('department operator cannot preview a hidden employee',()=>run(setup.previewProfiles,input([{employment_id:44901,expected_head_id:heads[44901],parameters:params()}],{valid_from:'2026-11-01'}),44902),/E_TY_FORBIDDEN/);
 for(const res of['payroll_slips_read_all','payroll_sources'])await managed(44903,res);
 await grant(44903,'payroll_slips_read_all',['read']);await grant(44903,'payroll_sources',['write'],{fields:['data']});await grant(44903,'payroll_sources',['write'],{fields:['evidence_ref']});
 await reject('separate incomplete field grants cannot be combined to change salary',()=>run(setup.previewProfiles,future,44903),/完整授权|E_TY_FORBIDDEN/);
 await grant(44904,'payroll_slips_read_all',['read'],{deny:['data','amount']});check('salary fields denied means no raw profile amount or hidden-name search leak',(await query(44904,{view:'profiles'})).total===0);


 await grant(44907,'payroll_slips_read_all',['read'],{departments:[44900]});await grant(44907,'payroll_confirm',['approve'],{departments:[44900]});
 const departmentPositive=await withTx(db,async t=>{await t.query('SAVEPOINT department_positive');try{const p=await setup.previewProfiles(t,{userId:44902,input:future,operationId:'SETUP-DEPARTMENT-POSITIVE-PREVIEW'}),saved=await setup.saveProfiles(t,{userId:44902,input:{preview_id:p.preview_id,token:p.token},operationId:'SETUP-DEPARTMENT-POSITIVE-SAVE'}),approved=await setup.approveProfiles(t,{userId:44907,input:{group_id:44900,ids:saved.configs.map(c=>({id:c.id,expected_revision:c.revision}))},operationId:'SETUP-DEPARTMENT-POSITIVE-APPROVE'});return approved.configs.every(c=>c.status==='approved');}finally{await t.query('ROLLBACK TO SAVEPOINT department_positive');await t.query('RELEASE SAVEPOINT department_positive');}});
 check('department-only complete grants can truly save and independently approve through native payroll configuration',departmentPositive);
 const deniedNative=async fn=>withTx(db,async t=>{await t.query('SAVEPOINT native_nested_deny');try{await fn(t);return false;}catch(e){assert.match(e.message,/E_TY_FORBIDDEN/);return true;}finally{await t.query('ROLLBACK TO SAVEPOINT native_nested_deny');await t.query('RELEASE SAVEPOINT native_nested_deny');}});
 await grant(44908,'payroll_sources',['write'],{deny:['data.parameters.monthly']});await grant(44908,'payroll_slips_read_all',['read']);
 const directWriteDenied=await deniedNative(t=>pay.saveConfiguration(t,{userId:44908,operationId:'SETUP-NATIVE-WRITE-DENY',input:{kind:'profile',company_id:44900,employment_id:44900,system:'CN_PAYROLL',valid_from:'2026-11-01',valid_to:'2027-01-01',data:{parameters:params('6000')},evidence_ref:'原生工资接口嵌套字段拒绝核验'}}));
 check('a write-only nested salary deny cannot bypass setup through the old native profile API',directWriteDenied);
 await grant(44909,'payroll_confirm',['approve'],{deny:['data.parameters.monthly']});await grant(44909,'payroll_slips_read_all',['read']);
 const directApproveDenied=await deniedNative(async t=>{const d=(await pay.saveConfiguration(t,{userId:44900,operationId:'SETUP-NATIVE-APPROVE-DRAFT',input:{kind:'profile',company_id:44900,employment_id:44900,system:'CN_PAYROLL',valid_from:'2026-11-01',valid_to:'2027-01-01',data:{parameters:params('6000')},evidence_ref:'原生工资核准接口嵌套字段拒绝核验'}})).config;return pay.approveConfiguration(t,{userId:44909,operationId:'SETUP-NATIVE-APPROVE-DENY',input:{id:d.id,expected_revision:d.revision}});});
 check('an approve-only nested salary deny cannot bypass setup through native approval',directApproveDenied);
 const nested=[];for(const[user,denied]of[[44905,'data.parameters.monthly'],[44906,'parameters.monthly']]){
  await grant(user,'payroll_slips_read_all',['read'],{deny:[denied]});await grant(user,'payroll_sources',['write']);
  const visible=await query(user,{view:'profiles'}),fields=await query(user,{view:'fields',employment_id:44900,rulebook_id:book.id});let pre=null,deniedPreview=false;try{pre=await run(setup.previewProfiles,future,user);}catch(e){assert.match(e.message,/E_TY_FORBIDDEN/);deniedPreview=true;}
  nested.push({denied,profileHidden:visible.total===0,fieldSchemaHidden:fields.total===0,previewDenied:deniedPreview,rawMonthlyLeak:!!visible.rows.some(r=>r.parameters?.monthly||r.draft_parameters?.monthly),aliasPreviewLeak:!!pre?.rows?.some(r=>r.before?.monthly||r.after?.monthly||r.delta?.monthly)});
 }
 console.log('NESTED_FIELD_PROBE '+JSON.stringify(nested));
 for(const n of nested){check('nested salary deny '+n.denied+' hides raw salary row and alias previews',n.profileHidden&&n.fieldSchemaHidden&&n.previewDenied&&!n.rawMonthlyLeak&&!n.aliasPreviewLeak);}
 const authorizedPre=await run(setup.previewProfiles,future,44902);await db.query("UPDATE ty_auth_grant SET status='revoked'WHERE account_id=44902 AND resource='payroll_sources'");
 await reject('revocation after preview prevents save and reveals no monetary receipt',()=>run(setup.saveProfiles,{preview_id:authorizedPre.preview_id,token:authorizedPre.token},44902),/E_TY_FORBIDDEN/);
 const beforeDepartment=await run(setup.previewProfiles,future);await db.query("UPDATE ty_position_assignment SET valid_to='2026-11-01',status='ended'WHERE employment_id=44900 AND status='active'");await db.query("INSERT INTO ty_position_assignment(group_id,company_id,employment_id,department_id,position_id,valid_from,status)VALUES(44900,44900,44900,44901,44901,'2026-11-01','active')");
 await reject('personnel department change after preview requires a fresh preview even for a full operator',()=>run(setup.saveProfiles,{preview_id:beforeDepartment.preview_id,token:beforeDepartment.token}),/已变化|重新预检/);
 const otherInput=input([{employment_id:44902,expected_head_id:0,parameters:params()}],{valid_from:'2026-11-01',rulebook_id:otherBook.id});const multi=await run(setup.previewProfiles,otherInput);check('one permanent person can have a separate salary in another real employment',multi.total===1&&String(multi.rows[0].employment_id)==='44902');

 const beforeBookChange=await run(setup.previewProfiles,future);
 await cfg('rulebook',44900,'CN_PAYROLL',rule,{stable_key:book.stable_key,valid_from:'2026-11-01'});
 await reject('new effective revision of the same salary plan invalidates an old preview token',()=>run(setup.saveProfiles,{preview_id:beforeBookChange.preview_id,token:beforeBookChange.token}),/方案|版本|预检/);
 console.log(JSON.stringify({suite:'payroll-setup-independent-review',driver:db.driver,checks,passed:checks,external_calls:0}));
}finally{await db.close();}

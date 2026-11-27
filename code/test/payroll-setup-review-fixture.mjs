// Owned empty database only: independent setup/security review identities.
import assert from'node:assert/strict';
import{readFileSync,readdirSync}from'node:fs';
import{withTx}from'../app/db.mjs';
import * as pay from'../app/services/payroll-source.mjs';
export async function setupReviewFixture(db){
 const one=async(s,p=[])=>(await db.query(s,p)).rows[0];
 assert.equal(Number((await one("SELECT count(*)n FROM pg_tables WHERE schemaname='public'")).n),0,'Owned empty DB required');
 await db.exec('CREATE EXTENSION IF NOT EXISTS btree_gist');
 for(const f of readdirSync(new URL('../db/',import.meta.url)).filter(x=>/^\d{3}_.*\.sql$/.test(x)).sort())await db.exec('BEGIN;'+readFileSync(new URL('../db/'+f,import.meta.url),'utf8')+'COMMIT;');
 await db.initSession();
 await db.exec(`INSERT INTO sys_account(id,login,display_name)OVERRIDING SYSTEM VALUE SELECT n,'setup_review_'||n,'薪酬复核账号'||n FROM generate_series(44900,44909)n;
 INSERT INTO sys_data_scope(id,name,combinator)VALUES(44900,'薪酬独立核验','intersection');
 INSERT INTO sys_user_role(user_id,role_id,data_scope_id,effective_from,grant_kind,grant_reason)SELECT n,10,44900,'2020-01-01','ROLE','owned empty setup fixture'FROM generate_series(44900,44909)n;
 INSERT INTO ty_group(id,code,name)VALUES(44900,'SETUP-REVIEW','天意集团'),(44901,'SETUP-OTHER','海棠集团');
 INSERT INTO ty_ledger(id,group_id,code,name,scope_mode,region_code,currency_code)VALUES(44900,44900,'G','天意集团帐','group','CN','CNY'),(44901,44901,'G','海棠集团帐','group','CN','CNY');
 INSERT INTO ty_company(id,group_id,ledger_id,code,name)VALUES(44900,44900,44900,'JA','香香鱼米静安店'),(44901,44900,44900,'XH','香香鱼米徐汇店'),(44902,44901,44901,'OTHER','海棠黄浦店');
 INSERT INTO ty_person(id,group_id,person_number,full_name)VALUES(44900,44900,'TY44900','林嘉宁'),(44901,44900,'TY44901','宋晚晴'),(44902,44900,'TY44902','刘辰安');
 INSERT INTO ty_employment(id,group_id,person_id,company_id,hire_date)VALUES(44900,44900,44900,44900,'2020-01-01'),(44901,44900,44901,44900,'2020-01-01'),(44902,44900,44900,44901,'2020-01-01');
 INSERT INTO ty_department(id,company_id,code,name)VALUES(44900,44900,'SERVICE','前厅部'),(44901,44900,'KITCHEN','后厨部'),(44902,44901,'SERVICE','前厅部');
 INSERT INTO ty_job(id,group_id,code,name)VALUES(44900,44900,'STAFF','门店员工');
 INSERT INTO ty_company_position(id,group_id,company_id,department_id,job_id,code,name)VALUES(44900,44900,44900,44900,44900,'SERVICE','前厅服务员'),(44901,44900,44900,44901,44900,'KITCHEN','后厨厨师'),(44902,44900,44901,44902,44900,'SERVICE','前厅服务员');
 INSERT INTO ty_position_assignment(group_id,company_id,employment_id,department_id,position_id,valid_from,status)VALUES(44900,44900,44900,44900,44900,'2020-01-01','active'),(44900,44900,44901,44901,44901,'2020-01-01','active'),(44900,44901,44902,44902,44902,'2020-01-01','active');
 INSERT INTO ty_test_account_profile(account_id,group_id,profile_code,seed_version)SELECT n,44900,'group_hr_director','SETUP-REVIEW'FROM generate_series(44900,44909)n;
 INSERT INTO ty_access_grant(account_id,group_id,can_read,can_write,valid_from)SELECT n,44900,true,true,'2020-01-01'FROM generate_series(44900,44909)n;`);
 let n=0;
 const run=(fn,input,userId=44900,operationId='SETUP-REVIEW-'+(++n))=>withTx(db,t=>fn(t,{userId,input,operationId}));
 const cfg=async(kind,company,system,data,extra={})=>{const c=(await run(pay.saveConfiguration,{kind,company_id:company,system,data,valid_from:'2026-10-01',valid_to:'2027-01-01',evidence_ref:'岗位薪酬独立核验及生效依据',...extra})).config;return(await run(pay.approveConfiguration,{id:c.id,expected_revision:c.revision},44901)).config;};
 const relations={};
 const legal=['CN_IIT_WITHHOLD','CN_EMP_PENSION','CN_ER_PENSION','CN_EMP_MEDICAL','CN_ER_MEDICAL','CN_EMP_UNEMPLOYMENT','CN_ER_UNEMPLOYMENT','CN_ER_WORK_INJURY','CN_ER_MATERNITY','CN_EMP_HOUSING_FUND','CN_ER_HOUSING_FUND','CN_MIN_WAGE_TOPUP'];
 for(const company of[44900,44901])await cfg('systems',company,null,{enabled_systems:['CN_PAYROLL']});
 for(const[e,c]of[[44900,44900],[44901,44900],[44902,44901]])relations[e]=await cfg('relationship',c,'CN_PAYROLL',{actual_relationship_key:'SETUP-REL-'+e,actual_employer_key:'SETUP-EMPLOYER-'+c,pay_subject_key:'SETUP-PAYER-'+c,tax_subject_key:'SETUP-TAX-'+c,contribution_subject_key:'SETUP-CONTRIB-'+c,statutory_applicability:Object.fromEntries(legal.map(code=>[code,{state:'not_applicable',reason:'隔离行为核验，不属于实际人员资格判断',evidence_ref:'独立隔离用例专用依据'}]))},{employment_id:e});
 const managed=async(user,resource)=>db.query('INSERT INTO ty_auth_managed(account_id,group_id,resource)VALUES($1,44900,$2)ON CONFLICT DO NOTHING',[user,resource]);
 const grant=async(user,resource,actions,{fields=['*'],deny=[],company=44900,departments=[],people=[]}={})=>{await managed(user,resource);return one("INSERT INTO ty_auth_grant(group_id,subject_type,account_id,resource,actions,company_id,department_ids,person_ids,fields_allow,fields_deny,valid_from,reason,created_by)VALUES(44900,'account',$1,$2,$3,$4,$5,$6,$7,$8,'2020-01-01','本次薪酬独立权限核验',44900)RETURNING *",[user,resource,actions,company,departments,people,fields,deny]);};
 return{one,run,cfg,grant,managed,relations,legal};
}

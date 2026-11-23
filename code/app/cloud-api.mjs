import { createDomainPort } from './domain-port.mjs';
import{handleIntegrationCallback}from'./cloud-integration-callback.mjs';
import{handleSsoPublic}from'./cloud-sso.mjs';
import{operations as INTEGRATION_OPERATIONS}from'./services/integration-runtime.mjs';
import * as foundation from './services/foundation.mjs';
import * as payroll from './services/customer-payroll.mjs';
import * as performance from './services/customer-performance.mjs';
import { ACTIONS as PEOPLE_ACTIONS } from './services/people-services.mjs';
import { ACTIONS as TIME_ACTIONS } from './services/advanced-time-v2.mjs';
import { operations as PERFORMANCE_OPERATIONS } from './services/performance-native.mjs';
import { operations as LEARNING_OPERATIONS } from './services/learning-native.mjs';

const scope = input => ({ groupId: input.group_id, ledgerId: input.ledger_id, companyId: input.company_id });
const runScoped = fn => async (tx, input, context) => {
  await (await import('./services/platform-adapters.mjs')).guardCoarseAdapter(tx,context.userId);
  return fn(tx, { ...scope(input), ...input, userId: context.userId });
};
const legacyRead=fn=>async(tx,input,context)=>{await(await import('./services/platform-adapters.mjs')).guardCoarseAdapter(tx,context.userId);return fn(tx,input,context);};
const system = (name, command=false) => async(tx,input,context)=>{
  const service=await import('./services/platform.mjs');
  if(command)return service.dispatchCommand(tx,{userId:context.userId,input,operationId:context.operationId,operation:name});
  return service[name](tx,{userId:context.userId,input});
};
const lifecycle=name=>async(tx,input,context)=>{
 const service=await import('./services/leave-lifecycle.mjs');const result=await service[name](tx,{...input,input,userId:context.userId,accountId:input.account_id??input.accountId,authorizationId:input.authorization_id??input.authorizationId,approvalReceiptId:input.approval_receipt_id??input.approvalReceiptId,operationId:context.operationId});
 if(typeof service.projectServiceResult!=='function')throw new Error('E_OPERATION_NOT_AVAILABLE: 当前假期生命周期结果尚未完成授权投影');
 return service.projectServiceResult(tx,{userId:context.userId,result});
};
const leave = name => async (tx, input, context) => {
  const service = await import('./services/advanced-leave.mjs');
  if (typeof service[name] !== 'function') throw new Error('E_OPERATION_NOT_AVAILABLE: 该假期动作尚未开放');
  const result=await service[name](tx, {
    ...input, input: input.input ?? input, userId: context.userId,
    accountId: input.accountId ?? input.account_id,
    groupId: input.groupId ?? input.group_id, ledgerId: input.ledgerId ?? input.ledger_id,
    companyId: input.companyId ?? input.company_id,
    operationId: context.operationId, commandKey: context.operationId ?? input.commandKey,
  });
  return service.projectServiceResult(tx,{userId:context.userId,result});
};
const hr=(module,method,operation=null)=>async(tx,input,context)=>{
  if(!(await tx.query("SELECT to_regclass('public.ty_hr_person_profile')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 人事模块迁移尚未就绪');
  const service=await import('./services/'+module+'.mjs');
  return service[method](tx,{userId:context.userId,input,operationId:context.operationId,...(operation?{operation}:{})});
};
const nativePayroll=method=>async(tx,input,context)=>{
  if(!(await tx.query("SELECT to_regclass('public.ty_pay_batch')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 薪酬模块迁移尚未就绪');
  return(await import('./services/payroll-source.mjs'))[method](tx,{userId:context.userId,input,operationId:context.operationId});
};
const contractPayroll=method=>async(tx,input,c)=>{if(!(await tx.query("SELECT to_regclass('public.ty_cp_resolution')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 合同给薪桥接尚未安装');return(await import('./services/contract-payroll.mjs'))[method](tx,{userId:c.userId,input,operationId:c.operationId});};
const statutoryPayroll=method=>async(tx,input,context)=>{
 if(!(await tx.query("SELECT to_regclass('public.ty_pay_stat_config')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 薪税参数迁移尚未就绪');
 return(await import('./services/payroll-statutory.mjs'))[method](tx,{userId:context.userId,input,operationId:context.operationId});
};
const nativePerformance=(method,operation=null)=>async(tx,input,context)=>{
 if(!(await tx.query("SELECT to_regclass('public.ty_pr_cycle_root')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 绩效模块迁移尚未就绪');
 const service=await import('./services/performance-native.mjs');return service[method](tx,{userId:context.userId,input,operationId:context.operationId,...(operation?{operation}:{})});
};
const nativeLearning=(method,operation=null)=>async(tx,input,context)=>{
 if(!(await tx.query("SELECT to_regclass('public.ty_lr_course')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 培训考试模块迁移尚未就绪');
 const service=await import('./services/learning-native.mjs');return service[method](tx,{userId:context.userId,input,operationId:context.operationId,...(operation?{operation}:{})});
};
const integration=(method,operation)=>async(tx,input,context)=>{if(!(await tx.query("SELECT to_regclass('public.ty_ix_profile')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 集成运行迁移尚未就绪');const service=await import('./services/integration-runtime.mjs');return service[method](tx,{userId:context.userId,input,operationId:context.operationId,...(operation?{operation}:{})});};
const workforce=(method,operation)=>async(tx,input,context)=>{if(!(await tx.query("SELECT to_regclass('public.ty_wf_approval_execution')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 供应商用工模块尚未就绪');return(await import('./services/workforce-native.mjs'))[method](tx,{userId:context.userId,input,operationId:context.operationId,...(operation?{operation}:{})});};
const finance=(module,method)=>async(tx,input,context)=>{if(!(await tx.query("SELECT to_regclass('public.ty_pay_finance_subject')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 薪酬资金模块尚未就绪');return(await import('./services/'+module+'.mjs'))[method](tx,{userId:context.userId,input,operationId:context.operationId});};
const payrollScript=(method,operation)=>async(tx,input,context)=>{if(!(await tx.query("SELECT to_regclass('public.ty_ps_script')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 工资公式扩展模块尚未就绪');return(await import('./services/payroll-scripts.mjs'))[method](tx,{userId:context.userId,input,operationId:context.operationId,...(operation?{operation}:{})});};
const recruiting=(method,operation)=>async(tx,input,context)=>{if(!(await tx.query("SELECT to_regclass('public.ty_rc_root')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 招聘来源模块尚未就绪');return(await import('./services/recruiting-integration.mjs'))[method](tx,{userId:context.userId,input,operationId:context.operationId,...(operation?{operation}:{})});};
const esign=(method,operation)=>async(tx,input,context)=>{if(!(await tx.query("SELECT to_regclass('public.ty_es_profile')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 合同电子签模块尚未就绪');return(await import('./services/esign-integration.mjs'))[method](tx,{userId:context.userId,input,operationId:context.operationId,...(operation?{operation}:{})});};
const notifications=(method,operation)=>async(tx,input,context)=>{if(!(await tx.query("SELECT to_regclass('public.ty_nx_rule')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 审批消息模块尚未就绪');return(await import('./services/notification-integration.mjs'))[method](tx,{userId:context.userId,input,operationId:context.operationId,...(operation?{operation}:{})});};
const reminders=(method,operation)=>async(tx,input,context)=>{if(!(await tx.query("SELECT to_regclass('public.ty_br_notice')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 到期提醒模块尚未就绪');return(await import('./services/business-reminders.mjs'))[method](tx,{userId:context.userId,input,operationId:context.operationId,...(operation?{operation}:{})});};
const leavePay=(method)=>async(tx,input,context)=>{if(!(await tx.query("SELECT to_regclass('public.ty_lp_fact')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 假期待遇来源模块尚未就绪');return(await import('./services/leave-payroll.mjs'))[method](tx,{userId:context.userId,input,operationId:context.operationId});};
const industryPayroll=(method)=>async(tx,input,context)=>{if(!(await tx.query("SELECT to_regclass('public.ty_pay_industry_basis')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 行业供款依据尚未就绪');return(await import('./services/payroll-industry.mjs'))[method](tx,{userId:context.userId,input,operationId:context.operationId});};
export function operationBodyLimit(kind,name){return(kind==='command'&&['hr.recruiting.file.import','hr.file.upload','hr.import.preview','time.import.preview','performance.import.preview','learning.import.preview','learning.course.save','system.file.upload','integration.runtime.file.preview','workforce.file.upload','payroll.native.finance.document.upload'].includes(name)||kind==='query'&&name==='hr.import.inspect')?12*1024*1024:1024*1024;}
export function domainOperations() {
  const query = run => ({ kind: 'query', run });
  const command = run => ({ kind: 'command', run });
  return {
    'foundation.bootstrap': query(async(tx,i,c)=>(await import('./services/platform-adapters.mjs')).bootstrap(tx,{userId:c.userId,...scope(i)})),
    'foundation.timeline': query(legacyRead((tx, i, c) => foundation.timeline(tx, { userId: c.userId, personId: i.person_id }))),
    'payroll.batches': query(runScoped(payroll.listBatches)),
    'payroll.rules': query(runScoped(payroll.listRuleSets)),
    'payroll.report': query(legacyRead((tx, i, c) => payroll.report(tx, { ...scope(i), userId: c.userId, batchId: i.batch_id }))),
    'performance.cycles': query(runScoped(performance.listCycles)),
    'performance.report': query(legacyRead((tx, i, c) => performance.report(tx, { ...scope(i), userId: c.userId, cycleId: i.cycle_id }))),
    ...Object.fromEntries(Object.entries({workspace:'workspace',slip:'payslip',export:'exportPayroll',costs:'bossCosts',wage_basis:'nativeWageBasis'}).map(([name,method])=>['payroll.native.'+name,query(nativePayroll(method))])),
    ...Object.fromEntries(Object.entries({'config.save':'saveConfiguration','config.approve':'approveConfiguration','batch.create':'createBatch','sources.preview':'previewSources','sources.review':'reviewPreview','sources.adopt':'adoptPreview','batch.confirm':'confirmBatch','batch.cancel':'cancelBatch','slips.publish':'publishPayslips','formula.propose':'proposeFormula'}).map(([name,method])=>['payroll.native.'+name,command(nativePayroll(method))])),
    'payroll.setup.sheet':query(async(tx,input)=>(await import('./services/payroll-salary-sheet.mjs')).salarySheet(tx,{input})),
    'payroll.setup.workspace':query(async(tx,input,c)=>(await import('./services/payroll-setup.mjs')).setupWorkspace(tx,{userId:c.userId,input})),
    ...Object.fromEntries(Object.entries({'item.save':'saveItem','item.approve':'approveItem','schemes.copy':'copySchemes','profiles.preview':'previewProfiles','profiles.save':'saveProfiles','profiles.approve':'approveProfiles'}).map(([op,method])=>['payroll.setup.'+op,command(async(tx,input,c)=>(await import('./services/payroll-setup.mjs'))[method](tx,{userId:c.userId,input,operationId:c.operationId}))])),
    'payroll.native.leave.workspace':query(leavePay('leavePayWorkspace')),
    ...Object.fromEntries(Object.entries({'policy.save':'saveLeavePayPolicy','policy.approve':'approveLeavePayPolicy','fact.save':'saveLeavePayFact','fact.approve':'approveLeavePayFact'}).map(([op,method])=>['payroll.native.leave.'+op,command(leavePay(method))])),
    'payroll.native.costs.export':query(async(tx,input,context)=>(await import('./services/payroll-cost-export.mjs')).exportCosts(tx,{userId:context.userId,input})),
    'payroll.contract.workspace':query(contractPayroll('queryResolutions')),
    'payroll.contract.resolve':command(contractPayroll('proposeResolution')),
    'payroll.contract.review':command(contractPayroll('approveResolution')),
    'payroll.native.statutory.workspace':query(statutoryPayroll('statutoryWorkspace')),
    'payroll.native.minimum_basis':query(async(tx,input,context)=>(await import('./services/payroll-minimum-review.mjs')).minimumWageBasis(tx,{userId:context.userId,input})),
    'payroll.native.statutory.config.save':command(statutoryPayroll('saveStatutoryConfiguration')),
    'payroll.native.statutory.config.approve':command(statutoryPayroll('approveStatutoryConfiguration')),
    'payroll.native.industry.workspace':query(industryPayroll('industryWorkspace')),
    'payroll.native.industry.standards':query(industryPayroll('industryStandards')),
    'payroll.native.industry.basis.create':command(industryPayroll('createIndustryBasis')),
    'payroll.native.industry.basis.approve':command(industryPayroll('approveIndustryBasis')),
    'performance.workspace':query(nativePerformance('queryWorkspace')),
    'performance.export':query(nativePerformance('exportReport')),
    'performance.person':query(nativePerformance('personHistory')),
    ...Object.fromEntries(PERFORMANCE_OPERATIONS.map(name=>[name,command(nativePerformance('dispatchCommand',name))])),
    ...Object.fromEntries(Object.entries({workspace:'queryWorkspace',export:'exportReport',paper:'paper',content:'content',person:'personHistory',import_template:'importTemplate'}).map(([name,method])=>['learning.'+name,query(nativeLearning(method))])),
    ...Object.fromEntries(LEARNING_OPERATIONS.map(name=>[name,command(nativeLearning('dispatchCommand',name))])),
    ...Object.fromEntries(Object.entries({workspace:'queryWorkspace',export:'exportReport',file_template:'sourceTemplate'}).map(([name,method])=>['integration.runtime.'+name,query(integration(method))])),
    ...Object.fromEntries(INTEGRATION_OPERATIONS.map(name=>[name,command(integration('dispatchCommand',name))])),
    'workforce.workspace':query(workforce('queryWorkspace')),
    ...Object.fromEntries(["supplier.create", "supplier.status", "profile.create", "profile.review", "contract.create", "contract.review", "order.create", "order.review", "engagement.create", "engagement.place", "engagement.review", "acceptance.create", "acceptance.review", "price.create", "price.review", "bill.create", "bill.review", "bill.share", "bill.confirm", "bill.post", "opening.create", "opening.review", "payment.create", "payment.review", "payment.export", "payment.cancel", "payment.result", "bank.register", "bank.review", "advance.create", "advance.review", "advance.apply", "refund.record", "invoice.register", "invoice.allocate", "mandate.create", "mandate.review", "instruction.create", "instruction.review", "instruction.reserve", "personal_receipt.create", "personal_receipt.review", "personal_receipt.apply", "thread.create", "message.send", "thread.resolve", "file.upload", "approval.submit"].map(name=>['workforce.'+name,command(workforce('dispatchCommand',name))])),
    ...Object.fromEntries(Object.entries({"workspace": "extensionWorkspace", "source": "getWageFundingSource", "documents": "payrollDocuments", "document.read": "readPayrollDocument"}).map(([name,method])=>['payroll.native.finance.'+name,query(finance('payroll-extensions',method))])),
    ...Object.fromEntries(Object.entries({"recipient.create": "createRecipient", "recipient.approve": "approveRecipient", "opening.create": "createFundingOpening", "opening.approve": "approveFundingOpening", "opening.event.record": "recordFundingOpeningEvent", "opening.event.approve": "approveFundingOpeningEvent", "payment.create": "createPaymentOrder", "payment.approve": "approvePaymentOrder", "payment.export": "exportPaymentOrder", "payment.cancel": "cancelPaymentOrder", "payment.result.record": "recordPaymentReceipt", "payment.result.approve": "approvePaymentReceipt", "filing.create": "createFiling", "filing.review": "reviewFiling", "filing.export": "exportFiling", "filing.event.record": "recordFilingEvent", "filing.event.review": "reviewFilingEvent", "document.upload": "uploadPayrollDocument"}).map(([name,method])=>['payroll.native.finance.'+name,command(finance('payroll-extensions',method))])),
    ...Object.fromEntries(Object.entries({"files.workspace": "financeFileWorkspace", "configured.read": "readConfiguredExport"}).map(([name,method])=>['payroll.native.finance.'+name,query(finance('payroll-finance-formats',method))])),
    ...Object.fromEntries(Object.entries({"files.format.create": "createFinanceFormat", "files.registration.create": "createFinanceRegistration", "files.identity.create": "createFilingIdentity", "files.approve": "approveFinanceFileConfig", "configured.export": "createConfiguredExport"}).map(([name,method])=>['payroll.native.finance.'+name,command(finance('payroll-finance-formats',method))])),
    'payroll.script.workspace':query(payrollScript('queryWorkspace')),
    ...Object.fromEntries(['save','approve','disable','preview','proposal.create','trigger.save','trigger.approve','trigger.disable','trigger.enqueue','job.process','ai.propose'].map(name=>['payroll.script.'+name,command(payrollScript('dispatchCommand',name))])),
    'integration.sso.workspace':query(async(tx,input,c)=>{if(!(await tx.query("SELECT to_regclass('public.ty_sso_profile')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 企业平台登录尚未就绪');return(await import('./services/external-sso.mjs')).ssoWorkspace(tx,{userId:c.userId,input});}),
    ...Object.fromEntries(Object.entries({'profile.save':'saveSsoProfile','profile.approve':'approveSsoProfile','binding.save':'saveSsoBinding','binding.approve':'approveSsoBinding','configuration.disable':'disableSsoConfiguration'}).map(([name,method])=>['integration.sso.'+name,command(async(tx,input,c)=>{if(!(await tx.query("SELECT to_regclass('public.ty_sso_profile')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 企业平台登录尚未就绪');return(await import('./services/external-sso.mjs'))[method](tx,{userId:c.userId,input,operationId:c.operationId});})])),
    'hr.legal.workspace':query(hr('hr-legal-subject','queryWorkspace')),
    ...Object.fromEntries(['propose','decide','apply','cancel'].map(name=>['hr.legal.'+name,command(hr('hr-legal-subject','dispatchCommand',name))])),
    'hr.workspace':query(hr('hr','queryWorkspace')),
    'hr.person.leave':query(hr('hr','personLeave')),
    'hr.change.detail':query(hr('hr-movements','queryChangeDetail')),
    'hr.self.transfer.workspace':query(hr('hr-movements','personalTransferWorkspace')),
    'hr.self.transfer.propose':command(hr('hr-movements','proposePersonalTransfer')),
    'hr.recruiting.workspace':query(recruiting('queryWorkspace')),
    'hr.recruiting.template':query(recruiting('sourceTemplate')),
    'hr.recruiting.download':query(recruiting('sourceDownload')),
    ...Object.fromEntries(['channel.create','channel.approve','channel.disable','job.enqueue','job.cancel','file.import','source.accept','source.update','source.reject','source.acknowledge'].map(op=>['hr.recruiting.'+op,command(recruiting('dispatchCommand',op))])),
    'integration.notifications.workspace':query(notifications('queryWorkspace')),
    'integration.notifications.target':query(async(tx,input,c)=>(await import('./services/notice-targets.mjs')).noticeTarget(tx,{userId:c.userId,input})),
    'integration.reminders.workspace':query(reminders('queryWorkspace')),
    'integration.reminders.target':query(reminders('reminderTarget')),
    ...Object.fromEntries(['rule.save','rule.approve','rule.disable','notice.refresh','lease.save','lease.review','lease.withdraw','delivery.retry','receipt.refresh'].map(op=>['integration.reminders.'+op,command(reminders('dispatchCommand',op))])),
    ...Object.fromEntries(['rule.save','rule.approve','rule.disable','delivery.retry','receipt.refresh'].map(op=>['integration.notifications.'+op,command(notifications('dispatchCommand',op))])),
    'integration.esign.workspace':query(esign('workspace')),
    'integration.esign.receipt':query(esign('receiptDownload')),
    ...Object.fromEntries(['profile.save','profile.approve','party.save','party.approve','configuration.disable','intent.propose','intent.approve','intent.start','intent.poll','intent.reconcile','intent.accept'].map(op=>['integration.esign.'+op,command(esign('dispatchCommand',op))])),
    'hr.recruitment.workspace':query(hr('hr-recruitment','queryWorkspace')),
    'hr.contracts.workspace':query(hr('hr-contracts','queryWorkspace')),
    'hr.files.workspace':query(hr('hr-files','queryWorkspace')),
    'hr.files.download':query(hr('hr-files','downloadFile')),
    'hr.import.status':query(hr('hr-import','queryPreview')),
    'hr.import.inspect':query(hr('hr-import','inspectImport')),
    'hr.import.template':query(hr('hr-import','importTemplate')),
    'hr.export':query(hr('hr-import','exportRoster')),
    'hr.import.preview':command(hr('hr-import','previewImport')),
    'hr.import.commit':command(hr('hr-import','commitImport')),
    'hr.file.upload':command(hr('hr-files','dispatchCommand','file.upload')),
    'hr.records.propose':command(hr('platform-hr-records','createRecordProposal')),
    'hr.records.workspace':query(hr('platform-hr-records','queryRecordProposals')),
    'hr.records.detail':query(hr('platform-hr-records','readRecordProposal')),
    'hr.group.create':command(hr('hr-organization','createGroup')),
    'hr.brand.create':command(hr('hr-organization','createBrand')),
    'payroll.native.person':query(nativePayroll('personHistory')),
    ...Object.fromEntries(['person.create','profile.save','organization.save','field.save','number_rule.save','headcount.create','headcount.publish','change.create','change.decide','change.execute','change.cancel'].map(name=>['hr.'+name,command(hr('hr','dispatchCommand',name))])),
    ...Object.fromEntries(['requisition.create','requisition.update','requisition.submit','requisition.decide','requisition.close','candidate.create','candidate.resume.attach','candidate.review','candidate.link','candidate.transition','interview.schedule','interview.result','offer.create','offer.update','offer.submit','offer.decide','offer.sent','offer.accept','offer.withdraw','offer.onboard'].map(name=>['hr.recruitment.'+name,command(hr('hr-recruitment','dispatchCommand',name))])),
    ...Object.fromEntries(['contract.create','contract.update','contract.sign','contract.terminate','term.create','term.review','term.effective','term.end','reminder.configure','reminder.refresh','reminder.read'].map(name=>['hr.contracts.'+name,command(hr('hr-contracts','dispatchCommand',name))])),
    'system.workspace':query(system('queryWorkspace')),
    'system.file.upload':command(async(tx,input,context)=>(await import('./services/portal-files.mjs')).uploadFormOriginal(tx,{userId:context.userId,input,operationId:context.operationId})),
    'system.file.read':query(async(tx,input,context)=>(await import('./services/portal-files.mjs')).queryFormOriginal(tx,{userId:context.userId,input})),
    'system.command.status':query(async(tx,input,context)=>(await import('./services/portal-commands.mjs')).commandStatus(tx,{userId:context.userId,input})),
    'system.notice.read':command(async(tx,input,context)=>(await import('./services/portal-notices.mjs')).markRead(tx,{userId:context.userId,input,operationId:context.operationId})),
    'system.personal.options':query(async(tx,input,context)=>(await import('./services/personal-services.mjs')).queryOptions(tx,{userId:context.userId,input})),
    'system.personal.workspace':query(async(tx,input,context)=>(await import('./services/personal-services.mjs')).queryWorkspace(tx,{userId:context.userId,input})),
    'system.personal.propose':command(async(tx,input,context)=>(await import('./services/personal-services.mjs')).propose(tx,{userId:context.userId,input,operationId:context.operationId})),
    'system.workflow.preview':query(system('previewWorkflow')),
    'system.authorization.simulate':query(system('simulateAuthorization')),
    'system.operation.status':query(system('operationStatus')),
  'time.leave.sources':query(async(tx,input,context)=>(await import('./services/time-leave-source.mjs')).reportLeaveSources(tx,{userId:context.userId,input})),
    'time.workspace':query(async(tx,i,c)=>{const installed=(await tx.query("SELECT to_regclass('public.ty_tw_execution')IS NOT NULL ok")).rows[0].ok;return(await import(installed?'./services/time-workflow.mjs':'./services/advanced-time-v2.mjs')).queryWorkspace(tx,{userId:c.userId,input:i});}),
    'time.workflow.submit':command(async(tx,input,c)=>{if(!(await tx.query("SELECT to_regclass('public.ty_tw_execution')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 排班考勤审批尚未就绪');return(await import('./services/time-workflow.mjs')).submitTimeWorkflow(tx,{userId:c.userId,input,operationId:c.operationId});}),
    'time.export':query(async(tx,i,c)=>(await import('./services/advanced-time-v2.mjs')).exportReport(tx,{userId:c.userId,input:i})),
    ...Object.fromEntries(TIME_ACTIONS.map(name=>['time.'+name,command(async(tx,i,c)=>(await import('./services/advanced-time-v2.mjs')).dispatchCommand(tx,{userId:c.userId,input:i,operationId:c.operationId,operation:name}))])),
    ...Object.fromEntries(['operator.create','operator.update','operator.reset_password','role.save','role.assign','role.revoke_member','grant.save','grant.revoke','form.save','form.publish','workflow.save','workflow.publish','instance.submit','instance.decide','instance.transfer','instance.delegate','instance.execute','instance.cancel','integration.save','integration.secret','integration.validate','integration.snapshot','integration.mapping'].map(name=>['system.'+name,command(system(name,true))])),
    ...Object.fromEntries(Object.entries(PEOPLE_ACTIONS).flatMap(([module,actions])=>[
      [module+'.workspace',query(async(tx,i,c)=>(await import('./services/people-services.mjs')).queryWorkspace(tx,{userId:c.userId,module,...scope(i),personId:i.person_id,asOf:i.as_of,page:i.page,pageSize:i.page_size,q:i.q}))],
      ...actions.map(action=>[module+'.'+action,command(async(tx,i,c)=>(await import('./services/people-services.mjs')).dispatchCommand(tx,{userId:c.userId,module,action,input:i,operationId:c.operationId}))]),
    ])),
    'leave.lifecycle.workspace':query(lifecycle('workspace')),
    ...Object.fromEntries(Object.entries({'extension':'proposeExtension','carry':'proposeCarry','recurring':'proposeRecurring','advance':'proposeAdvance','overtime-basis':'proposeOvertimeBasis','overtime-allocation':'proposeOvertimeAllocation','comp-cash':'proposeCompCash','advance-repayment':'proposeAdvanceRepayment','cash-qualification':'proposeCashQualification','annual-cash':'proposeAnnualCash','decide':'approveProposal','cancel':'cancelProposal','occurrences':'buildOccurrences','occurrence-submit':'submitOccurrence','exit-advances':'reviewExitAdvances'}).map(([name,method])=>['leave.lifecycle.'+name,command(lifecycle(method))])),
    'leave.workspace':query(async(tx,input,c)=>{if(!(await tx.query("SELECT to_regclass('public.ty_tw_execution')IS NOT NULL ok")).rows[0].ok)return leave('queryWorkspace')(tx,input,c);return(await import('./services/leave-workflow-entry.mjs')).queryLeaveWorkspace(tx,{...input,userId:c.userId,accountId:input.account_id??input.accountId,groupId:input.group_id??input.groupId,companyId:input.company_id??input.companyId,ledgerId:input.ledger_id??input.ledgerId});}),
    'leave.workflow.submit':command(async(tx,input,c)=>{if(!(await tx.query("SELECT to_regclass('public.ty_tw_execution')IS NOT NULL ok")).rows[0].ok)throw new Error('E_OPERATION_NOT_AVAILABLE: 原请假单送审尚未就绪');return(await import('./services/leave-workflow-entry.mjs')).submitExistingLeave(tx,{userId:c.userId,input,operationId:c.operationId});}),
    'leave.balance': query(leave('balance')),
    'leave.adjustment.preview': command(leave('previewAdjustment')),
    'leave.scheme.create': command(leave('createScheme')),
    'leave.scheme.publish': command(leave('publishScheme')),
    'leave.relationship.verify': command(leave('verifyRelationship')),
    'leave.entitlement.grant': command(leave('grantCumulative')),
    'leave.request.submit': command(leave('submitRequest')),
    'leave.request.decide': command(leave('decideRequest')),
    'leave.request.settle': command(leave('settleRequest')),
    'leave.request.cancel': command(leave('cancelRequest')),
    'leave.adjustment.apply': command(leave('applyAdjustment')),
    'leave.import': command(leave('importEntitlements')),
    'leave.expire': command(leave('expireLots')),
  };
}

export function createCloudApiExtension() {
  const extend=async function extend({ req, res, url, userId, db, readBody, runRead, runWrite }) {
    if(req.method==='GET'&&url.pathname==='/api/foundation/bootstrap'){
      const i=Object.fromEntries(url.searchParams);
      await runRead(res,tx=>(import('./services/platform-adapters.mjs')).then(service=>service.bootstrap(tx,{userId,...scope(i)})));
      return true;
    }
    const match = /^\/api\/v2\/(query|command)\/([a-z][a-z0-9._-]{1,100})$/.exec(url.pathname);
    if (!match) return false;
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST', 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'E_PORT_ARGUMENT', message: '请使用POST提交结构化参数' }));
      return true;
    }
    let input;
    try { input = JSON.parse((await readBody(req,operationBodyLimit(match[1],match[2]))).toString('utf8')); }
    catch (error) { if(error.code==='E_BODY_TOO_LARGE')throw error;throw new Error('E_TY_ARGUMENT: 请求内容不是有效JSON对象'); }
    const [ , kind, name ] = match;
    const port = createDomainPort({ db, operations: domainOperations() });
    const context = { userId: Number(userId) };
    if (kind === 'query') await runRead(res, tx => port.queryView(name, input, context, { tx }));
    else await runWrite(res, { actor: userId, action: `v2.${name}`, subject: input?.employment_id ? `employment:${input.employment_id}` : null,
      fn: tx => port.executeCommand(name, input, context, { tx, operationId: req.headers['idempotency-key'] || input?.client_operation_id }) });
    return true;
  };
  extend.public=async args=>await handleSsoPublic(args)||handleIntegrationCallback(args);
  return extend;
}

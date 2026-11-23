export const array = v => Array.isArray(v) ? v : [];
export const same = (a, b) => String(a ?? '') === String(b ?? '');
export const date = value => value ? String(value).slice(0, 10) : '—';
export const text = value => value === null || value === undefined || value === '' ? '—' : String(value);
export const labels = { draft: '草稿', validated: '已校验', confirmed: '已确认', approved: '已启用', pending: '待核', active: '在用', inactive: '停用', ended: '已结束', cancelled: '已取消', source_snapshot: '来源快照', calculated: '系统试算', earning: '收入', deduction: '扣款', employee_contribution: '个人承担', employer_contribution: '企业承担', reference: '参考', CN: '中国内地', HK: '中国香港', full_time: '全职', part_time: '兼职', hourly: '小时工', outsourced: '外包服务' };
export const label = value => labels[value] || text(value);

// Preserve decimals and IDs from the server; never Number() salary amounts.
export function amount(value) {
  if (value === null || value === undefined || value === '') return '—';
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) return String(value);
  return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(match[3] || '').padEnd(2, '0')}`;
}
export function within(rows, id, root, parent = 'parent_company_id') {
  if (!root) return true;
  const seen = new Set(); let current = id;
  while (current != null && !seen.has(String(current))) {
    if (same(current, root)) return true; seen.add(String(current));
    current = rows.find(row => same(row.id, current))?.[parent];
  }
  return false;
}
export function companiesInScope(data, scope) {
  return array(data.companies).filter(company => within(array(data.companies), company.id, scope.company_id)
    && within(array(data.ledgers), company.ledger_id, scope.ledger_id, 'parent_ledger_id'));
}
export function currentEmployment(e, today) { const from = date(e.hire_date), to = e.leave_date ? date(e.leave_date) : ''; return e.status !== 'cancelled' && from <= today && (!to || to >= today); }
export function personRows(data, scope, today) {
  const ids = new Set(companiesInScope(data, scope).map(c => String(c.id)));
  return array(data.people).map(person => {
    const relationships = array(data.employments).filter(e => same(e.person_id, person.id) && ids.has(String(e.company_id)));
    const active = relationships.filter(e => currentEmployment(e, today));
    const employmentIds = new Set(active.map(e => String(e.id)));
    const assignments = array(data.assignments).filter(a => employmentIds.has(String(a.employment_id)) && date(a.valid_from) <= today && (!a.valid_to || today < date(a.valid_to)));
    const names = (rows, key, source) => [...new Set(rows.map(row => array(data[source]).find(r => same(r.id, row[key]))?.name).filter(Boolean))].join(' / ');
    return { ...person, relationships, active, assignments, company_names: names(active, 'company_id', 'companies'), department_names: names(assignments, 'department_id', 'departments'), position_names: names(assignments, 'position_id', 'positions'), employment_label: active.length ? '在职' : relationships.length ? '历史任职' : '待任职' };
  }).filter(person => !scope.company_id && !scope.ledger_id || person.relationships.length > 0);
}

export function brandScope(data, groupId, brandId) {
  if (!brandId) return { group_id: groupId, ledger_id: '', company_id: '', brand_id: '' };
  const ledger = array(data.ledgers).find(l => same(l.brand_id, brandId) && l.scope_mode === 'brand');
  const company = array(data.companies).find(c => same(c.brand_id, brandId) && c.org_level === 'brand');
  if (!ledger && !company) throw new Error('此品牌尚未建立可办理的品牌公司或帐套，请先完善组织设置');
  return { group_id: groupId, ledger_id: ledger?.id || '', company_id: company?.id || '', brand_id: brandId };
}

export function pageRows(rows, query, page, pageSize, searchText = row => Object.values(row).filter(v => typeof v !== 'object').join(' ')) {
  const q = query.trim().toLocaleLowerCase();
  const filtered = q ? rows.filter(row => searchText(row).toLocaleLowerCase().includes(q)) : rows;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)); const current = Math.max(1, Math.min(page, pages));
  return { rows: filtered.slice((current - 1) * pageSize, current * pageSize), total: filtered.length, pages, page: current };
}

export function canRead(capabilities, resource) { return !!capabilities?.resources?.[resource]?.can_read; }
export function canWrite(capabilities, resource) { return capabilities?.profile_code !== 'boss' && !!capabilities?.resources?.[resource]?.can_write; }
export function canPayroll(capabilities) { return canRead(capabilities, 'payroll_run') && canRead(capabilities, 'payroll_slips_read_all') && !['config_admin', 'store_staff', 'station_staff', 'outsourced_staff', 'vendor_contact', 'outsource_hr'].includes(capabilities?.profile_code); }
export function canPeople(capabilities) { return ['hr_people','hr_self','people_read_all','people_self','employee_roster'].some(r => canRead(capabilities, r)); }

// Menu visibility is only a hint; every platform query/command rechecks complete grants.
export function canConfigureResource(c, resource) { return canRead(c, resource) || c.profile_code === 'config_admin' && canWrite(c, 'ledger'); }
export function canUsePortal(c) { return c.profile_code !== 'config_admin' && canRead(c, 'workflow_self'); }

export const navigation = [
  { id: 'payroll', name: '薪酬管理', icon: 'wallet', pages: [
    { id: 'payroll', name: '工资计算', subtitle: '批次、试算与核验', ready: true, access: canPayroll },
    {id:'payroll/contracts',name:'合同给薪核定',ready:true,access:c=>canRead(c,'payroll_sources')},
    {id:'payroll/setup/items',name:'工资项目设置',subtitle:'自定义项目与发布',ready:true,access:c=>canRead(c,'payroll_config')},
    {id:'payroll/setup/schemes',name:'工资方案设置',subtitle:'项目、依赖公式与方案版本',ready:true,access:c=>canRead(c,'payroll_config')},
    {id:'payroll/setup/assign',name:'员工方案分配',subtitle:'按公司、门店或员工分配工资方案',ready:true,access:c=>canRead(c,'payroll_sources')},
    {id:'payroll/setup/profiles',name:'员工工资档案',subtitle:'个人定薪、调薪与复核',ready:true,access:c=>canRead(c,'payroll_sources')},
    {id:'payroll/setup/bulk',name:'批量定薪与调薪',subtitle:'批量选择、表格导入与差异预检',ready:true,access:c=>canRead(c,'payroll_sources')},
    {id:'payroll/scripts',name:'公式代码与触发器',ready:true,access:c=>canRead(c,'payroll_config')},
    {id:'payroll/finance',name:'工资付款与申报',ready:true,access:c=>canRead(c,'payroll_payment')||canRead(c,'payroll_filing')},
    { id:'payroll/settings', name:'薪酬设置', ready:true, access:c=>canRead(c,'payroll_config')||canPayroll(c) },
    { id: 'payroll/payslips', name: '工资单', ready:true, access: canPayroll },
    { id: 'payroll/tax', name: '薪税与社保', ready:true, access: canPayroll },
    {id:'payroll/industry',name:'香港行业供款依据',ready:true,access:c=>canRead(c,'payroll_sources')},
  ] },
  { id: 'attendance', name: '排班考勤', icon: 'calendar', pages: [
    { id: 'attendance/schedule', ready: true, name: '排班工作台', access: c => canRead(c, 'attendance_daily') },
    { id: 'attendance/daily', ready: true, name: '考勤日报', access: c => canRead(c, 'attendance_daily') },
    { id: 'attendance/monthly', ready: true, name: '考勤月报', access: c => canRead(c, 'attendance_daily') },
    { id: 'attendance/changes', ready: true, name: '调班与借调', access: c => canRead(c, 'attendance_daily') },
    { id: 'attendance/shifts', ready: true, name: '班次设置', access: c => canRead(c, 'attendance_daily') },
    { id: 'attendance/imports', ready: true, name: '排班考勤Excel导入', access: c => canRead(c, 'attendance_daily') },
    { id: 'attendance/versions', ready: true, name: '排班考勤版本记录', access: c => canRead(c, 'attendance_daily') },
    { id: 'attendance/leave', name: '假期台账', subtitle: '额度、申请与核销', ready: true, access: c => !['store_staff', 'station_staff', 'outsourced_staff', 'vendor_contact', 'outsource_hr'].includes(c.profile_code) && canRead(c, 'advanced_leave_manage') },
    { id: 'attendance/leave/settings', name: '假期设置', subtitle: '政策版本与规则发布', ready: true, access: c => !['store_staff', 'station_staff', 'outsourced_staff', 'vendor_contact', 'outsource_hr'].includes(c.profile_code) && (canRead(c, 'advanced_leave_config') || canWrite(c, 'advanced_leave_config')) },
    { id: 'my/leave', name: '我的假期', subtitle: '本人额度与请假申请', ready: true, access: c => !!c.has_person && canRead(c, 'advanced_leave_self') && !['outsourced_staff', 'vendor_contact', 'outsource_hr'].includes(c.profile_code) },
  ] },
  { id: 'performance', name: '绩效管理', icon: 'chart', pages: [
    {id:'performance/plans',name:'考核计划',ready:true,access:c=>canRead(c,'perf_cycle')},
    {id:'performance/ratings',name:'评分与上级复核',ready:true,access:c=>canRead(c,'perf_review')||canRead(c,'perf_self')},
    {id:'performance/results',name:'绩效成绩与申诉',ready:true,access:c=>canRead(c,'perf_cycle')||canRead(c,'perf_review')},
    {id:'performance/bonus',name:'绩效与奖金',ready:true,access:c=>canRead(c,'perf_bonus')},
    {id:'performance/settings',name:'绩效设置',ready:true,access:c=>canConfigureResource(c,'perf_config')},
  ] },
  {id:'learning',name:'培训与考试',icon:'book',pages:[
    {id:'learning/courses',name:'课程与培训内容',ready:true,access:c=>canRead(c,'learning_config')||canRead(c,'learning_manage')},
    {id:'learning/plans',name:'培训计划与学时',ready:true,access:c=>canRead(c,'learning_manage')},
    {id:'learning/exams',name:'题库与考试',ready:true,access:c=>canRead(c,'learning_config')||canRead(c,'learning_manage')},
    {id:'learning/grading',name:'阅卷、成绩与申诉',ready:true,access:c=>canRead(c,'learning_grade')||canRead(c,'learning_publish')},
    {id:'learning/qualifications',name:'岗位资格与结果应用',ready:true,access:c=>canRead(c,'learning_apply')||canRead(c,'learning_config')},
  ]},
  { id: 'people', name: '人事管理', icon: 'people', pages: [
    { id: 'organization', name: '人事组织架构', subtitle: '组织树与成员穿透', ready: true, access: c => canPeople(c)||canRead(c,'hr_configuration')||canRead(c,'ledger') },
    { id: 'people', name: '人事花名册', subtitle: '永久编号与任职历史', ready: true, access: canPeople },
    { id:'people/changes',name:'入转调离',ready:true,access:c=>canRead(c,'hr_people') },
    { id:'people/contracts',name:'人事合同',ready:true,access:c=>canRead(c,'hr_contract')||canRead(c,'hr_self') },
    { id:'people/contract-reminders',name:'合同到期提醒',ready:true,access:c=>canRead(c,'hr_contract')||canRead(c,'hr_self') },
    { id: 'people/certificates', ready: true, name: '证件证照', access: canPeople },
    { id: 'people/items', ready: true, name: '物品领用', access: canPeople },
  ] },
  { id: 'talent', name: '招聘管理', icon: 'book', pages: [{ id:'talent/recruit',name:'招聘管理',ready:true,access:c=>canRead(c,'hr_recruitment')||canRead(c,'hr_interview') }] },
  { id: 'services', name: '用工与服务', icon: 'building', pages: [{ id: 'services/vendors', name: '供应商与用工', ready:true, access: c => canRead(c, 'outsource_ops')||canRead(c,'outsource_self') }, {id:'services/workforce/reconciliation',name:'服务量与对账',ready:true,access:c=>canRead(c,'outsource_bill')}, {id:'services/workforce/finance',name:'供应商资金',ready:true,access:c=>canRead(c,'outsource_finance')}, {id:'services/workforce/disbursement',name:'工资代发核对',ready:true,access:c=>canRead(c,'outsource_finance')}, {id:'services/workforce/collaboration',name:'用工沟通',ready:true,access:c=>canRead(c,'outsource_ops')||canRead(c,'outsource_self')}, { id: 'services/dormitory', ready: true, name: '宿舍管理', access: canPeople }] },
  { id: 'reports', name: '数据报表', icon: 'chart', pages: [{ id:'reports/cost',name:'人力成本',ready:true,access:c=>canRead(c,'payroll_cost') }] },
  { id: 'personal', name: '我的办理', icon: 'home', pages: [
    { id: 'my/schedule', ready: true, name: '我的排班与考勤', subtitle: '本人安排、打卡与调班申请', access: c => !!c.has_person && canRead(c, 'attendance_self') },
    {id:'my/learning',name:'我的学习与考试',ready:true,access:c=>!!c.has_person&&canRead(c,'learning_self')},
    {id:'my/performance',name:'我的绩效',ready:true,access:c=>!!c.has_person&&canRead(c,'perf_self')},
    { id:'my/payslips',name:'我的工资单',ready:true,access:c=>!!c.has_person&&canRead(c,'payroll_self') },
    { id: 'my/tasks', name: '我的待办', subtitle: '当前分配任务与办理', ready: true, access: canUsePortal },
    { id: 'my/requests', name: '我的申请', subtitle: '发起表单与办理进度', ready: true, access: canUsePortal },
    { id: 'my/alerts', name: '提醒通知', subtitle: '提醒与投递状态', ready: true, access: canUsePortal },
  ] },
  { id: 'system', name: '系统设置', icon: 'settings', bottom: true, pages: [
    { id: 'system/access', name: '操作人员与权限', subtitle: '角色、完整授权与模拟', ready: true, access: c => canConfigureResource(c, 'system_configuration') },
    { id: 'system/forms', name: '表单设计', subtitle: '字段、预览与版本发布', ready: true, access: c => canConfigureResource(c, 'workflow_manage') },
    { id: 'system/workflow', name: '审批流设计', subtitle: '可视流程、仿真与办理', ready: true, access: c => canConfigureResource(c, 'workflow_manage') },
  ] },
  { id: 'integrations', name: '集成设置', icon: 'link', bottom: true, pages: [{id:'integrations/esign',name:'合同电子签',ready:true,access:c=>canConfigureResource(c,'integration_manage')},{id:'integrations/sso',name:'企业平台登录',ready:true,access:c=>canConfigureResource(c,'integration_manage')},{id:'integrations/reminders',name:'到期提醒与通知',ready:true,access:c=>canConfigureResource(c,'integration_manage')},{id:'integrations/notifications',name:'审批消息与回执',ready:true,access:c=>canConfigureResource(c,'integration_manage')},{id:'integrations/runtime',name:'同步、打卡与消息',ready:true,access:c=>canConfigureResource(c,'integration_manage')}, { id: 'integrations/connections', name: '连接与接口对账', subtitle: '连接、组织对照与回传日志', ready: true, access: c => canConfigureResource(c, 'integration_manage') }] },
];
export function visibleNavigation(capabilities) { return [...navigation].sort((a,b)=>{const order=['personal','people','payroll'];const rank=g=>order.includes(g.id)?order.indexOf(g.id):3;return rank(a)-rank(b);}).map(group => ({ ...group, pages: group.pages.filter(p => p.access(capabilities)) })).filter(group => group.pages.length); }
export function routePage(route) {if(route==='payroll/rules')return navigation.flatMap(g=>g.pages).find(p=>p.id==='payroll/setup/items');if(/^payroll\/contracts\/term\/[0-9]+$/.test(route))return navigation.flatMap(g=>g.pages).find(p=>p.id==='payroll/contracts');if(/^my\/(tasks|alerts)\/notice\/[a-f0-9]{32}$/.test(route))return navigation.flatMap(g=>g.pages).find(p=>p.id===route.split('/').slice(0,2).join('/')); return navigation.flatMap(group => group.pages).find(page => route === page.id) || (route.startsWith('people/detail/') ? { id: 'people', name: '员工全貌', ready: true, access: canPeople } : route.startsWith('payroll/batch/') ? { id: 'payroll', name: '工资批次', ready: true, access: canPayroll } : null); }

// Code alone is not a policy identity: CN/HK and unit scopes may share it.
export function leaveAccountName(account, schemes) {
  if (account.scheme_name) return account.scheme_name;
  const names = [...new Set(array(schemes).filter(s => s.code === account.code && s.jurisdiction === account.jurisdiction && s.unit === account.unit && (!s.group_id || same(s.group_id, account.group_id))).map(s => s.name).filter(Boolean))];
  return names.length === 1 ? names[0] : account.code;
}

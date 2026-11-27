import{test}from'node:test';
import assert from'node:assert/strict';
import{navigation,visibleNavigation}from'../src/domain.mjs';
import{workspaceExperience,operatorProfileLabel}from'../src/workspace-experience.mjs';
const all=navigation.flatMap(g=>g.pages);
test('role-specific home never adds payroll, configuration or another employee entry without a current grant',()=>{
 const c={profile_code:'store_staff',has_person:true,resources:{attendance_self:{can_read:true},workflow_self:{can_read:true},payroll_self:{can_read:true},advanced_leave_self:{can_read:true}}};
 const home=workspaceExperience(c,all);
 assert.equal(home.shortcuts[0].id,'my/schedule');
 assert.ok(home.shortcuts.every(p=>p.access(c)));
 assert.ok(!home.shortcuts.some(p=>p.id==='payroll'||p.id==='system/access'));
 assert.equal(home.availableCount,visibleNavigation(c).flatMap(g=>g.pages).length);
 const revoked=workspaceExperience({...c,resources:{}},all);
 assert.equal(revoked.shortcuts.length,0);
});
test('configuration portal keeps its own profile and shortcuts bounded under full directory input',()=>{
 const c={profile_code:'config_admin',resources:{system_configuration:{can_read:true},workflow_manage:{can_read:true},integration_manage:{can_read:true}}};
 const home=workspaceExperience(c,all);
 assert.equal(home.label,'系统配置管理员');
 assert.ok(home.shortcuts.every(p=>p.id.startsWith('system/')||p.id.startsWith('integrations/')));
 assert.ok(home.shortcuts.length<=6);
 assert.equal(new Set(home.shortcuts.map(p=>p.id)).size,home.shortcuts.length);
 assert.equal(operatorProfileLabel(c,'系统管理员'),'系统配置管理员');
});
test('an invented preferred role cannot expose a page missing from the authorized input or marked unavailable',()=>{
 const c={profile_code:'payroll',resources:{payroll_run:{can_read:true},payroll_slips_read_all:{can_read:true}}};
 const page=all.find(p=>p.id==='payroll');
 assert.equal(workspaceExperience(c,[{...page,ready:false}]).shortcuts.length,0);
 assert.equal(workspaceExperience(c,[]).shortcuts.length,0);
 assert.equal(operatorProfileLabel({profile_code:'store_staff'},'系统管理员'),'门店员工');
});

test('personal leave requires both self-service permission and a bound employee',()=>{
 const resources={advanced_leave_self:{can_read:true}};
 const hasMyLeave=c=>visibleNavigation(c).flatMap(group=>group.pages).some(page=>page.id==='my/leave');
 assert.equal(hasMyLeave({profile_code:'demo',has_person:false,resources}),false);
 assert.equal(hasMyLeave({profile_code:'store_staff',has_person:true,resources}),true);
 assert.equal(hasMyLeave({profile_code:'outsourced_staff',has_person:true,resources}),false);
});

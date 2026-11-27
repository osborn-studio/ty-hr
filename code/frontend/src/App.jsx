import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { createApi } from './api.mjs';
import SsoLogin from './components/SsoLogin.jsx';
import{ssoRelayTicket,ssoReturnRoute}from'./auth-sso.mjs';
import{workspaceExperience,operatorProfileLabel}from'./workspace-experience.mjs';
import{notificationLoginRoute}from'./notification-links.mjs';
import { array, brandScope, canPayroll, canPeople, companiesInScope, personRows, routePage, same, visibleNavigation } from './domain.mjs';
import { Button, EmptyState, ErrorState, Icon, Loading, Modal, Notice, PageHeading, Stat } from './components/UI.jsx';
const InitialGroupSetup=lazy(()=>import('./components/hr/InitialGroupSetup.jsx'));
const ContractPayroll=lazy(()=>import('./pages/ContractPayroll.jsx'));
const PayrollSetup=lazy(()=>import('./pages/PayrollSetup.jsx'));
const PayrollWorkbench=lazy(()=>import('./pages/PayrollWorkbench.jsx'));
const RosteringPage=lazy(()=>import('./pages/Rostering.jsx'));
const SupportPage=lazy(()=>import('./pages/Support.jsx'));
const PerformancePage=lazy(()=>import('./pages/Performance.jsx'));
const WorkforcePage=lazy(()=>import('./pages/Workforce.jsx'));
const PayrollFinancePage=lazy(()=>import('./pages/PayrollFinance.jsx'));
const PayrollScriptsPage=lazy(()=>import('./pages/PayrollScripts.jsx'));
const IndustryBasisPanel=lazy(()=>import('./components/IndustryBasisPanel.jsx'));
const EnterpriseLoginPage=lazy(()=>import('./pages/EnterpriseLogin.jsx'));
const EsignPage=lazy(()=>import('./components/EsignPanel.jsx'));
const NotificationRulesPanel=lazy(()=>import('./components/integration/NotificationRulesPanel.jsx'));
const NotificationLanding=lazy(()=>import('./components/integration/NotificationLanding.jsx'));
const LifecycleReminders=lazy(()=>import('./components/integration/LifecycleReminders.jsx'));
const IntegrationRuntimePage=lazy(()=>import('./pages/IntegrationRuntime.jsx'));
const LearningPage=lazy(()=>import('./pages/Learning.jsx'));
const RecruitmentContractsPage=lazy(()=>import('./pages/RecruitmentContracts.jsx'));
const OrganizationPage=lazy(()=>import('./pages/NativePeople.jsx').then(m=>({default:m.OrganizationPage})));
const PeoplePage=lazy(()=>import('./pages/NativePeople.jsx').then(m=>({default:m.PeoplePage})));
const PersonPage=lazy(()=>import('./pages/NativePeople.jsx').then(m=>({default:m.PersonPage})));
const HRChangesPage=lazy(()=>import('./pages/NativePeople.jsx').then(m=>({default:m.HRChangesPage})));
import { LeavePage } from './pages/Leave.jsx';
import { SystemPage } from './pages/System.jsx';
import { PortalPage } from './pages/Portal.jsx';
import { IntegrationsPage } from './pages/Integrations.jsx';

const TOKEN_KEY = 'tyhr.react.token';
const readToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const writeToken = token => { try { token ? sessionStorage.setItem(TOKEN_KEY, token) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* Current tab still works. */ } };
export const go = route => { location.hash = route; };
function useRoute() { const read = () => {const value=decodeURIComponent(location.hash.slice(1)||'work').replace(/^\/+/, '');return value==='talent/learning'?'learning/courses':value;}; const [route, setRoute] = useState(read); useEffect(() => { const change = () => setRoute(read()); addEventListener('hashchange', change); return () => removeEventListener('hashchange', change); }, []); return route; }

export default function App() {
  const [token, setToken] = useState(readToken); const [session, setSession] = useState(null); const [error, setError] = useState(null); const [loading, setLoading] = useState(!!token);
  const [ssoBusy,setSsoBusy]=useState(()=>location.hash.startsWith('#sso='));
  const [notice, setNotice] = useState(''); const [retry, setRetry] = useState(0); const [data, setData] = useState(null); const [scopeBusy, setScopeBusy] = useState(false);
  const [scope, setScope] = useState({ group_id: '', brand_id: '', ledger_id: '', company_id: '' });
  const route = useRoute();
  const expire = useCallback(error => { writeToken(''); setToken(''); setSession(null); setData(null); setScope({}); setNotice(error.message); }, []);
  const api = useMemo(() => createApi({ token, onUnauthorized: expire }), [token, expire]);
  useEffect(()=>{
    if(!location.hash.startsWith('#sso='))return;
    let ticket;try{ticket=ssoRelayTicket(location.hash);}catch(e){setNotice(e.message);setSsoBusy(false);go('work');}
    history.replaceState(null,'',location.pathname+location.search);
    if(!ticket)return;
    createApi().request('/auth/sso/redeem',{method:'POST',body:{ticket}}).then(result=>{if(typeof result.token!=='string'||!result.token)throw new Error('平台登录未返回有效本地会话。');const route=ssoReturnRoute(result.return_path,location.origin);setLoading(true);writeToken(result.token);setToken(result.token);setNotice('');go(route);}).catch(e=>{writeToken('');setToken('');setNotice(e.message);go('work');}).finally(()=>setSsoBusy(false));
  },[]);
  useEffect(() => {
    if (ssoBusy||!token) { setLoading(false); return; }
    const controller = new AbortController(); let current = true; setLoading(true); setError(null);
    Promise.all([api.me(controller.signal), api.capabilities(controller.signal), api.bootstrap({}, controller.signal)]).then(([me, capabilities, bootstrap]) => {
      if (!current) return; setSession({ me, capabilities }); setData(bootstrap); setScope({ ...bootstrap.context, brand_id: '' }); setLoading(false);
    }).catch(error => { if (current && error.name !== 'AbortError') { setError(error); setLoading(false); } });
    return () => { current = false; controller.abort(); };
  }, [api, token, retry,ssoBusy]);
  const [scopeRevision, setScopeRevision] = useState(0);
  const changeScope = async next => {
    if (scopeBusy) return; setScopeBusy(true); setNotice('');
    try { const [bootstrap,capabilities,me] = await Promise.all([api.bootstrap(next),api.capabilities(),api.me()]); setSession({me,capabilities}); setData(bootstrap); setScope({ ...next, ...bootstrap.context }); setScopeRevision(v => v + 1); }
    catch (error) { setNotice(`${error.code || '范围切换失败'}：${error.message}`); }
    finally { setScopeBusy(false); }
  };
  const logout = async () => {
    let message = ''; try { await api.request('/api/me/logout', { method: 'POST', body: {} }); }
    catch { message = '本机已退出；服务端会话撤销尚未确认，请在恢复连接后检查登录会话。'; }
    writeToken(''); setToken(''); setSession(null); setData(null); setScope({}); setNotice(message); go('work');
  };
  if(ssoBusy)return <div className="app-loading"><Brand/><Loading children="正在核对平台身份与当前权限"/></div>;
  if (!token) return <Login notice={notice} onLogin={async (login, password) => { const result = await createApi().login(login, password); if (!result.token) throw new Error('服务未返回登录凭证'); setLoading(true);writeToken(result.token); setToken(result.token); setNotice(''); go(notificationLoginRoute(location.hash)); }}/>;
  if (loading) return <div className="app-loading"><Brand/><Loading children="正在读取身份和授权范围"/></div>;
  if (error?.status === 428) return <PasswordChange api={api} onChanged={() => setRetry(v => v + 1)} logout={logout}/>;
  if (error || !session || !data) return <div className="app-loading"><Brand/><ErrorState error={error} retry={() => setRetry(v => v + 1)}/><Button onClick={logout}>退出当前登录</Button></div>;
  if(!data.groups?.length&&data.capabilities?.can_create_group)return <Suspense fallback={<Loading>正在准备首个集团</Loading>}><InitialGroupSetup api={api} session={session} data={data} notify={setNotice} onScopeChange={changeScope} onLogout={logout}/></Suspense>;
  return <Workspace api={api} session={session} data={data} scope={scope} scopeBusy={scopeBusy} scopeRevision={scopeRevision} changeScope={changeScope} logout={logout} route={route} notice={notice} setNotice={setNotice}/>;
}

function Brand({ compact = false }) { return <div className={`brand ${compact ? 'compact' : ''}`}><span className="brand-mark">天</span><div><b>天意<span>HR</span></b>{!compact && <small>人力资源系统 · ty-hr</small>}</div></div>; }
function PasswordChange({ api, onChanged, logout }) {
  const [oldPassword, setOld] = useState(''); const [newPassword, setNew] = useState(''); const [confirmation, setConfirmation] = useState(''); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const submit = async event => { event.preventDefault(); if (busy) return; if (newPassword !== confirmation) { setError(new Error('两次新密码不一致')); return; } setBusy(true); setError(null); try { const result = await api.request('/api/me/password', { method: 'POST', body: { oldPassword, newPassword } }); if (!result.changed) throw new Error('服务未确认密码已修改，请核对后重试'); setOld(''); setNew(''); setConfirmation(''); onChanged(); } catch (error) { setError(error); } finally { setBusy(false); } };
  return <main className="password-page"><Brand/><form className="panel password-card" onSubmit={submit}><h1>请先更新登录密码</h1><p>当前账号需要修改初始密码，完成后继续使用工作台。</p>{error && <Notice tone="danger">{error.message}</Notice>}<label>当前密码<input aria-label="当前密码" type="password" autoComplete="current-password" required value={oldPassword} onChange={e => setOld(e.target.value)}/></label><label>新密码<input aria-label="新密码" type="password" autoComplete="new-password" required value={newPassword} onChange={e => setNew(e.target.value)}/></label><label>确认新密码<input aria-label="确认新密码" type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)}/></label><div className="modal-actions"><Button disabled={busy} onClick={logout}>退出</Button><Button type="submit" variant="primary" busy={busy}>更新密码并继续</Button></div></form></main>;
}
function Login({ onLogin, notice }) {
  const [login, setLogin] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const submit = async event => { event.preventDefault(); if (busy) return; setBusy(true); setError(null); try { await onLogin(login.trim(), password); } catch (error) { setError(error); } finally { setBusy(false); } };
  return <div className="login-layout"><section className="login-story"><Brand/><div className="story-copy"><span className="eyebrow">为餐饮多门店而生</span><h1>让每一份付出，<br/>都有清晰的回响。</h1><p>从一个人的成长，到一家店的运转。<br/>薪酬、排班与人事，在此有序连接。</p><div className="story-chips"><span>集团与多品牌</span><span>内地与香港</span><span>PC与移动端</span></div></div><div className="story-orbit" aria-hidden="true"><span/><span/><b>TY</b></div><small className="story-footer">TY-HR · PEOPLE, CONNECTED.</small></section><main className="login-main"><form className="login-card" onSubmit={submit}><span className="login-kicker">欢迎回来</span><h2>登录天意工作台</h2><p>使用你的操作人员账号，进入授权工作范围。</p>{notice && <Notice tone="warning">{notice}</Notice>}{error && <Notice tone="danger">{error.message}{error.code && <small className="error-code">{error.code}</small>}</Notice>}<label>账号<input name="login" autoComplete="username" autoFocus required maxLength={128} value={login} onChange={e => setLogin(e.target.value)} placeholder="请输入登录账号"/></label><label>密码<input name="password" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入密码"/></label><Button variant="primary login-submit" type="submit" busy={busy}>进入工作台<Icon name="arrow"/></Button><SsoLogin disabled={busy}/><div className="login-trust"><Icon name="lock" size={15}/>范围与操作权限由服务端核验</div></form><footer>天意人力资源系统 <span>ty-hr</span></footer></main></div>;
}

function Workspace({ api, session, data, scope, changeScope, logout, route, notice, setNotice, scopeBusy, scopeRevision }) {
  const [menuOpen, setMenuOpen] = useState(false); const [mobile, setMobile] = useState(() => matchMedia('(max-width:720px)').matches); const [searchOpen, setSearchOpen] = useState(false); const [search, setSearch] = useState('');
  useEffect(() => { const media = matchMedia('(max-width:720px)'); const change = () => { setMobile(media.matches); setMenuOpen(false); }; media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  useEffect(() => { if (!mobile || !menuOpen) return; const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = previous; }; }, [mobile, menuOpen]);
  const navigate = route => { setMenuOpen(false); go(route); };
  const groups = useMemo(() => visibleNavigation(session.capabilities), [session.capabilities]);
  const selectedPage = route === 'work' ? { name: '我的工作台', ready: true } : routePage(route);
  const currentGroup = groups.find(g => g.pages.some(p => p.id === selectedPage?.id));
  const [openGroups, setOpenGroups] = useState(new Set());
  useEffect(() => { setMenuOpen(false); if (currentGroup) setOpenGroups(old => new Set([...old, currentGroup.id])); }, [route, currentGroup?.id]);
  useEffect(() => { const keyboard = e => { if ((e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); setSearchOpen(true); } if (e.key === 'Escape') setMenuOpen(false); }; addEventListener('keydown', keyboard); return () => removeEventListener('keydown', keyboard); }, []);
  const pages = groups.flatMap(g => g.pages.map(p => ({ ...p, group: g.name })));
  const results = pages.filter(p => !search || `${p.name} ${p.subtitle || ''} ${p.group}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const open = page => { navigate(page.id); setSearchOpen(false); setSearch(''); };
  const context = { api, session, data, scope, go: navigate, notify: setNotice, onScopeChange:changeScope, scopeKey: JSON.stringify(scope) + ':' + scopeRevision };
  const groupBlock = g => <div key={g.id} className={`nav-group ${g.bottom ? 'nav-bottom' : ''}`}><button className={`nav-group-button ${currentGroup?.id === g.id ? 'selected' : ''}`} onClick={() => setOpenGroups(old => { const next = new Set(old); next.has(g.id) ? next.delete(g.id) : next.add(g.id); return next; })} aria-expanded={openGroups.has(g.id)}><Icon name={g.icon}/><span>{g.name}</span><span className="nav-chevron">{openGroups.has(g.id) ? '−' : '+'}</span></button>{openGroups.has(g.id) && <div className="nav-pages">{g.pages.map(p => <button key={p.id} className={selectedPage?.id === p.id ? 'active' : ''} onClick={() => navigate(p.id)} aria-current={selectedPage?.id === p.id ? 'page' : undefined}>{p.name}{!p.ready && <span className="pending-dot" title="新页面待接入"/>}</button>)}</div>}</div>;
  return <div className="workspace"><a href="#main-content" className="skip-link">跳到正文</a>{mobile && menuOpen && <button className="drawer-backdrop" aria-label="关闭导航遮罩" onClick={() => setMenuOpen(false)}/>}<aside id="business-sidebar" className={`sidebar ${mobile && menuOpen ? 'open' : ''}`} aria-hidden={mobile && !menuOpen ? true : undefined} inert={mobile && !menuOpen}><div className="sidebar-heading"><Brand/><button className="icon-button drawer-close" aria-label="关闭业务导航" onClick={() => setMenuOpen(false)}><Icon name="close"/></button></div><div className="nav-label">业务工作空间</div><nav aria-label="业务导航"><button className={`nav-home ${route === 'work' ? 'active' : ''}`} onClick={() => navigate('work')}><Icon name="home"/>我的工作台</button>{groups.filter(g => !g.bottom).map(groupBlock)}<div className="sidebar-divider"/>{groups.filter(g => g.bottom).map(groupBlock)}</nav><div className="sidebar-footer"><span className="online-dot"/>服务已连接<small>权限以服务端核验为准</small></div></aside><div className="workspace-main"><header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label="打开业务导航" aria-expanded={menuOpen} aria-controls="business-sidebar" onClick={() => setMenuOpen(true)}><Icon name="menu"/></button><div className="breadcrumb"><span>{currentGroup?.name || '个人工作'}</span><b> / </b>{selectedPage?.name || '页面'}</div></div><button className="global-search" onClick={() => setSearchOpen(true)}><Icon name="search" size={17}/><span>查找功能与页面</span><kbd>⌘ K</kbd></button><div className="identity"><span className="avatar">{(session.me.name || session.me.login || '用').slice(0, 1)}</span><div><b>{session.me.name || session.me.login}</b><small>{operatorProfileLabel(session.capabilities,session.me.role)}</small></div></div><button className="icon-button logout" onClick={logout} aria-label="退出登录" title="退出登录"><Icon name="exit"/></button></header><ScopeBar data={data} scope={scope} busy={scopeBusy} onChange={changeScope} notify={setNotice}/><main id="main-content" className="page-content" tabIndex={-1}>{notice && <div className="notice-row"><Notice>{notice}</Notice><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" size={16}/></button></div>}<Suspense fallback={<Loading/>}>{scopeBusy ? <Loading children="正在切换工作范围"/> : route === 'work' ? <WorkPage {...context} pages={pages}/> : !selectedPage || !selectedPage.access(session.capabilities) ? <ErrorState error={{ status: 403, message: '此入口不存在，或不在当前账号授权范围内。' }}/> : route.startsWith('payroll/batch/') ? <PayrollWorkbench {...context}/> : route.startsWith('services/workforce/') || route === 'services/vendors' ? <WorkforcePage {...context} section={route === 'services/vendors'?'vendors':route.split('/')[2]}/> : route === 'payroll/finance' ? <PayrollFinancePage {...context}/> : route === 'payroll/scripts' ? <PayrollScriptsPage {...context}/> : route === 'payroll/industry' ? <IndustryBasisPanel {...context}/> : (route.startsWith('payroll/setup/')||route==='payroll/rules') ? <PayrollSetup {...context} section={route==='payroll/rules'?'items':route.split('/')[2]}/> : ['payroll','payroll/rules','payroll/settings','payroll/payslips','payroll/tax','reports/cost','my/payslips'].includes(route) ? <PayrollWorkbench {...context} self={route==='my/payslips'} initialView={route==='payroll/rules'?'catalog':['payroll/settings','payroll/tax'].includes(route)?'settings':route==='reports/cost'?'costs':['payroll/payslips','my/payslips'].includes(route)?'rows':'batches'} initialConfigKind={route==='payroll/tax'?'policy':'systems'}/> : ['attendance/schedule','attendance/daily','attendance/monthly','attendance/changes','attendance/shifts','attendance/imports','attendance/versions','my/schedule'].includes(route) ? <RosteringPage {...context} initialView={route==='my/schedule'?'schedule':route.split('/')[1]} self={route==='my/schedule'}/> : route.startsWith('performance/') || route==='my/performance' ? <PerformancePage {...context} section={route==='my/performance'?'self':route.split('/')[1]} self={route==='my/performance'}/> : route.startsWith('attendance/leave') || route === 'my/leave' ? <LeavePage {...context} self={route === 'my/leave'} settings={route.endsWith('/settings')}/> : route === 'system/access' ? <SystemPage {...context} section="permissions"/> : route === 'system/forms' ? <SystemPage {...context} section="forms"/> : route === 'system/workflow' ? <SystemPage {...context} section="workflows"/> : (route==='payroll/contracts'||/^payroll\/contracts\/term\/[0-9]+$/.test(route)) ? <ContractPayroll {...context} initialTermId={route.split('/')[3]}/> : route === 'integrations/esign' ? <EsignPage {...context} settings/> : route === 'integrations/sso' ? <EnterpriseLoginPage {...context}/> : /^my\/(tasks|alerts)\/notice\/[a-f0-9]{32}$/.test(route) ? <NotificationLanding {...context} noticeKey={route.split('/')[3]} onClose={()=>navigate('work')}/> : route === 'integrations/reminders' ? <LifecycleReminders {...context}/> : route === 'integrations/notifications' ? <NotificationRulesPanel {...context}/> : route === 'integrations/runtime' ? <IntegrationRuntimePage {...context}/> : route === 'integrations/connections' ? <IntegrationsPage {...context}/> : ['my/tasks', 'my/requests', 'my/alerts'].includes(route) ? <PortalPage {...context} initialView={route.split('/')[1]}/>: ['people/certificates','people/items','services/dormitory'].includes(route) ? <SupportPage {...context} section={route==='people/certificates'?'certificates':route==='people/items'?'goods':'dormitory'}/> : (route.startsWith('learning/')||route==='my/learning') ? <LearningPage {...context} section={route.split('/')[1]} self={route==='my/learning'}/> : route === 'people/changes' ? <HRChangesPage {...context}/> : ['talent/recruit','people/contracts','people/contract-reminders'].includes(route) ? <RecruitmentContractsPage {...context} section={route==='talent/recruit'?'recruitment':route==='people/contracts'?'contracts':'reminders'}/> : route === 'organization' ? <OrganizationPage {...context}/> : route === 'people' ? <PeoplePage {...context}/> : route.startsWith('people/detail/') ? <PersonPage {...context} personId={route.split('/')[2]}/> : <UnavailablePage page={selectedPage}/>}</Suspense></main><footer className="workspace-footer"><span>天意人力资源系统</span><span>{session.me.today || ''} · {session.me.tz || '业务时区以系统设置为准'}</span></footer></div><nav className="mobile-bottom" aria-label="移动快捷导航"><button className={route === 'work' ? 'active' : ''} onClick={() => navigate('work')}><Icon name="home"/><span>工作台</span></button>{canPayroll(session.capabilities) && <button className={route.startsWith('payroll') ? 'active' : ''} onClick={() => navigate('payroll')}><Icon name="wallet"/><span>薪酬</span></button>}{canPeople(session.capabilities) && <button className={route.startsWith('people') ? 'active' : ''} onClick={() => navigate('people')}><Icon name="people"/><span>人员</span></button>}<button onClick={() => { setSearchOpen(true); }}><Icon name="search"/><span>搜索</span></button></nav>{searchOpen && <Modal title="查找功能" onClose={() => setSearchOpen(false)}><label className="search-field large"><Icon name="search"/><input autoFocus type="search" aria-label="全局功能搜索" placeholder="试试 工资、花名册、假期…" value={search} onChange={e => setSearch(e.target.value)}/></label><p className="subtle">仅列出当前账号有权访问的页面。</p><div className="search-results">{results.map(page => <button key={page.id} onClick={() => open(page)}><span><b>{page.name}</b><small>{page.group}{page.subtitle ? ` · ${page.subtitle}` : ''}</small></span><span className={page.ready ? 'ready-caption' : 'subtle'}>{page.ready ? '打开' : '待接入'}<Icon name="arrow" size={16}/></span></button>)}{!results.length && <EmptyState title="没有匹配的功能"/>}</div></Modal>}</div>;
}

function ScopeBar({ data, scope, busy, onChange, notify }) {
  const group = array(data.groups).find(g => same(g.id, scope.group_id));
  const brands = array(data.brands).filter(b => same(b.group_id, group?.id) && array(data.companies).some(c => same(c.brand_id, b.id)));
  const stores = array(data.companies).filter(c => ['store', undefined, null].includes(c.org_level) && c.company_kind === 'store' && (!scope.brand_id || same(c.brand_id, scope.brand_id)));
  const brandCompany = array(data.companies).find(c => same(c.id, scope.company_id) && c.org_level === 'brand');
  const storeValue = brandCompany ? '' : stores.some(c => same(c.id, scope.company_id)) ? String(scope.company_id) : '';
  const selectBrand = value => { try { onChange(brandScope(data, scope.group_id, value)); } catch (error) { notify(error.message); } };
  const selectStore = value => {
    try { if (!value) return onChange(brandScope(data, scope.group_id, scope.brand_id)); const store = stores.find(c => same(c.id, value)); if (!store) return; onChange({ group_id: scope.group_id, brand_id: store.brand_id || '', ledger_id: store.ledger_id || '', company_id: store.id }); }
    catch (error) { notify(error.message); }
  };
  return <div className="scope-bar" aria-label="当前工作范围"><div className="scope-title"><span className="scope-indicator"/>工作范围</div><label>集团<select aria-label="选择集团" disabled={busy} value={scope.group_id || ''} onChange={e => onChange({ group_id: e.target.value, brand_id: '', ledger_id: '', company_id: '' })}>{!data.groups.length && <option value="">暂无授权集团</option>}{array(data.groups).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label><span className="scope-separator">/</span><label>品牌公司<select aria-label="选择品牌公司" disabled={busy || !group} value={scope.brand_id || ''} onChange={e => selectBrand(e.target.value)}><option value="">全部授权品牌</option>{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><span className="scope-separator">/</span><label>门店<select aria-label="选择门店" disabled={busy || !group} value={storeValue} onChange={e => selectStore(e.target.value)}><option value="">全部授权门店</option>{stores.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><span className="scope-note"><Icon name="lock" size={13}/>仅当前授权范围</span></div>;
}
function WorkPage({ session, data, scope, pages, go }) {
  const experience=workspaceExperience(session.capabilities,pages),primary=experience.shortcuts[0];
  const people = personRows(data, scope, session.me.today || '');
  const companies = companiesInScope(data, scope);
  return <><PageHeading eyebrow="MY WORKSPACE" title={`${session.me.name || '你好'}，工作从这里开始`} description={`${experience.label} · 按当前工作范围查看与办理。`}/><div className="welcome-banner"><div><span>今天的工作焦点</span><h2>{experience.title.split('\n').map((line,index)=><React.Fragment key={line}>{index>0&&<br/>}{line}</React.Fragment>)}</h2><p>{experience.description}</p>{primary&&<Button variant="gold" onClick={()=>go(primary.id)}>进入{primary.name}<Icon name="arrow"/></Button>}</div><div className="banner-art" aria-hidden="true"><div className="art-sheet"><span/><b>TY-HR</b><i/><i/><i/></div><div className="art-chip"><Icon name="check"/>有序协同</div></div></div><div className="stats-grid">{session.capabilities.profile_code!=='config_admin'&&<Stat title="当前可见人员" value={people.length} unit="人" icon="people" caption="按当前返回的授权资料统计"/>}<Stat title="当前可见组织" value={companies.length} unit="个" icon="building" caption="仅统计有权查看的组织"/><Stat title="可用业务入口" value={experience.availableCount} unit="个" icon="calendar" caption="通过左侧菜单或功能搜索打开"/></div><section className="panel"><div className="panel-title"><h2>常用办理</h2><span>其余功能可通过菜单或搜索打开</span></div>{experience.shortcuts.length?<div className="task-grid">{experience.shortcuts.map(page=><button className="task-card" key={page.id} onClick={()=>go(page.id)}><span className="task-icon"><Icon name={/payroll|cost/.test(page.id)?'wallet':/schedule|attendance|leave/.test(page.id)?'calendar':page.id==='organization'?'building':page.id.startsWith('learning')?'book':page.id.startsWith('system')?'settings':'people'}/></span><b>{page.name}</b><p>{page.subtitle||page.group}</p><Icon name="arrow" size={16}/></button>)}</div>:<EmptyState title="暂无可用业务入口">请联系系统管理员核对当前账号的角色与授权范围。</EmptyState>}</section></>;
}
function UnavailablePage({ page }) { return <><PageHeading title={page.name} description="此页面已列入统一导航，新的操作页面尚未接入。"/><section className="panel"><EmptyState title="页面接入开发中">{page.id === 'attendance/leave' ? '高级假期将使用新的政策、额度台账与审批接口，当前入口不调用旧版假期写入。' : '当前没有已接通的办理入口，暂不能在这里创建、批准或查询业务结果。'}</EmptyState></section></>; }

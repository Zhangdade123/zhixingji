function habitReminderTime(h,day){
  if(!h)return '';
  let value=h.reminderTime;
  if(h.reminderWeek!=null){
    if(typeof h.reminderWeek!=='object'||Array.isArray(h.reminderWeek))return '';
    const weekday=new Date(day+'T00:00:00Z').getUTCDay()||7;
    value=h.reminderWeek[String(weekday)];
  }
  return typeof value==='string'&&/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)?value:'';
}
function habitReminderLabel(h,day){
  if(h.reminderWeek!=null){const time=habitReminderTime(h,day);return time?'今日 '+time:'今日不提醒';}
  return h.reminderTime||'设置提醒';
}
// Server push is used only after the deployed worker confirms habit support.
let habitPushState={scope:'',checkedAt:0,enabled:false,supported:false,error:''};
function habitPushScope(){const c=loadCloud();return c.session?.uid?cloudBase(c)+'|'+c.session.uid+'|'+c.device:'';}
async function refreshHabitPushState(force=false){
  const scope=habitPushScope();
  if(!scope)return {enabled:false,supported:false};
  if(!force&&habitPushState.scope===scope&&Date.now()-habitPushState.checkedAt<60000)return habitPushState;
  try{
    const result=await reminderPushAPI('status');
    if(scope!==habitPushScope())return {enabled:false,supported:false};
    habitPushState={scope,checkedAt:Date.now(),enabled:result.enabled===true,supported:result.habitReminders===true,error:'',job:result.job||null};
  }catch(e){habitPushState={scope,checkedAt:Date.now(),enabled:false,supported:false,error:e.message};}
  return habitPushState;
}
async function showHabitReminderStatus(){
  const target=$('#habit-reminder-status');if(!target)return;
  if(!habitPushScope()){target.textContent='请先登录网页版账号，再检查此设备的后台提醒。本地版不连接该后台。';return;}
  target.textContent='正在检查…';const state=await refreshHabitPushState(true);
  if(!target.isConnected)return;
  const permission=({granted:'已允许',denied:'已拒绝',default:'尚未授权'})[window.Notification?.permission]||'当前环境不支持';
  let localSubscription='无法读取';
  try{const registration=await navigator.serviceWorker?.getRegistration(new URL('./',location.href).href);const sub=await registration?.pushManager?.getSubscription();localSubscription=sub?'存在':'不存在';}catch{}
  if(!target.isConnected)return;
  target.textContent=(state.error?'后台状态检查失败，暂不能判断是否接通：'+state.error+'。':state.supported?(state.enabled?'服务器已登记此设备的习惯后台推送，与待办共用订阅。':'后台已支持习惯提醒；此设备尚未开启「后台事项提醒」。'):'服务器尚未确认习惯推送支持，请检查函数与 SQL 是否均已升级。')+
    ' 页面弹卡：'+(DB.settings.notify?'开':'关')+'；前台系统通知：'+(DB.settings.systemNotify?'开':'关')+'；系统权限：'+permission+'；本机推送订阅：'+localSubscription+'。'+
    (state.enabled&&localSubscription==='不存在'?'订阅状态不一致，请在此设备重新开启「后台事项提醒」。':'')+
    (state.job?'最近一次后台通知：'+(({accepted:'推送服务已接受（不代表手机已显示）',pending:'等待发送',sending:'发送中',failed:'发送失败',unknown:'结果未知'})[state.job.state]||state.job.state)+(state.job.error?'，'+state.job.error:'')+'。':'')+
    ' 请在手机实际使用的应用中检查；电脑结果不能代表手机。';
}
function openHabitReminder(id) {
  const h=DB.habits.find(h=>h.id===id);if(!h)return;
  const weekly=h.reminderWeek!=null,labels=['周一','周二','周三','周四','周五','周六','周日'];
  const week=weekly?h.reminderWeek:Object.fromEntries(labels.map((_,i)=>[i+1,h.reminderTime||'20:00']));
  $('#modalMask').innerHTML=`<div class="modal"><div class="modal-head"><h3>习惯提醒 · ${esc(h.title)}</h3><button data-act="close-modal">关闭</button></div><form class="modal-body habit-reminder-form">
    <label class="field">重复方式<select id="habit-reminder-mode"><option value="daily" ${!weekly?'selected':''}>每天</option><option value="weekly" ${weekly?'selected':''}>每周自定义</option></select></label>
    <label class="field" id="habit-daily-field">每天提醒时间（北京时间）<input type="time" id="habit-reminder-time" value="${esc(h.reminderTime||'20:00')}"></label>
    <fieldset id="habit-week-fields" style="border:0;padding:0;margin:0"><legend>选择提醒日期与时间（北京时间）</legend>
      <div class="head-actions" style="margin:10px 0"><button type="button" class="btn-text" data-habit-days="workdays">工作日</button><button type="button" class="btn-text" data-habit-days="weekend">周末</button><button type="button" class="btn-text" data-habit-days="all">全选</button></div>
      ${labels.map((label,i)=>`<div class="habit-week-time-row" style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:8px 0"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" data-habit-week-day="${i+1}" ${week[i+1]?'checked':''} style="width:18px;height:18px">${label}</label><input type="time" data-habit-week-time="${i+1}" value="${esc(week[i+1]||h.reminderTime||'20:00')}" aria-label="${label}提醒时间" style="width:145px;min-width:0"></div>`).join('')}
    </fieldset>
    <p>页面保持运行时，按选定日期和时间提醒尚未打卡的习惯；后台接通后，手机可共用待办推送。未选中的日期不提醒，已打卡、停用或删除后不再提醒。</p><p>系统通知沿用「我的」中的事项通知设置，无需单独开启。</p><button class="btn btn-ghost" type="button" id="habit-check-status">检查提醒状态</button><p id="habit-reminder-status" role="status"></p><div class="head-actions"><button class="btn btn-primary" type="submit">保存提醒</button><button class="btn btn-ghost" type="button" id="habit-reminder-disable">关闭提醒</button></div></form></div>`;
  $('#modalMask').classList.add('show');
  const form=$('.habit-reminder-form');
  const updateFields=()=>{
    const weekly=$('#habit-reminder-mode').value==='weekly';
    $('#habit-daily-field').hidden=weekly;$('#habit-reminder-time').disabled=weekly;$('#habit-reminder-time').required=!weekly;
    $('#habit-week-fields').hidden=!weekly;$('#habit-week-fields').disabled=!weekly;
    form.querySelectorAll('[data-habit-week-day]').forEach(box=>{const input=form.querySelector('[data-habit-week-time="'+box.dataset.habitWeekDay+'"]');input.disabled=!weekly||!box.checked;input.required=weekly&&box.checked;});
  };
  form.onchange=updateFields;updateFields();
  form.querySelectorAll('[data-habit-days]').forEach(button=>button.onclick=()=>{form.querySelectorAll('[data-habit-week-day]').forEach(box=>{const day=Number(box.dataset.habitWeekDay);box.checked=button.dataset.habitDays==='all'||(button.dataset.habitDays==='workdays'?day<=5:day>=6);});updateFields();});
  const save=(time,week)=>{
    const current=DB.habits.find(x=>x.id===id);if(!current)return;
    const previous={time:current.reminderTime,week:current.reminderWeek};current.reminderTime=time;current.reminderWeek=week;
    if(!persist()){current.reminderTime=previous.time;current.reminderWeek=previous.week;return;}
    closeModal();rerenderCurrent();toast(week?'已保存每周提醒':time?'已设置每天 '+time+' 提醒':'已关闭习惯提醒');checkHabitReminders();
  };
  form.onsubmit=e=>{
    e.preventDefault();
    if($('#habit-reminder-mode').value==='weekly'){
      const schedule={};form.querySelectorAll('[data-habit-week-day]:checked').forEach(box=>{schedule[box.dataset.habitWeekDay]=form.querySelector('[data-habit-week-time="'+box.dataset.habitWeekDay+'"]').value;});
      if(!Object.keys(schedule).length){toast('请至少选择一天，或点击关闭提醒');return;}
      if(Object.values(schedule).every(v=>/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v)))save(null,schedule);
    }else{const value=$('#habit-reminder-time').value;if(/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value))save(value,null);}
  };
  $('#habit-reminder-disable').onclick=()=>save(null,null);
  $('#habit-check-status').onclick=showHabitReminderStatus;
}
let habitReminderBusy=false;
async function checkHabitReminders(){
  if(habitReminderBusy||!cloudReady||cloudPending||storageBlocked)return;
  habitReminderBusy=true;
  try{
    const backend=await refreshHabitPushState();
    if(!cloudReady||cloudPending||storageBlocked)return;
    const day=businessToday(),now=Date.now(),scope=STORE+'-habit-reminders-'+(loadCloud().session?.uid||'local');
    const stillCurrent=h=>scope===STORE+'-habit-reminders-'+(loadCloud().session?.uid||'local')&&businessToday()===day&&(DB.habits||[]).some(x=>x.id===h.id&&!x.archived&&!x.checkins[day]&&habitReminderTime(x,day)===h.reminderTime);
    let ledger;try{ledger=JSON.parse(safeGet(scope)||'{}');}catch{ledger={};}
    if(!ledger||typeof ledger!=='object'||Array.isArray(ledger))ledger={};
    const due=(DB.habits||[]).map(h=>({...h,reminderTime:habitReminderTime(h,day)})).filter(h=>!h.archived&&!h.checkins[day]&&h.reminderTime&&now>=taskStamp(day+' '+h.reminderTime));
    const alert=document.querySelector('#habit-reminder-alert');
    if(alert&&(!DB.settings.notify||!due.some(h=>h.id===alert.dataset.habit)))alert.remove();
    for(const h of due){
      const key=h.id+'|'+day+'|'+h.reminderTime;
      let entry=ledger[key];
      if(typeof entry==='number')entry={page:true,system:true,at:entry};
      entry ||= {page:false,system:false,at:now,retryAt:0};
      if(entry.page&&entry.system)continue;
      const system=DB.settings.systemNotify&&window.Notification?.permission==='granted';
      if(document.hidden&&!system)continue;
      let delivered=false;
      if(backend.enabled&&backend.supported){entry.system=true;delivered=true;}
      if(system&&!entry.system&&(!entry.retryAt||entry.retryAt<=now)){try{
        const options={body:h.title,tag:'habit-'+key,data:{habitId:h.id}};
        const worker=await prepareNotificationWorker();
        if(!stillCurrent(h))continue;
        if(worker)await worker.showNotification('知行记 · 习惯提醒',options);
        else{const n=new Notification('知行记 · 习惯提醒',options);n.onclick=()=>{window.focus();go('home');n.close();};}
        entry.system=true;delivered=true;
      }catch{entry.retryAt=now+30000;}}
      if(!stillCurrent(h))continue;
      if(DB.settings.notify&&!entry.page&&!document.hidden&&!document.querySelector('#habit-reminder-alert')){
        const panel=document.createElement('aside');panel.id='habit-reminder-alert';panel.dataset.habit=h.id;panel.className='card habit-alert';panel.setAttribute('role','status');
        panel.innerHTML=`<div class="card-head"><h3>习惯提醒</h3><span class="time-chip">${esc(h.reminderTime)}</span></div><p>${esc(h.title)}</p><div class="head-actions"><button class="btn btn-primary" data-habit-alert-done>完成打卡</button><button class="btn btn-ghost" data-habit-alert-close>知道了</button></div>`;
        panel.querySelector('[data-habit-alert-close]').onclick=()=>panel.remove();
        panel.querySelector('[data-habit-alert-done]').onclick=()=>{
          const current=DB.habits.find(x=>x.id===h.id);if(!current||current.archived){panel.remove();return;}
          const date=businessToday(),old=current.checkins[date];current.checkins[date]=true;
          if(!persist()){if(old===undefined)delete current.checkins[date];else current.checkins[date]=old;return;}
          panel.remove();rerenderCurrent();toast('今日打卡完成');
        };
        document.body.append(panel);entry.page=true;delivered=true;
      }
      if(delivered||entry.retryAt){ledger[key]=entry;for(const k of Object.keys(ledger))if((typeof ledger[k]==='number'?ledger[k]:ledger[k].at)<now-7*86400000)delete ledger[k];try{localStorage.setItem(scope,JSON.stringify(ledger));}catch{} }
    }
  }finally{habitReminderBusy=false;}
}
setInterval(checkHabitReminders,5000);
window.addEventListener('online',()=>{habitPushState.checkedAt=0;checkHabitReminders();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkHabitReminders();});
navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='open-habit-reminder')go('home');});

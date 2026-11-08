// Embedded in both entry pages by build-daily-habits.cjs.
(() => {
  const baseHome = renderHome;
  const today = () => businessToday();
  const habits = () => DB.habits || [];
  const foldKey = STORE + '-habits-collapsed';
  let collapsed = safeGet(foldKey) === 'true';
  function streak(h, day) {
    let cursor = h.checkins[day] ? day : addDays(day, -1), count = 0;
    while (h.checkins[cursor]) { count++; cursor = addDays(cursor, -1); }
    return count;
  }
  function change(fn) {
    const previous = JSON.parse(JSON.stringify(habits()));
    fn();
    if (!persist()) { DB.habits = previous; renderHome(); return false; }
    renderHome(); return true;
  }
  function renderHabits() {
    const root = document.querySelector('#view-home');
    root.querySelector('#daily-habits')?.remove();
    const day = today(), active = habits().filter(h => !h.archived).sort((a, b) => {
      const aTime=habitReminderTime(a,day),bTime=habitReminderTime(b,day);
      const aOffDay=a.reminderWeek!=null&&!aTime,bOffDay=b.reminderWeek!=null&&!bTime;
      return Number(aOffDay)-Number(bOffDay)||aTime.localeCompare(bTime);
    });
    const done = active.filter(h => h.checkins[day]).length;
    const days = Array.from({length:7}, (_, i) => addDays(day, i - 6));
    const panel = document.createElement('section');
    panel.id = 'daily-habits'; panel.className = 'card';
    panel.innerHTML = `<h3 class="habit-heading"><button type="button" class="card-head habit-fold" aria-expanded="${!collapsed}" aria-controls="habit-content"><span>每日习惯</span><span class="habit-fold-meta"><span aria-live="polite">今日 ${done} / ${active.length} 已完成</span><span class="habit-fold-label">${collapsed ? '展开 ▾' : '收起 ▴'}</span></span></button></h3>
      <div id="habit-content" class="habit-body" ${collapsed ? 'hidden' : ''}><p class="habit-hint">每天坚持一点 · 近七天记录</p>
      <progress aria-label="今日习惯完成进度" max="${active.length || 1}" value="${done}"></progress>
      ${active.length ? active.map(h => `<div class="habit-row todo-row ${h.checkins[day] ? 'is-done' : ''}"><button class="check" data-habit-toggle="${esc(h.id)}" aria-label="打卡：${esc(h.title)}" aria-pressed="${!!h.checkins[day]}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></button><div class="habit-info todo-main"><strong class="todo-title">${esc(h.title)}</strong><small>连续 ${streak(h, day)} 天 · 累计 ${Object.values(h.checkins).filter(Boolean).length} 天</small><div class="habit-week" aria-label="近七天记录">${days.map(d => `<span class="${h.checkins[d] ? 'checked' : ''}" title="${d} ${h.checkins[d] ? '已打卡' : '未打卡'}" aria-label="${d} ${h.checkins[d] ? '已打卡' : '未打卡'}">${d.slice(8)}${h.checkins[d] ? ' ✓' : ''}</span>`).join('')}</div></div><div class="habit-actions"><button class="${h.reminderTime || h.reminderWeek ? 'time-chip' : 'btn-text'}" data-habit-reminder="${esc(h.id)}">${esc(habitReminderLabel(h,day))}</button><button class="btn-text" data-habit-archive="${esc(h.id)}">停用</button><button class="btn-text" data-habit-delete="${esc(h.id)}">删除</button></div></div>`).join('') : '<p class="habit-empty">从一个小目标开始，比如阅读 20 分钟、散步或早睡。</p>'}
      <form id="habit-add-form"><label for="habit-title">添加每日习惯</label><div class="habit-add"><input id="habit-title" maxlength="80" required placeholder="例如：每天阅读 20 分钟" autocomplete="off"><button class="btn btn-primary" type="submit">添加</button></div></form>
      ${habits().some(h => h.archived) ? `<details><summary>已停用的习惯</summary>${habits().filter(h => h.archived).map(h => `<div class="habit-archived"><span>${esc(h.title)}</span><button class="btn-text" data-habit-restore="${esc(h.id)}">恢复</button><button class="btn-text" data-habit-delete="${esc(h.id)}">删除</button></div>`).join('')}</details>` : ''}</div>`;
    root.querySelector('.page-head').after(panel);
    panel.querySelector('.habit-fold').onclick = e => {
      collapsed = !collapsed;
      const button = e.currentTarget;
      button.setAttribute('aria-expanded', String(!collapsed));
      button.querySelector('.habit-fold-label').textContent = collapsed ? '展开 ▾' : '收起 ▴';
      panel.querySelector('#habit-content').hidden = collapsed;
      try { localStorage.setItem(foldKey, String(collapsed)); } catch {}
    };
    panel.querySelector('form').onsubmit = e => {
      e.preventDefault(); const input = panel.querySelector('input'), title = input.value.trim();
      if (!title) { input.setCustomValidity('请输入习惯名称'); input.reportValidity(); return; }
      if (active.some(h => h.title === title)) { toast('这个习惯已经在列表中'); return; }
      if (change(() => { DB.habits ||= []; DB.habits.push({id:uid(), title, createdAt:Date.now(), archived:false, checkins:{}}); })) toast('已添加每日习惯');
    };
    panel.querySelector('input').oninput = e => e.target.setCustomValidity('');
    panel.onclick = e => {
      const button = e.target.closest('button'); if (!button) return;
      const id = button.dataset.habitDelete || button.dataset.habitReminder || button.dataset.habitToggle || button.dataset.habitArchive || button.dataset.habitRestore;
      const h = habits().find(x => x.id === id); if (!h) return;
      if (button.dataset.habitDelete) {
        if(confirm('删除“'+h.title+'”？该习惯、提醒时间和全部打卡记录将永久删除，无法恢复。')){
          if(change(()=>{DB.habits=habits().filter(x=>x.id!==h.id);})){document.querySelector('#habit-reminder-alert[data-habit="'+h.id+'"]')?.remove();toast('已删除习惯');}
        }
      } else if (button.dataset.habitReminder) { openHabitReminder(h.id);
      } else if (button.dataset.habitToggle) {
        const date = today(), completed = !h.checkins[date];
        if (change(() => { h.checkins[date] = completed; })) toast(completed ? '今日打卡完成，继续保持！' : '已撤销今日打卡');
      } else if (button.dataset.habitArchive) {
        if (confirm('停用“' + h.title + '”？历史打卡会保留，之后可以恢复。')) change(() => { h.archived = true; });
      } else if (button.dataset.habitRestore) change(() => { h.archived = false; });
    };
  }
  renderHome = function() { baseHome(); renderHabits(); };
  const style = document.createElement('style');
  style.textContent = `#daily-habits{margin-bottom:22px}.habit-body{padding:0 22px 22px}.habit-hint,.habit-info small{color:var(--muted);font-size:13px}.habit-body progress{width:100%;height:8px;accent-color:var(--ok);margin:12px 0}.habit-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 0;border-bottom:1px solid var(--divider)}.habit-info{min-width:0}.habit-info strong{display:block;overflow-wrap:anywhere;color:var(--ink)}.habit-info small{display:block;margin:3px 0 8px}.habit-week{display:flex;gap:5px;flex-wrap:wrap}.habit-week span{font-size:11px;padding:3px 6px;border-radius:6px;background:var(--bg);color:var(--muted)}.habit-week .checked{background:#e6f5ed;color:#21794e}.habit-actions{display:flex;align-items:center;gap:12px;flex-shrink:0}.habit-empty{padding:12px 0;color:var(--muted)}#habit-add-form{margin-top:18px}#habit-add-form label{font-size:13px}.habit-add{display:flex;gap:8px;margin-top:6px}.habit-add input{min-width:0;flex:1;border:1px solid var(--border);border-radius:9px;padding:9px 12px;background:var(--card)}.habit-add input:focus{border-color:var(--accent)}.habit-body details{margin-top:16px;font-size:13px}.habit-archived{display:flex;justify-content:space-between;gap:12px;padding:8px 0;overflow-wrap:anywhere}@media(max-width:600px){.habit-body{padding:0 16px 16px}.habit-row{align-items:flex-start;flex-direction:column}.habit-actions{width:100%;justify-content:flex-end}#daily-habits .card-head{gap:8px;flex-wrap:wrap}}`;
  document.head.append(style);
  style.textContent += `.habit-heading{margin:0}.habit-fold{width:100%;text-align:left;margin:0;font-weight:600;font-size:16px;cursor:pointer}.habit-fold:hover{background:var(--bg)}.habit-fold:focus-visible{outline:2px solid var(--accent);outline-offset:-4px;border-radius:var(--radius)}.habit-fold-meta{display:flex;align-items:center;gap:14px;font-size:13px;font-weight:400}.habit-fold-label{color:var(--muted);white-space:nowrap}.habit-body[hidden]{display:none}`;
  let lastDay = today();
  style.textContent += `
    .habit-fold>span:first-child{font-family:var(--serif);font-size:17.5px;letter-spacing:.5px}
    .habit-fold-meta [aria-live]{font-family:var(--serif);font-weight:600;letter-spacing:.5px}
    .habit-archived>span{min-width:0;flex:1}.habit-archived>button{flex-shrink:0}.habit-archived [data-habit-restore]{margin-left:auto}
    #cloud-authority-state,#saveState,#cloud-state,#ds-row-status{display:none!important}
    #daily-habits .habit-body{padding:0}.habit-body .habit-row{padding:10px 5px;align-items:flex-start;gap:12px}
    .habit-info{flex:1}.habit-info strong{font-weight:500}.habit-body .habit-info small{margin:2px 0 6px}
    .habit-body progress{display:block;height:4px;border:0;overflow:hidden;border-radius:4px;background:var(--divider);accent-color:var(--accent);margin:10px 0}
    .habit-body progress::-webkit-progress-bar{background:var(--divider)}.habit-body progress::-webkit-progress-value{background:var(--accent)}
    .habit-week span{padding:1px 4px;min-width:25px;text-align:center}.habit-week .checked{background:var(--accent-weak);color:var(--accent)}
    .habit-actions{gap:10px}.habit-body .habit-row .check{margin-top:3px}.habit-body .habit-row .check svg{width:16px;height:16px}.habit-body .todo-main{cursor:default}
    #habit-add-form{margin-top:12px}.habit-add input{font-size:14px;padding:7px 10px}.habit-add .btn{font-size:14px;padding:6px 12px}
    .habit-reminder-form input[type=time]{display:block;width:100%;padding:10px;border:1px solid var(--border);border-radius:9px;margin-top:8px}
    .habit-reminder-form p{font-size:14px;color:var(--muted);margin:14px 0}.habit-reminder-form .head-actions{flex-wrap:wrap}
    .habit-alert{position:fixed;right:24px;bottom:28px;z-index:110;max-width:380px;width:calc(100% - 32px)}.habit-alert p{margin:12px 0;overflow-wrap:anywhere}.habit-alert .head-actions{flex-wrap:wrap}
    @media(max-width:600px){.habit-body .habit-row{display:grid;grid-template-columns:22px minmax(0,1fr);gap:8px}.habit-actions{grid-column:2;width:auto;justify-content:flex-start}.habit-fold-meta{gap:7px;font-size:12px}.habit-alert{right:16px;bottom:90px}}
  `;
  function refreshDay() { const day = today(); if (day !== lastDay) { lastDay = day; if (currentRoute() === 'home') renderHome(); } }
  setInterval(refreshDay, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDay(); });
})();

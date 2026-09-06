// Attachment transfer state is device-local; only confirmed object references sync.
const attachmentTransfers=new Map();
let attachmentScanBusy=false;
function attachmentStatus(a){const s=attachmentTransfers.get(a.id);return s?.busy?'上传中':s?.error?'仅本机 · 上传失败':a.cloudFile?'已同步':'仅本机';}
function attachmentLink(a){return a.id?`<button class="btn-text" data-act="download-attachment" data-file="${esc(a.id)}">${esc(a.name)}</button><small data-file-status="${esc(a.id)}">${attachmentStatus(a)}</small><button class="btn-text" data-act="upload-attachment" data-file="${esc(a.id)}">${a.cloudFile?'检查同步':'上传 / 重试'}</button>`:`<span>${esc(a.name)} <small>仅文件名，需重新添加原文件</small></span>`;}
function refreshAttachmentStatus(){document.querySelectorAll('[data-file-status]').forEach(el=>{const a=allAttachments().find(a=>a.id===el.dataset.fileStatus);if(a){el.textContent=attachmentStatus(a);el.title=attachmentTransfers.get(a.id)?.error||'';}});}
async function attachmentContext(){const c=loadCloud(),epoch=cloudEpoch;if(storageBlocked||!c.enabled||!c.session||!c.bound||c.lastUid!==c.session.uid||c.status==='conflict')throw Error('请先登录并完成账号数据同步，处理版本冲突');if(!await ensureToken()||!cloudSessionMatches(c,epoch))throw Error('登录已变化，请重试');return {c:loadCloud(),epoch};}
function storageObjectURL(c,path,download=false){return cloudBase(c)+'/storage/v1/object/'+(download?'authenticated/':'')+'zxj-files/'+path.split('/').map(encodeURIComponent).join('/');}
async function uploadAttachment(id,manual=true){
  if(attachmentTransfers.get(id)?.busy)return;
  const a=allAttachments().find(a=>a.id===id);if(!a)return;
  attachmentTransfers.set(id,{busy:true});refreshAttachmentStatus();fileJobs++;
  try{
    const {c,epoch}=await attachmentContext();
    if(a.cloudFile){if(a.cloudFile.owner!==c.session.uid||a.cloudFile.base!==cloudBase(c))throw Error('原文件属于其他账号或存储项目');if(manual)toast('原文件已上传；附件清单随账号数据同步');return;}
    const blob=await blobGet(id);if(!blob)throw Error('此设备没有原文件，请在最初添加文件的设备上传');
    if(blob.size>20*1048576)throw Error('文件超过 20MB');
    const path=c.session.uid+'/'+uid();
    await cloudFetch(storageObjectURL(c,path),{method:'POST',headers:{...cloudHeaders(c),'Content-Type':blob.type||'application/octet-stream','x-upsert':'false'},body:blob});
    if(!cloudSessionMatches(c,epoch)||!allAttachments().includes(a)||storageBlocked)throw Error('账号或附件已变化，上传结果未关联，请重试');
    for(const ref of allAttachments().filter(x=>x.id===id)){ref.cloudFile={base:cloudBase(c),owner:c.session.uid,path};ref.localOnly=false;}persist();
    attachmentTransfers.delete(id);if(manual)toast('原文件已上传，正在同步附件清单');
  }catch(e){attachmentTransfers.set(id,{error:e.message+'。若提示 HTTP 400/403/404，请先执行附件存储初始化 SQL。'});if(manual)toast(attachmentTransfers.get(id).error);}
  finally{fileJobs--;const s=attachmentTransfers.get(id);if(s?.busy)attachmentTransfers.delete(id);refreshAttachmentStatus();}
}
async function syncAttachments(){if(attachmentScanBusy||storageBlocked)return;const c=loadCloud();if(!c.enabled||!c.bound||!c.session||c.lastUid!==c.session.uid||c.status==='conflict')return;attachmentScanBusy=true;try{for(const a of [...new Map(allAttachments().filter(a=>a.id).map(a=>[a.id,a])).values()])if(!a.cloudFile&&!attachmentTransfers.has(a.id))await uploadAttachment(a.id,false);}finally{attachmentScanBusy=false;}}
async function downloadAttachment(id){try{const a=allAttachments().concat(ui.ntFiles||[],ui.quickFiles||[]).find(a=>a.id===id);if(!a)return;let blob=await blobGet(id);if(!blob&&a.cloudFile){const {c,epoch}=await attachmentContext();if(a.cloudFile.owner!==c.session.uid||a.cloudFile.base!==cloudBase(c)||!a.cloudFile.path.startsWith(c.session.uid+'/'))throw Error('请登录原文件所属账号和项目');toast('正在下载原文件');const r=await cloudFetch(storageObjectURL(c,a.cloudFile.path,true),{headers:cloudHeaders(c)});blob=await r.blob();if(!cloudSessionMatches(c,epoch))throw Error('账号已切换，已取消下载');if(blob.size>20*1048576)throw Error('文件超过 20MB');try{await blobPut(id,blob);}catch(e){toast('本机缓存空间不足，仍可下载文件');}}if(!blob)throw Error('仅本机附件：请在原设备上传后再同步');downloadBlob(a.name,blob);}catch(e){toast('附件下载失败：'+e.message);}}
function attachmentPanel(){flushEditor();$('#modalMask').innerHTML=`<div class="modal"><div class="modal-head"><h3>附件跨设备同步</h3><button data-act="close-modal">关闭</button></div><div class="modal-body"><p>同一账号登录后，原文件上传到私有存储。首次使用请在 Supabase SQL 编辑器执行初始化脚本，再点击上传。本机没有原文件的旧附件需在原设备上传。</p><a href="./知行记-附件存储.sql" download>下载附件存储初始化 SQL</a><p>上传后还需完成账号数据同步，其他设备才能看到附件。移除附件不会立即清除云文件，避免影响其他引用及备份。</p>${allAttachments().filter((a,i,arr)=>arr.findIndex(x=>x.id===a.id)===i).map(a=>`<p>${attachmentLink(a)}</p>`).join('')||'<p>暂无附件</p>'}</div></div>`;$('#modalMask').classList.add('show');}
function checklistProgress(t){const a=t.checklist||[];return a.length?`<small class="check-progress">步骤 ${a.filter(x=>x.done).length}/${a.length}<progress max="${a.length}" value="${a.filter(x=>x.done).length}" aria-label="子任务完成进度"></progress></small>`:'';}
function checklistRow(x={}){return `<div class="check-row"><input type="checkbox" aria-label="步骤完成" ${x.done?'checked':''}><input type="text" maxlength="300" aria-label="步骤名称" value="${esc(x.title||'')}" placeholder="输入一个步骤"><button type="button" data-check-remove aria-label="删除步骤">×</button></div>`;}
function checklistEditor(t){return `<div class="field"><label>子任务与检查清单</label><div id="checklist-rows">${(t.checklist||[]).map(checklistRow).join('')}</div><button type="button" data-check-add>＋ 添加步骤</button> <button type="button" data-check-paper>添加论文步骤</button><p class="cl-sub">勾选保存后更新进度；完成全部步骤后可手动完成事项。</p></div>`;}
function readChecklist(){return [...document.querySelectorAll('#checklist-rows .check-row')].map(el=>({title:el.querySelector('input[type=text]').value.trim(),done:el.querySelector('input[type=checkbox]').checked})).filter(x=>x.title);}
function weekBounds(day){const n=(pdate(day).getDay()+6)%7,start=addDays(day,-n);return [start,addDays(start,6)];}
function beijingDate(stamp){return Number.isFinite(stamp)?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date(stamp)):'';}
function weeklyData(day){const [start,end]=weekBounds(day),inside=d=>d>=start&&d<=end;return {start,end,next:addDays(start,7),done:DB.todos.filter(t=>t.done&&inside(beijingDate(t.doneAt))),delayed:DB.todos.filter(t=>(!t.done&&t.date&&t.date<=end&&t.date<businessToday())||(t.dateChanges||[]).some(x=>inside(beijingDate(x.at))&&x.to>x.from)),notes:DB.notes.filter(n=>inside(beijingDate(n.createdAt)))};}
function openWeekly(day=businessToday()){
  flushEditor();const w=weeklyData(day);const item=(r,type)=>`<label class="weekly-item"><input type="checkbox" data-week-type="${type}" value="${esc(r.id)}"><span>${esc(r.title||'无标题')}${type==='todo'&&r.done?'（已完成，可建立后续事项）':''}</span></label>`;
  $('#modalMask').innerHTML=`<div class="modal"><div class="modal-head"><h3>每周回顾与下周安排</h3><button data-act="close-modal">关闭</button></div><div class="modal-body"><label>选择回顾周内任意一天 <input type="date" id="weekly-day" value="${w.start}"></label><p>${w.start} ～ ${w.end}</p><h4>完成事项（${w.done.length}）</h4>${w.done.map(t=>item(t,'todo')).join('')||'<p>暂无</p>'}<h4>延期事项（${w.delayed.length}）</h4><p>包含当前逾期事项及本周记录的向后改期；旧版本改期历史无法追溯。</p>${w.delayed.map(t=>item(t,'todo')).join('')||'<p>暂无</p>'}<h4>新增笔记（${w.notes.length}）</h4>${w.notes.map(n=>item(n,'note')).join('')||'<p>暂无</p>'}<label>安排到下周 <input type="date" id="weekly-target" min="${w.next}" max="${addDays(w.next,6)}" value="${w.next}"></label><p>未完成事项移到所选日期；已完成事项与笔记生成后续待办。同一来源同一周不会重复生成。新事项不自动设置提醒。</p><button class="btn btn-primary" id="weekly-generate">将勾选内容安排到下周</button></div></div>`;
  $('#modalMask').classList.add('show');$('#weekly-day').onchange=e=>{if(e.target.value)openWeekly(e.target.value);};$('#weekly-generate').onclick=()=>generateWeekly(w);
}
function recordDateChange(t,from,to){if(from&&to&&to>from)(t.dateChanges||(t.dateChanges=[])).push({from,to,at:Date.now()});}
function generateWeekly(w){
  if(storageBlocked){toast('请先恢复数据保存');return;}const target=$('#weekly-target').value;if(target<w.next||target>addDays(w.next,6)){toast('请选择下周范围内的日期');return;}
  const selected=[...document.querySelectorAll('[data-week-type]:checked')],seen=new Set();let count=0;
  for(const el of selected){const type=el.dataset.weekType,key=type+':'+el.value+':'+w.next;if(seen.has(key))continue;seen.add(key);const src=(type==='todo'?DB.todos:DB.notes).find(x=>x.id===el.value);if(!src)continue;
    if(type==='todo'&&!src.done){if(src.date===target)continue;recordDateChange(src,src.date,target);src.date=target;src.reminder=null;count++;continue;}
    if([...DB.todos,...DB.trash.todos.map(x=>x.item)].some(t=>t.weeklySource===key))continue;
    DB.todos.push({id:uid(),title:(type==='note'?'跟进：':'后续：')+(src.title||'无标题'),cat:src.cat||DB.categories[0].id,date:target,time:null,reminder:null,priority:src.priority||'mid',tags:[...(src.tags||[])],note:'来自 '+w.start+' ～ '+w.end+' 每周回顾',attachments:[],checklist:[],repeat:'none',done:false,doneAt:null,createdAt:Date.now(),weeklySource:key,linkedNoteId:type==='note'?src.id:null});count++;
  }
  if(!selected.length){toast('请先勾选要安排的内容');return;}if(count){persist();rerenderCurrent();}toast(count?'已安排 '+count+' 条待办':'所选内容已安排，无需重复生成');
}
function initFeatures(){
  setInterval(syncAttachments,30000);
  document.addEventListener('click',e=>{const el=e.target.closest('button');if(!el)return;const rows=$('#checklist-rows');if(el.hasAttribute('data-check-remove'))el.closest('.check-row').remove();if(rows&&el.hasAttribute('data-check-add'))rows.insertAdjacentHTML('beforeend',checklistRow());if(rows&&el.hasAttribute('data-check-paper'))for(const title of ['文献检索','实验与数据整理','绘图','撰写初稿','修改与校对'])rows.insertAdjacentHTML('beforeend',checklistRow({title}));});
}

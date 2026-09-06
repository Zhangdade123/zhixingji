const FIXED_CLOUD_URL='https://xpspmpgicjdtmmclzbuo.supabase.co';
const FIXED_CLOUD_KEY='sb_publishable_s2T0ztl8_RDdI0lXUn70tw_JFuUej_Z';
let tokenRefreshJob=null;
async function ensureToken(){
  if(tokenRefreshJob)return tokenRefreshJob;
  const job=refreshCloudToken();tokenRefreshJob=job;
  try{return await job;}finally{if(tokenRefreshJob===job)tokenRefreshJob=null;}
}
function syncErrorMessage(e){
  if(e.name==='AbortError'||e.name==='TimeoutError')return '连接超时，请保持页面打开并重试';
  if(/load failed|failed to fetch|network|fetch failed/i.test(e.message||''))return navigator.onLine===false?'当前离线，本机内容已保留，联网后重试':'网络请求未完成，请检查手机网络或切换 Wi-Fi/蜂窝网络后重试';
  return e.message||'同步未完成';
}
async function storeCloudRecovery(){
  // Preserve the data snapshot; attachment blobs remain in the same IndexedDB.
  // Avoid base64 expansion and Safari download navigation during cloud selection.
  const data=businessSnapshot();const snapshot={format:'zhixingji-recovery',savedAt:Date.now(),data};
  await blobPut('cloud-recovery',new Blob([JSON.stringify(snapshot)],{type:'application/json'}));
}
function offerBackupFile(name,blob,message='备份已生成，请保存到「文件」或下载。'){
  const file=new File([blob],name,{type:'application/json'});
  $('#modalMask').innerHTML=`<div class="modal backup-modal"><div class="modal-head"><h3>保存备份</h3><button data-act="close-modal">关闭</button></div><div class="modal-body"><p>${esc(message)}</p><p>${esc(name)} · ${fmtSize(blob.size)}</p><button class="btn btn-primary" id="backup-share">保存到文件 / 分享</button> <button class="btn" id="backup-download">下载备份</button><p id="backup-status" role="status"></p></div></div>`;$('#modalMask').classList.add('show');
  const share=$('#backup-share');share.hidden=!navigator.canShare?.({files:[file]});
  share.onclick=async()=>{try{await navigator.share({files:[file],title:'知行记备份'});}catch(e){if(e.name!=='AbortError'&&$('#backup-status'))$('#backup-status').textContent='分享未完成，请尝试下载备份';}};
  $('#backup-download').onclick=()=>downloadBlob(name,blob);
}
async function exportCloudRecovery(){
  try{const blob=await blobGet('cloud-recovery');if(!blob)throw Error('尚无切换前快照');const saved=JSON.parse(await blob.text());
    const data=migrate(saved.data),backup=await makeBackup(data);offerBackupFile('知行记-切换云端前备份.json',new Blob([JSON.stringify(backup)],{type:'application/json'}),'这是最近一次切换云端前保存在此设备的快照。'+(backup.missingFiles.length?'部分原附件不在本机，详见备份清单。':''));
  }catch(e){toast('导出失败：'+syncErrorMessage(e));}
}
function initMobileSync(){
  const update=()=>{const v=window.visualViewport;document.documentElement.style.setProperty('--visible-height',(v?.height||innerHeight)+'px');document.documentElement.style.setProperty('--viewport-top',(v?.offsetTop||0)+'px');};
  update();window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);
}

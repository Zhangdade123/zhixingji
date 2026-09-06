async function pilotAPI(action,extra={}){
  const c=loadCloud();if(!c.session)throw Error('请先在「账号与同步」登录');
  if(!await ensureToken())throw Error('登录已失效，请重新登录');
  const current=loadCloud();if(current.session?.uid!==c.session.uid)throw Error('账号已切换');
  const r=await fetch(cloudBase(current)+'/functions/v1/zxj-push-pilot',{method:'POST',headers:cloudHeaders(current),body:JSON.stringify({action,...extra}),signal:AbortSignal.timeout(20000)});
  let data;try{data=await r.json();}catch{throw Error('推送服务尚未部署或响应异常');}
  if(!r.ok)throw Error(data.error||'推送服务尚未就绪（HTTP '+r.status+'）');return data;
}
function openPushPilot(){
  const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  $('#modalMask').innerHTML=`<div class="modal"><div class="modal-head"><h3>iPhone 后台提醒实验</h3><button data-act="close-modal">关闭</button></div><div class="modal-body"><p>1. 用 Safari 打开本站，点分享 → 添加到主屏幕，再从桌面图标进入。</p><p>2. 登录知行记账号，点击下方按钮授权并预约测试。</p><p>3. 看到预约成功后，返回手机主屏幕并锁屏，保持联网。约 2～3 分钟内观察通知。</p><p>当前：${standalone?'已在独立应用窗口':'普通浏览器窗口（iPhone 请先添加到主屏幕）'}；权限：${esc(window.Notification?.permission||'暂不支持')}</p><button class="btn btn-primary" id="pilot-start">授权并预约两分钟测试</button> <button class="btn" id="pilot-status">检查最近测试结果</button><p id="pilot-result" role="status" style="margin-top:14px">这是独立测试，不会自动启用所有待办的后台推送。服务端首次需要部署 SQL 和 Edge Function。</p></div></div>`;
  $('#modalMask').classList.add('show');$('#pilot-start').onclick=runPushPilot;$('#pilot-status').onclick=async()=>{try{const x=await pilotAPI('status');$('#pilot-result').textContent=x.job?('最近测试：'+({pending:'等待发送',sending:'发送中',accepted:'推送服务已接受，请核对手机是否看到',failed:'发送失败',unknown:'发送结果不确定'})[x.job.state]+'；'+(x.job.error||'')+'；预约时间 '+new Date(x.job.due_at).toLocaleString()):'尚无测试记录';}catch(e){if($('#pilot-result'))$('#pilot-result').textContent=e.message;}};
}
async function runPushPilot(){
  const btn=$('#pilot-start'),out=$('#pilot-result');btn.disabled=true;
  try{
    if(!('PushManager'in window)||!('Notification'in window))throw Error('请先通过 Safari 添加到主屏幕，再从图标打开');
    if(!loadCloud().session)throw Error('请先登录账号，再回来测试');
    const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('未允许通知，请检查 iPhone 通知设置');
    const config=await pilotAPI('config');const reg=await prepareNotificationWorker();if(!reg)throw Error('通知服务未启动');
    const raw=config.publicKey.replace(/-/g,'+').replace(/_/g,'/');const key=Uint8Array.from(atob(raw+'='.repeat((4-raw.length%4)%4)),x=>x.charCodeAt(0));
    let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    const job=await pilotAPI('schedule',{subscription:sub.toJSON()});
    out.textContent='预约成功。预计 '+new Date(job.due_at).toLocaleTimeString()+' 起的一分钟内发送。现在可返回主屏幕并锁屏；手机保持联网。';
  }catch(e){out.textContent='未完成：'+e.message;}finally{btn.disabled=false;}
}

// Persistent notifications only. No fetch handler or asset cache: deployments stay fresh.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let message={};try{message=event.data?.json()||{};}catch{}
  event.waitUntil(self.registration.showNotification('知行记 · 后台提醒测试',{
    body:'如果你在关闭应用或锁屏后看到了这条通知，后台推送链路已打通。',
    tag:'zxj-pilot-'+String(message.id||'test'),icon:new URL('icon-192.png',self.registration.scope).href,
    data:{pilot:true}
  }));
});
self.addEventListener('notificationclick',event=>{
  const id=event.notification.data?.todoId;
  event.notification.close();
  event.waitUntil((async()=>{
    const url=new URL('./',self.registration.scope);url.hash=event.notification.data?.pilot?'/me?notification=pilot':'/todos'+(id?'?todo='+encodeURIComponent(id):'');
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){if(client.url.startsWith(self.registration.scope)){if(event.notification.data?.pilot)await client.navigate(url.href);await client.focus();client.postMessage({type:'open-reminder-todo',id});return;}}
    await self.clients.openWindow(url.href);
  })());
});

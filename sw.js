// Persistent notifications only. No fetch handler or asset cache: deployments stay fresh.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let message={};try{message=event.data?.json()||{};}catch{}
  if(message.habitId){
    event.waitUntil(self.registration.showNotification('知行记 · 习惯提醒',{
      body:String(message.title||'每日习惯已到提醒时间'),tag:'habit-'+String(message.eventKey||message.id),
      icon:new URL('icon-192.png',self.registration.scope).href,data:{habitId:message.habitId}
    }));return;
  }
  if(message.todoId){
    event.waitUntil(self.registration.showNotification('知行记 · 事项提醒',{
      body:String(message.title||'事项已到提醒时间'),
      tag:'zxj-'+String(message.eventKey||message.id),
      icon:new URL('icon-192.png',self.registration.scope).href,
      data:{todoId:message.todoId}
    }));return;
  }
  event.waitUntil(self.registration.showNotification('知行记 · 后台提醒测试',{
    body:'如果你在关闭应用或锁屏后看到了这条通知，后台推送链路已打通。',
    tag:'zxj-pilot-'+String(message.id||'test'),icon:new URL('icon-192.png',self.registration.scope).href,
    data:{pilot:true}
  }));
});
self.addEventListener('notificationclick',event=>{
  if(event.notification.data?.habitId){
    event.notification.close();event.waitUntil((async()=>{
      const url=new URL('./',self.registration.scope);url.hash='/home';
      for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){if(client.url.startsWith(self.registration.scope)){await client.focus();client.postMessage({type:'open-habit-reminder'});return;}}
      await self.clients.openWindow(url.href);
    })());return;
  }
  const id=event.notification.data?.todoId;
  event.notification.close();
  event.waitUntil((async()=>{
    const url=new URL('./',self.registration.scope);url.hash=event.notification.data?.pilot?'/me?notification=pilot':'/todos'+(id?'?todo='+encodeURIComponent(id):'');
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){if(client.url.startsWith(self.registration.scope)){if(event.notification.data?.pilot)await client.navigate(url.href);await client.focus();client.postMessage({type:'open-reminder-todo',id});return;}}
    await self.clients.openWindow(url.href);
  })());
});

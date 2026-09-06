// Persistent notifications only. No fetch handler or asset cache: deployments stay fresh.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick',event=>{
  const id=event.notification.data?.todoId;
  event.notification.close();
  event.waitUntil((async()=>{
    const url=new URL('./',self.registration.scope);url.hash='/todos'+(id?'?todo='+encodeURIComponent(id):'');
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){if(client.url.startsWith(self.registration.scope)){await client.focus();client.postMessage({type:'open-reminder-todo',id});return;}}
    await self.clients.openWindow(url.href);
  })());
});

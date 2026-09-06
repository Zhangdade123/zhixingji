// Supabase Edge Function name: zxj-push-pilot
// Disable gateway "Verify JWT"; user requests are authenticated below with getUser.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={'Access-Control-Allow-Origin':'https://zhangdade123.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
function reply(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});}
function validSubscription(s:any){
  if(!s||typeof s.endpoint!=='string'||s.endpoint.length>4096)throw Error('订阅格式错误');
  const u=new URL(s.endpoint),h=u.hostname;
  const allowed=h==='web.push.apple.com'||h.endsWith('.push.apple.com')||h==='fcm.googleapis.com'||h==='updates.push.services.mozilla.com'||h.endsWith('.notify.windows.com');
  if(u.protocol!=='https:'||u.port||u.username||u.password||!allowed)throw Error('不支持的推送服务地址');
  if(!/^[a-zA-Z0-9_-]{87}$/.test(s.keys?.p256dh||'')||!/^[a-zA-Z0-9_-]{22}$/.test(s.keys?.auth||''))throw Error('订阅密钥格式错误');
  return {endpoint:s.endpoint,keys:{p256dh:s.keys.p256dh,auth:s.keys.auth}};
}
async function config(){const {data,error}=await db.from('zxj_push_pilot_config').select('*').eq('id',true).single();if(error||!data)throw Error('请先执行 push-pilot.sql');return data;}
async function vapid(){let c=await config();if(!c.vapid){const keys=webpush.generateVAPIDKeys();const {error}=await db.from('zxj_push_pilot_config').update({vapid:keys}).eq('id',true).is('vapid',null);if(error)throw Error('保存推送密钥失败');c=await config();}return c.vapid;}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{headers:cors});
  if(req.method!=='POST')return reply({error:'Method not allowed'},405);
  try{
    const text=await req.text();if(text.length>12000)return reply({error:'请求过大'},413);const body=JSON.parse(text);
    if(body.action==='dispatch'){
      const c=await config();if(req.headers.get('x-zxj-worker')!==c.worker_secret)return reply({error:'Unauthorized'},401);
      const keys=await vapid();const {data:jobs,error}=await db.rpc('zxj_push_pilot_claim');if(error)throw Error('领取测试任务失败');
      for(const job of jobs||[]){let state='accepted',message='';try{
        const sub=validSubscription(job.subscription);
        await webpush.sendNotification(sub,JSON.stringify({id:job.id}),{TTL:300,urgency:'high',timeout:8000,vapidDetails:{subject:'https://zhangdade123.github.io/zhixingji/',publicKey:keys.publicKey,privateKey:keys.privateKey}});
      }catch(e){state=e.statusCode?'failed':'unknown';message=e.statusCode?'推送服务返回 HTTP '+e.statusCode:'网络响应不确定，请检查手机后再测试';}
        const {error:updateError}=await db.from('zxj_push_pilot_jobs').update({state,error:message}).eq('id',job.id).eq('state','sending');if(updateError)throw Error('记录发送结果失败');
      }
      return reply({processed:jobs?.length||0});
    }
    const jwt=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');if(!jwt)return reply({error:'请先登录'},401);
    const {data:auth,error:authError}=await db.auth.getUser(jwt);if(authError||!auth.user)return reply({error:'登录无效，请重新登录'},401);const userId=auth.user.id;
    if(body.action==='config')return reply({publicKey:(await vapid()).publicKey});
    if(body.action==='status'){
      const {data,error}=await db.from('zxj_push_pilot_jobs').select('id,state,error,due_at').eq('user_id',userId).order('created_at',{ascending:false}).limit(1);if(error)throw Error('读取测试记录失败');return reply({job:data?.[0]||null});
    }
    if(body.action==='schedule'){
      const subscription=validSubscription(body.subscription);
      const {data:recent,error:readError}=await db.from('zxj_push_pilot_jobs').select('id').eq('user_id',userId).gte('created_at',new Date(Date.now()-60000).toISOString()).limit(1);if(readError)throw Error('请先部署测试 SQL');if(recent?.length)return reply({error:'请间隔一分钟再测试'},429);
      const {data,error}=await db.from('zxj_push_pilot_jobs').insert({user_id:userId,subscription}).select('id,due_at').single();if(error)return reply({error:error.code==='23505'?'已有测试等待发送，请稍后查看结果':'预约失败，请检查 SQL 部署'},409);return reply(data);
    }
    return reply({error:'不支持的操作'},400);
  }catch(e){return reply({error:e.message||'推送实验服务异常'},500);}
});

// Run with puppeteer available in NODE_PATH and the static server on :8099.
// Contact POSTs and admin data are mocked; real flyer visits are test-only.
const puppeteer = require('puppeteer');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const output = path.resolve(__dirname, '../../Flyers/previews');
const sdkMock = `
const lead={id:'test-lead',name:'Testfamilie',source:'ene',status:'ny',submissions:1,created_at:new Date().toISOString()};
export function createClient(){return {
 auth:{getSession:async()=>({data:{session:{user:{email:'test@example.invalid'}}}}),signOut:async()=>({})},
 rpc:async(name)=>name==='is_admin'?{data:true}:{data:Array.from({length:5},(_,i)=>({flyer_id:'f'+(i+1),name:['01 · Mere ro','02 · Styr på matematikken','03 · Tryghed til at spørge','04 · 1:1-undervisning','05 · Holdundervisning'][i],landing_path:'/',visits:100,new_leads:10,converted_visits:10,contact_rate:10,enrolled_leads:lead.status==='tilmeldt'?1:0,enrolled_visits:lead.status==='tilmeldt'?1:0,enrollment_rate:lead.status==='tilmeldt'?1:0}))},
 from:(name)=>{const result={data:name==='tutor_leads'?[lead]:[{lead_id:lead.id,flyer_id:'f4',flyer_name:'04 · 1:1-undervisning'}]};
  return {select:()=>({...result,order:async()=>result}),update:values=>({eq:async()=>{Object.assign(lead,values);return {error:null}}})}}
}}
`;
(async () => {
 const browser = await puppeteer.launch({headless:true});
 try {
  const page = await browser.newPage();
  await page.setViewport({width:1440,height:1000});
  const errors=[]; const submissions=[];
  page.on('pageerror', e=>errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', async request=>{
   if(request.url().includes('cdn.jsdelivr.net/npm/@supabase/supabase-js')) return request.respond({status:200,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:sdkMock});
   if(request.url().endsWith('/functions/v1/contact') && request.method()==='POST') {
    const body=JSON.parse(request.postData());
    if(body.action!=='flyer_visit') {
     submissions.push(body);
     return request.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:8099'},body:'{"ok":true,"id":"mock-only"}'});
    }
   }
   return request.continue();
  });
  for(const target of ['index.html','eneundervisning.html','holdundervisning.html']) {
   await page.goto('http://127.0.0.1:8099/?flyer=f2&tracking_test=1',{waitUntil:'networkidle0'});
   const id=await page.evaluate(()=>new URL(location.href).searchParams.get('fv'));
   if(target!=='index.html') {
    console.log('Navigate to', target);
    await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}), page.click('#site-nav a[href*="'+target+'"]')]);
    assert.equal(new URL(page.url()).searchParams.get('fv'),id);
   }
   await page.evaluate(()=>{
    const form=document.querySelector('form');
    for(const field of form.querySelectorAll('input,textarea,select')) {
     if(field.name==='company') continue;
     if(field.tagName==='SELECT') {field.selectedIndex=1;field.dispatchEvent(new Event('change'));}
     else if(field.name==='name') field.value='Tracking test';
     else if(field.name==='phone') field.value='00000000';
     else if(field.type==='email') field.value='tracking@example.invalid';
     else if(field.required) field.value='Matematik';
    }
    form.requestSubmit();
   });
   await page.waitForFunction(()=>document.querySelector('.form-feedback')?.textContent.includes('din besked er sendt'));
   assert.equal(submissions.at(-1).flyer_visit_id,id);
   assert.equal(submissions.at(-1).flyer_id,'f2');
  }
  await page.goto('http://127.0.0.1:8099/admin.html',{waitUntil:'networkidle0'});
  assert.equal(await page.$$eval('#flyer-results tr',rows=>rows.length),5);
  assert.match(await page.$eval('#flyer-results',e=>e.textContent),/10 %/);
  await page.select('#filter-flyer','f4');
  assert.equal(await page.$$eval('#list .lead',rows=>rows.length),1);
  await page.select('#filter-flyer','f1');
  assert.equal(await page.$$eval('#list .lead',rows=>rows.length),0);
  await page.select('#filter-flyer','f4');
  await page.click('.lead-head');
  await page.select('.edit-row select','tilmeldt');
  await page.click('.edit-row button');
  await page.waitForFunction(()=>document.querySelector('#flyer-results').textContent.includes('1 %'));
  await page.waitForFunction(()=>document.querySelector('#count-tilmeldt').textContent==='1');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.setViewport({width:1440,height:1100});
  await page.screenshot({path:path.join(output,'admin-tracking-desktop.png'),fullPage:true});
  await page.setViewport({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,'admin-tracking-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: all three contact forms preserve attribution; admin five rows, rates, filters, status refresh, mobile layout; no emails sent.');
 } finally {await browser.close();}
})();

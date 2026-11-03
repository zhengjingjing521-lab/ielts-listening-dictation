(()=>{
 'use strict';
 const localStorage=window.practiceStorage;
 const $=id=>document.getElementById(id),audio=$('audio'),storageKey='practice-progress-v1';
 let catalog,groups,token,report,tab='sheet',filterWord=null,playing=0,busy=false,progressTimer,progressQueue=Promise.resolve();
 let gloss={};
 let wordSearch=null,manualBookMode=false,manualBookItems=[];
 let manualBookSession={status:{},typed:{},ok:0,bad:0};

 let s={unit:'u1',group:'u1g1',index:0,voice:'uk',mode:'练习',draft:'',checked:null,heard:[],pending:null,complete:false,reviewQueue:null,sessions:{}};
 function activeSnapshot(){return {index:s.index,mode:s.mode,draft:s.draft,checkedId:s.checked?.id||null,heard:s.heard,pending:s.pending,complete:s.complete,reviewQueue:s.reviewQueue};}
 function snapshot(){return {version:2,updatedAt:s.updatedAt||0,unit:s.unit,group:s.group,voice:s.voice,...activeSnapshot(),sessions:s.sessions};}
 function sendProgress(){if(!token)return;const value=snapshot();progressQueue=progressQueue.catch(()=>{}).then(()=>api('/api/progress',value)).catch(()=>{$('save-status').textContent='练习进度暂未同步；已提交的记录仍保留';});}
 function save(){s.updatedAt=Math.max(Date.now(),(s.updatedAt||0)+1);try{localStorage.setItem(storageKey,JSON.stringify(snapshot()));}catch{}clearTimeout(progressTimer);progressTimer=setTimeout(sendProgress,180);}
 function error(message=''){$('error').textContent=message;$('error').hidden=!message;}
 const g=()=>groups.find(x=>x.id===s.group);
 function stop(){playing++;audio.pause();audio.removeAttribute('src');audio.load();$('audio-status').textContent='';}
 async function api(path,body){const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Practice-Token':token},body:JSON.stringify(body)}:{});const value=await response.json();if(!response.ok)throw Error(value.error||'暂时无法连接');return value;}
 function groupOptions(){const unit=catalog.units.find(u=>u.id===s.unit);$('group').replaceChildren();for(const item of unit.groups){const option=document.createElement('option');option.value=item.id;option.textContent=item.label+' · '+item.start+'–'+item.end+' · '+item.total+'词';$('group').append(option);}$('group').value=s.group;}
 function fresh(index=s.index,mode='练习'){stop();s.index=index;s.mode=mode;s.checked=null;s.draft='';s.heard=[];s.pending=null;s.complete=false;save();render();$('answer').focus();}
 const queue=()=>s.reviewQueue||g().words.map((_,i)=>i);
 function activateGroup(id,reset=false){
  stop();s.sessions[s.group]=activeSnapshot();const target=groups.find(x=>x.id===id);s.group=id;s.unit=target.unitId;
  const saved=!reset&&s.sessions[id];Object.assign(s,saved||{index:0,mode:'练习',draft:'',checkedId:null,heard:[],pending:null,complete:false,reviewQueue:null});
  s.checked=saved?.checkedId?report.rows.find(r=>r.id===saved.checkedId)||null:null;save();render();
  if(!s.checked&&!s.complete){$('answer').focus();play();}
 }
 function next(){const q=queue(),position=q.indexOf(s.index);if(position===q.length-1){stop();s.complete=true;save();render();return;}fresh(q[position+1],s.reviewQueue?'复练':'练习');play();}
 function reviewIndices(){return [...new Set(report.rows.filter(r=>r.groupId===s.group&&r.result!=='正确').map(r=>r.wordNumber-g().start))].filter(i=>i>=0&&i<g().words.length).sort((a,b)=>a-b);}
 function render(){
  const item=g(),checked=!!s.checked,locked=busy||!!s.pending;
  $('unit').value=s.unit;groupOptions();$('unit').disabled=locked;$('group').disabled=locked;
  $('route').textContent=item.unit+' / '+item.label;$('range').textContent='原词号 '+item.start+'–'+item.end+' · 全组 '+item.total+' 词';
  $('scope').textContent='本组全部 '+item.words.length+' 词均可听写。每次提交单独保存，订正保留最初的错误。';
  $('counter').textContent=(queue().indexOf(s.index)+1)+' / '+queue().length+'　原表第 '+(item.start+s.index)+' 词'+(s.mode!=='练习'?' · '+s.mode:'');
  document.querySelectorAll('[data-voice]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.voice===s.voice));b.disabled=locked;});
  $('answer').value=s.draft;$('answer').hidden=checked;$('answer').disabled=locked;
  $('inline-answer').hidden=!checked;$('answer-actions').hidden=checked;$('checked-actions').hidden=!checked;
  $('submit').disabled=busy;$('skip').disabled=locked;$('submit').textContent=busy?'正在保存…':s.pending?'重试保存':'检查并记录';
  $('play').disabled=locked;$('slow').disabled=locked;
  $('next').textContent=s.index===queue().at(-1)?'完成本组 →':'下一词 →';
  $('question-card').hidden=s.complete;$('complete-card').hidden=!s.complete;
  $('complete-title').textContent=item.unit+' / '+item.label+' · '+(s.reviewQueue?'错词复练完成':'本组已练完');
  const ownRows=report.rows.filter(r=>r.groupId===s.group),wrongIndices=reviewIndices(),ng=groups[groups.findIndex(x=>x.id===s.group)+1];
  $('complete-stats').textContent='本组累计提交 '+ownRows.length+' 次，曾写错 '+wrongIndices.length+' 个词；每次原始作答都已保留。';
  $('review-group').disabled=!wrongIndices.length;$('next-group').disabled=!ng;$('next-group').textContent=ng?'下一组：'+ng.unit+' / '+ng.label+' →':'全部分组已到末尾';
  if(checked)renderAnswer(s.checked);else{$('inline-answer').replaceChildren();$('feedback').textContent=s.pending?'保存尚未确认，原输入已保留。':'提交前不提示字母数';}
  const daily=checked?report.summary.find(r=>r.day===s.checked.day&&r.key===s.checked.wordKey):null;
  $('word-today').textContent=daily?'这个词当天已练 '+daily.attempts+' 次 · 错 '+daily.wrong+' 次 · 第一次：'+daily.first:'';
  $('record-count').textContent=report.rows.length;
  $('practice').hidden=tab!=='practice';$('records').hidden=tab!=='records';$('sheet').hidden=tab!=='sheet';$('practice-tab').setAttribute('aria-pressed',String(tab==='practice'));$('records-tab').setAttribute('aria-pressed',String(tab==='records'));$('sheet-tab').setAttribute('aria-pressed',String(tab==='sheet'));document.body.classList.toggle('sheet-mode',tab==='sheet');
  if(tab==='records')renderRecords();
  if(tab==='sheet')renderSheet();
 }
 function span(tag,cls,text){const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;}
 function renderAnswer(r){
  const field=$('inline-answer');field.replaceChildren();
  if(r.result==='正确')field.append(span('span','equal',r.answer.trim()));
  else if(r.result==='未听出')field.append(span('span','',r.word));
  else for(const op of r.ops){
   if(op.kind==='equal')field.append(span('span','equal',op.typed));
   else if(op.kind==='missing'){const n=span('ins','missing','');n.append(span('sup','plus','+'),document.createTextNode(op.target));field.append(n);}
   else if(op.kind==='extra')field.append(span('del','extra',op.typed));
   else{const n=span('span','change','');n.append(span('del','',op.typed),span('span','',op.kind==='swap'?'⇄':'→'),span('ins','',op.target));field.append(n);}
  }
  field.setAttribute('aria-label',r.result+'。你的输入：'+r.answer+'。正确拼写：'+r.word+'。'+r.error);
  $('feedback').textContent=(r.result==='正确'?'✓ 拼写正确':r.result==='未听出'?'未听出 · 正确拼写见上方':r.error)+' · 已保存';
 }
 async function play(rate=1){
  stop();const generation=playing;const heardVoice=s.voice;$('audio-status').textContent='正在准备发音…';
  audio.src='/api/audio?'+new URLSearchParams({voice:s.voice,group:s.group,index:s.index});audio.playbackRate=rate;audio.preservesPitch=true;
  try{await audio.play();if(generation!==playing)return;s.heard.push({voice:heardVoice,rate});s.heard=s.heard.slice(-100);save();$('audio-status').textContent=(heardVoice==='uk'?'英音 Sonia':'美音 Jenny')+' · '+rate+'×';const q=queue(),nextIndex=q[q.indexOf(s.index)+1];if(nextIndex!==undefined)fetch('/api/audio?'+new URLSearchParams({voice:s.voice,group:s.group,index:nextIndex})).catch(()=>{});}
  catch(e){if(generation===playing)$('audio-status').textContent='发音暂不可用，请重试';}
 }
 async function submit(skip=false){
  if(busy||s.checked)return;error();
  if(!s.pending){
   const answer=$('answer').value;if(!skip&&!answer.trim()){error('先填写拼写，或选择“没听出来”。');return;}
   if(!skip&&!/^[A-Za-z'’ -]+$/.test(answer)&&!Object.hasOwn(sheetG(g().words[s.index]).spellings||{},snorm(answer))){error('请用英文字母输入拼写。');return;}
   s.draft=answer;s.pending={id:crypto.randomUUID(),group:s.group,index:s.index,voice:s.voice,mode:s.mode,answer,skip,heard:s.heard.slice()};save();
  }
  busy=true;stop();render();$('save-status').textContent='正在保存…';
  try{const value=await api('/api/attempts',s.pending);s.checked=value.record;report=value.report;s.pending=null;save();$('save-status').textContent='已保存';wordSearch?.refresh?.();}
  catch(e){error(e.message+'。点“重试保存”不会重复计数。');$('save-status').textContent='保存未确认';}
  finally{busy=false;render();}
 }
 function cell(row,text,cls=''){const td=document.createElement('td');td.textContent=text;td.className=cls;row.append(td);return td;}
 function renderRecords(){
  const date=$('date').value,days=report.summary.filter(r=>!date||r.day===date),rows=report.rows.filter(r=>(!date||r.day===date)&&(!filterWord||r.wordKey===filterWord));
  $('totals').textContent=days.length+' 个单词日记录 · '+days.reduce((n,r)=>n+r.attempts,0)+' 次提交 · 错 '+days.reduce((n,r)=>n+r.wrong,0)+' 次';
  $('empty').hidden=days.length>0;$('empty').textContent=report.rows.length?'这个日期没有练习记录。':'还没有练习记录。提交一次答案，就会在这里留下记录。';
  const tbody=$('summary').tBodies[0];tbody.replaceChildren();
  for(const r of days.slice().reverse()){
   const tr=document.createElement('tr');cell(tr,r.day);cell(tr,r.word,'raw');cell(tr,r.attempts);cell(tr,r.wrong,r.wrong?'bad':'good');cell(tr,r.first,r.first==='正确'?'good':'bad');cell(tr,r.latest,r.latest==='正确'?'good':'bad');
   const td=cell(tr,''),button=document.createElement('button');button.textContent='查看每次';button.addEventListener('click',()=>{filterWord=r.key;renderRecords();$('detail-title').scrollIntoView({behavior:'smooth',block:'start'});});td.append(button);tbody.append(tr);
  }
  $('detail-title').textContent=filterWord?filterWord+' · 每次怎么写的':'每次的原始作答';$('clear-word').hidden=!filterWord;
  const details=$('details').tBodies[0];details.replaceChildren();
  for(const r of rows.slice().reverse()){
   const tr=document.createElement('tr');cell(tr,r.time.slice(0,10)+' '+r.time.slice(11,19));const term=cell(tr,r.word,'raw');term.append(span('span','sub',r.unit+' / '+r.group+' / '+r.wordNumber));cell(tr,r.answer||'（未作答）','raw');cell(tr,r.result,r.result==='正确'?'good':'bad');cell(tr,r.error||'—');cell(tr,r.heardVoices);cell(tr,r.mode);details.append(tr);
  }
 }
 async function load(){
  try{
   const value=await api('/api/init');catalog=value.catalog;token=value.token;report=value.report;gloss=value.gloss||{};groups=catalog.units.flatMap(u=>u.groups.map(g=>({...g,unit:u.name,unitId:u.id})));
   try{
    let local=null;try{local=JSON.parse(localStorage.getItem(storageKey));}catch{}
    const candidates=[local,value.progress].filter(old=>old&&groups.some(g=>g.id===old.group&&g.unitId===old.unit&&Number.isInteger(old.index)&&old.index>=0&&old.index<g.words.length)&&['uk','us'].includes(old.voice));
    candidates.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));const old=candidates[0];
    if(old){s={...s,...old};s.checked=report.rows.find(r=>r.id===(old.checkedId||old.checked?.id))||null;s.sessions=s.sessions||{};if(s.reviewQueue&&(!Array.isArray(s.reviewQueue)||!s.reviewQueue.includes(s.index)||!s.reviewQueue.every(i=>Number.isInteger(i)&&i>=0&&i<g().words.length)))s.reviewQueue=null;
     // A committed attempt can still need wordbook synchronization. Replay its
     // original id; only a complete success may clear the durable pending input.
     if(s.pending)s.checked=null;
    }
   }catch{}
   const select=$('unit');for(const u of catalog.units){const option=document.createElement('option');option.value=u.id;option.textContent=u.name+' · '+u.count+'词';select.append(option);}
   if(!gloss.autumn)gloss.autumn={zh:'秋天',ipa:'/ˈɔːtəm/'};
   wordSearch=IeltsWordSearch.mount({catalog,gloss,api,jump:sheetJump,openBook:sheetOpenBook,onItems:items=>{sheetCaptureDrafts();const changed=JSON.stringify(items.map(x=>x.key))!==JSON.stringify(manualBookItems.map(x=>x.key));manualBookItems=items;if(manualBookMode&&changed)renderSheet();}});
   $('date').value=report.today;$('save-status').textContent='已保存';render();initSheet();if(s.pending)await submit();
  }catch(e){error('无法读取练习记录，请通过启动入口重新打开。');$('save-status').textContent='尚未连接';}
 }
 $('unit').addEventListener('change',()=>activateGroup(catalog.units.find(u=>u.id===$('unit').value).groups[0].id));
 $('group').addEventListener('change',()=>activateGroup($('group').value));
 document.querySelectorAll('[data-voice]').forEach(b=>b.addEventListener('click',()=>{stop();s.voice=b.dataset.voice;save();render();}));
 $('play').addEventListener('click',()=>play());$('slow').addEventListener('click',()=>play(.85));
 $('answer').addEventListener('input',()=>{s.draft=$('answer').value;save();error();});$('answer').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();submit();}});
 $('submit').addEventListener('click',()=>submit());$('skip').addEventListener('click',()=>submit(true));
 $('retry').addEventListener('click',()=>fresh(s.index,'订正'));$('next').addEventListener('click',next);
 $('next-group').addEventListener('click',()=>{const target=groups[groups.findIndex(x=>x.id===s.group)+1];if(target)activateGroup(target.id);});
 $('again-group').addEventListener('click',()=>{s.reviewQueue=null;fresh(0);play();});
 $('review-group').addEventListener('click',()=>{const q=reviewIndices();if(q.length){s.reviewQueue=q;fresh(q[0],'复练');play();}});
 $('practice-tab').addEventListener('click',()=>{sheetStopRepeat();tab='practice';render();});$('records-tab').addEventListener('click',async()=>{sheetStopRepeat();stop();try{report=await api('/api/records');}catch(e){error(e.message);}tab='records';render();});
 $('date').addEventListener('change',()=>{filterWord=null;renderRecords();});$('all-days').addEventListener('click',()=>{$('date').value='';filterWord=null;renderRecords();});$('clear-word').addEventListener('click',()=>{filterWord=null;renderRecords();});
 $('export').addEventListener('click',async()=>{const b=$('export');b.disabled=true;b.textContent='正在生成 Excel…';error();try{const response=await fetch('/api/export');if(!response.ok)throw Error('导出暂时失败，记录仍保留');const blob=await response.blob();if(new URLSearchParams(location.search).get('host')==='obsidian'){window.parent.postMessage({type:'ielts-export-ready'},'*');$('save-status').textContent='Excel 已保存到听写记录文件夹';}else{const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='听写练习记录.xlsx';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}}catch(e){error(e.message);}finally{b.disabled=false;b.textContent='导出 Excel · 全部记录';}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){sheetStopRepeat();stop();clearTimeout(progressTimer);sendProgress();}});
 window.addEventListener('pagehide',()=>{if(token)fetch('/api/progress',{method:'POST',headers:{'Content-Type':'application/json','X-Practice-Token':token},body:JSON.stringify(snapshot()),keepalive:true}).catch(()=>{});}); /* ---------------- 看词练习 · 一张大表 ---------------- */
 const SHEET_KEY='iws-sheet-v1';
 let sheet={unit:null,group:null,mode:'practice',maskEn:false,maskZh:false,writeZh:false,autoPlay:true,repeatSec:0,zoom:110,progress:{},errors:{},review:false,status:{},typed:{},ok:0,bad:0};
 try{const saved=JSON.parse(localStorage.getItem(SHEET_KEY));if(saved&&typeof saved==='object')sheet={...sheet,...saved};}catch{}
 if(!sheet.progress||typeof sheet.progress!=='object')sheet.progress={};
 if(!sheet.rowDrafts||typeof sheet.rowDrafts!=='object')sheet.rowDrafts={};
 sheet.status={};sheet.typed={};sheet.review=false;sheet.ok=0;sheet.bad=0;sheet.bookJudged={};
 const sheetStore=()=>{try{localStorage.setItem(SHEET_KEY,JSON.stringify({...sheet,status:{},typed:{},review:false,ok:0,bad:0,bookJudged:{}}));}catch{}sheetSync();};
 const isHost=()=>new URLSearchParams(location.search).get('host')==='obsidian';
 let sheetSyncTimer=null;
 function sheetSync(){
  if(!isHost())return;
  clearTimeout(sheetSyncTimer);
  sheetSyncTimer=setTimeout(()=>{try{window.parent.postMessage({type:'iws-sheet-state',state:{progress:sheet.progress,errors:sheet.errors,rowDrafts:sheet.rowDrafts,updatedAt:Date.now()}},'*');}catch{}},600);
 }
 const snorm=t=>String(t||'').trim().toLowerCase().replace(/\s+/g,' ');
 const sznorm=t=>String(t||'').replace(/[\s，。、；;,.!?！？（）()【】\[\]"'“”‘’…·:：\/|]/g,'');
 function szhit(t,c){const a=sznorm(t);if(!a)return false;const segs=String(c||'').split(/[；;，,、\/|]/).map(sznorm).filter(x=>x.length>=2);if(!segs.length)return sznorm(c)===a;return segs.some(x=>a.includes(x)||(a.length>=2&&x.includes(a)));}
 const sheetRepeat = {timer: null, row: null, clip: null};
 function sheetStopRepeat(){
  clearTimeout(sheetRepeat.timer);
  sheetRepeat.timer = null;
  sheetRepeat.row = null;
  const clip = sheetRepeat.clip;
  sheetRepeat.clip = null;
  if (clip) {
   clip.onended = null;
   clip.onerror = null;
   clip.pause();
  }
 }
 function sheetReadsChinese(){
  return sheet.mode === 'practice' && !sheet.maskEn && !sheet.maskZh && !sheet.writeZh;
 }
 function sheetPlayRow(tr){
  sheetStopRepeat();
  if (!tr?.dataset.word || tab !== 'sheet') return;
  sheetRepeat.row = tr;
  $('sheet-audio-error').hidden = true;
  const {group, index} = tr.dataset;
  function playPart(voice) {
   const clip = new Audio();
   sheetRepeat.clip = clip;
   const isCurrent = () => sheetRepeat.clip === clip && tr.isConnected && tab === 'sheet';
   const failed = () => {
    if (!isCurrent()) return;
    sheetStopRepeat();
    const notice = $('sheet-audio-error');
    notice.textContent = (voice === 'zh' ? '中文释义' : '英文') + '暂未播放，点这一行的喇叭可重试。';
    notice.hidden = false;
   };
   clip.onerror = failed;
   clip.onended = () => {
    if (!isCurrent()) return;
    if (voice !== 'zh' && sheetReadsChinese()) {
     playPart('zh');
    } else if (sheet.repeatSec > 0) {
     sheetRepeat.timer = setTimeout(() => {
      if (isCurrent()) playPart(s.voice);
     }, Number(sheet.repeatSec) * 1000);
    }
   };
   clip.src = '/api/audio?' + new URLSearchParams({voice, group, index});
   clip.play().catch(failed);
  }
  playPart(s.voice);
 }
 const sheetGroupObj=()=>groups.find(x=>x.id===sheet.group)||groups[0];
 const sheetG=w=>gloss[w]||{};
 function sheetRows(){if(manualBookMode)return manualBookItems;if(sheet.review)return Object.entries(sheet.errors).map(([w,e])=>({word:w,group:e.group,index:e.index}));const gd=sheetGroupObj();return gd?gd.words.map((w,i)=>({word:w,group:gd.id,index:i})):[];}
 function sheetCaptureDrafts(){
  if(!groups)return;
  let changed=false;
  document.querySelectorAll('#sheet-table tbody tr[data-word]').forEach(tr=>{const word=tr.dataset.word,gid=tr.dataset.group,en=tr.querySelector('.sen').value,zh=tr.querySelector('.szh-in').value;
   if(manualBookMode){sheet.typed[word]=en;sheet.typed[word+'#zh']=zh;return;}
   const key=gid+':'+tr.dataset.index,rec=sheet.rowDrafts[key]||sheet.progress[gid]?.[word];if((rec?.en||'')===en&&(rec?.zh||'')===zh)return;
   sheet.rowDrafts[key]={en,zh,st:'',at:Date.now()};changed=true;
  });if(manualBookMode)manualBookSession={status:{...sheet.status},typed:{...sheet.typed},ok:sheet.ok,bad:sheet.bad};if(changed)sheetStore();
 }
 function sheetStopAll(){sheetStopRepeat();stop();}
 function sheetJump(r){
  const target=groups.find(g=>g.id===r.group);if(!target||target.words[r.index]!==r.word)return;
  sheetCaptureDrafts();sheetStopAll();manualBookMode=false;sheet.review=false;sheet.unit=target.unitId;sheet.group=target.id;sheet.status={};sheet.typed={};sheetStore();initSheet();
  const row=[...$('sheet-table').tBodies[0].rows].find(tr=>tr.dataset.group===r.group&&Number(tr.dataset.index)===r.index);
  if(row){row.classList.add('word-search-target');row.scrollIntoView({block:'center',behavior:'instant'});const input=row.querySelector('.sen');input.focus({preventScroll:true});}
 }
 function sheetOpenBook(){if(manualBookMode)return;sheetCaptureDrafts();sheetStopAll();manualBookMode=true;sheet.review=false;Object.assign(sheet,{...manualBookSession,status:{...manualBookSession.status},typed:{...manualBookSession.typed}});renderSheet();}
 function sheetLeaveBook(){if(!manualBookMode)return;sheetCaptureDrafts();sheetStopAll();manualBookMode=false;sheet.status={};sheet.typed={};initSheet();}
 function sheetPaint(){
  document.querySelectorAll('#sheet-table tbody tr').forEach(tr=>{
   const w=tr.dataset.word,draft=!manualBookMode&&sheet.rowDrafts[tr.dataset.group+':'+tr.dataset.index],st=draft&&typeof draft.st==='string'?draft.st:(sheet.status[w]||'');
   const showEn=!sheet.maskEn||!!st,showZh=!sheet.maskZh||!!st;
   const wn=tr.querySelector('.sw');wn.textContent=showEn?w:'•'.repeat(Math.min(w.length,16));wn.classList.toggle('masked',!showEn);
   tr.querySelector('.sipa').textContent=showEn?(sheetG(w).ipa||''):'';
   const history=tr.querySelector('.wordbook-mistake');if(history)history.hidden=!showEn;
   const zn=tr.querySelector('.szh'),z=sheetG(w).zh||'—';
   zn.textContent=showZh?z:'•'.repeat(Math.min(z.length,10));zn.classList.toggle('masked',!showZh);
   tr.classList.toggle('rok',st==='ok');tr.classList.toggle('rbad',st==='wrong');
   const v=tr.querySelector('.sv');v.replaceChildren();
   if(st==='ok')v.append(span('span','equal','✓'));
   else if(st==='wrong'){v.append(span('span','bad','✗'));if(tr.dataset.detail)v.append(span('span','sub',tr.dataset.detail));}
  });
  $('sheet-score').textContent=sheet.mode==='practice'?'':('一次过 '+sheet.ok+' · 打错过 '+sheet.bad);
  const n=Object.keys(sheet.errors).length;
  $('sheet-bad-count').textContent=n;$('sheet-review').hidden=!n;
  $('sheet-review').setAttribute('aria-pressed',String(sheet.review));
  $('sheet-count').checked=sheet.mode==='dictation';
  $('sheet-masken').checked=!!sheet.maskEn;$('sheet-maskzh').checked=!!sheet.maskZh;$('sheet-writezh').checked=!!sheet.writeZh;
  $('sheet-autoplay').checked=sheet.autoPlay!==false;$('sheet-repeat').value=String(Number(sheet.repeatSec)||0);
  const zoom=Number(sheet.zoom)||100;$('sheet-zoom').value=String(zoom);const appEl=$('app');if(appEl){appEl.style.zoom=String(zoom/100);appEl.style.width='auto';}
  $('sheet-table').classList.toggle('with-zh',!!sheet.writeZh);
  const rows=sheetRows(),done=rows.filter(r=>sheet.status[r.word]).length;
  $('sheet-note').textContent=rows.length?('已练 '+done+' / '+rows.length+' · 回车判定，错词自动收录'):('还没有错词，练习判错后会自动收录。');
  $('wordbook-back').hidden=false;$('wordbook-back').setAttribute('aria-pressed',String(!manualBookMode));$('wordbook-open').setAttribute('aria-pressed',String(manualBookMode));
  $('sheet-pickers').hidden=manualBookMode;$('wordbook-column').hidden=!manualBookMode;
  $('sheet-unit').disabled=manualBookMode;$('sheet-group').disabled=manualBookMode;$('sheet-review').hidden=true;
  $('sheet-cleargroup').textContent=manualBookMode?'重练错词本':'清空本组';wordSearch?.refreshButtons();
 }
 function renderSheet(){
  sheetStopRepeat();
  const rows=sheetRows(),tbody=$('sheet-table').tBodies[0];tbody.replaceChildren();
  rows.forEach((r,i)=>{
   const word=r.word,tr=document.createElement('tr');tr.dataset.word=word;tr.dataset.group=r.group;tr.dataset.index=String(r.index);
   const saved=manualBookMode?null:(sheet.progress[r.group]||{})[word],draft=manualBookMode?null:sheet.rowDrafts[r.group+':'+r.index];
   const rec=draft?{...(saved||{}),...draft}:saved;if(rec){if(rec.st)sheet.status[word]=rec.st;else delete sheet.status[word];}
   const n=document.createElement('td');n.className='sn';n.textContent=i+1;tr.append(n);
   const wc=document.createElement('td');wc.className='sword';
   const wspan=document.createElement('span');wspan.className='sw';wc.append(wspan);
   const ipa=document.createElement('span');ipa.className='sipa';wc.append(ipa);tr.append(wc);
   const pc=document.createElement('td');pc.className='splay';const pb=document.createElement('button');pb.type='button';pb.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';pb.setAttribute('aria-label','播放 '+word);pb.addEventListener('click',()=>sheetPlayRow(tr));pc.append(pb);tr.append(pc);
   const zc=document.createElement('td');zc.className='szh';tr.append(zc);
   const ec=document.createElement('td');ec.className='sans';const ein=document.createElement('input');ein.className='sen';ein.maxLength=120;ein.value=(rec&&typeof rec.en==='string')?rec.en:(sheet.typed[word]||'');ein.autocomplete='off';ein.spellcheck=false;ec.append(ein);tr.append(ec);
   const cc=document.createElement('td');cc.className='sans scn';const zin=document.createElement('input');zin.className='szh-in';zin.value=(rec&&typeof rec.zh==='string')?rec.zh:(sheet.typed[word+'#zh']||'');zin.autocomplete='off';cc.append(zin);tr.append(cc);
   const remember=()=>{sheet.typed[word]=ein.value;sheet.typed[word+'#zh']=zin.value;if(!manualBookMode){sheet.rowDrafts[r.group+':'+r.index]={en:ein.value,zh:zin.value,st:'',at:Date.now()};delete sheet.status[word];sheetStore();sheetPaint();}};
   ein.addEventListener('input',remember);zin.addEventListener('input',remember);
   const vc=document.createElement('td');vc.className='sv';tr.append(vc);
   wordSearch?.decorateRow(tr,r,manualBookMode);
   ein.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&!ev.isComposing){ev.preventDefault();sheetJudge(word,r.group,r.index,tr,ein,zin);}if(ev.key==='Escape'){ein.value='';sheet.typed[word]='';remember();}});
   zin.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&!ev.isComposing){ev.preventDefault();sheetJudge(word,r.group,r.index,tr,ein,zin);}if(ev.key==='Escape'){zin.value='';sheet.typed[word+'#zh']='';remember();}});
   tbody.append(tr);
  });
  sheetPaint();
 }
 function sheetJudge(word,group,index,tr,ein,zin){
  const en=(ein.value||'').trim(),zh=(zin.value||'').trim();
  if(!en&&!zh)return;
  const priorJudged=manualBookMode?sheet.bookJudged?.[word]:sheet.progress[group]?.[word]?.st;
  if(manualBookMode){sheet.bookJudged=sheet.bookJudged||{};sheet.bookJudged[word]=true;}
  const entry=sheetG(word),forms=entry.spellings||{},key=snorm(en);
  const isAlternate=Object.hasOwn(forms,key);
  const enOK=key===snorm(word)||isAlternate;
  const meaning=isAlternate&&forms[key]||entry.zh;
  const zhOK=sheet.writeZh?szhit(zh,meaning):true;
  if(!enOK)wordSearch?.recordMistake?.({word,group,index,wrongSpelling:en});
  if(enOK&&zhOK){
   if(!priorJudged&&sheet.mode==='dictation')sheet.ok++;
   sheet.status[word]='ok';delete sheet.errors[word];tr.dataset.detail='';
   sheet.progress[group]=sheet.progress[group]||{};sheet.progress[group][word]={st:'ok',en:en,zh:zh,at:Date.now()};
   sheet.rowDrafts[group+':'+index]={...sheet.progress[group][word]};
   ein.value=en;sheet.typed[word]=en;sheetStore();sheetPaint();sheetFocusNext(word);return;
  }
  if(!priorJudged&&sheet.mode==='dictation'){
   sheet.bad++;
   const d=new Date(),key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
   const e=sheet.errors[word]||{group,index,first:key,count:0};e.last=key;e.count=(e.count||0)+1;sheet.errors[word]=e;
  }
  sheet.status[word]='wrong';
  tr.dataset.detail=enOK?('中：'+(meaning||'—')):word;
  sheet.progress[group]=sheet.progress[group]||{};sheet.progress[group][word]={st:'wrong',en:en,zh:zh,at:Date.now()};
  sheet.rowDrafts[group+':'+index]={...sheet.progress[group][word]};
  sheetStore();sheetPaint();
  (enOK?zin:ein).select();
 }
 function sheetFocusNext(word){
  const trs=[...document.querySelectorAll('#sheet-table tbody tr')];
  const i=trs.findIndex(tr=>tr.dataset.word===word);
  for(let k=i+1;k<trs.length;k++){if(!sheet.status[trs[k].dataset.word]){const el=trs[k].querySelector('.sen');if(el){el.focus();return;}}}
  for(let k=0;k<=i&&k<trs.length;k++){if(!sheet.status[trs[k].dataset.word]){const el=trs[k].querySelector('.sen');if(el){el.focus();return;}}}
 }
 function initSheet(){
  const us=$('sheet-unit'),gs=$('sheet-group');
  if(!us.options.length)for(const u of catalog.units){const o=document.createElement('option');o.value=u.id;o.textContent=u.name+' · '+u.count+'词';us.append(o);}
  if(!sheet.unit||!catalog.units.some(u=>u.id===sheet.unit))sheet.unit=s.unit||catalog.units[0].id;
  if(!sheet.group||!groups.some(x=>x.id===sheet.group))sheet.group=s.group||groups[0].id;
  const unit=catalog.units.find(u=>u.id===sheet.unit);
  gs.replaceChildren();
  for(const it of unit.groups){const o=document.createElement('option');o.value=it.id;o.textContent=it.label+' · '+it.start+'–'+it.end+' · '+it.total+'词';gs.append(o);}
  us.value=sheet.unit;gs.value=sheet.group;
  renderSheet();
 }
 $('sheet-tab').addEventListener('click',()=>{tab='sheet';stop();render();});
 document.addEventListener('pointerdown',event=>{if(!$('sheet-settings').contains(event.target))$('sheet-settings').open=false;});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('sheet-settings').open){$('sheet-settings').open=false;$('sheet-settings').querySelector('summary').focus();}});
 $('wordbook-back').addEventListener('click',sheetLeaveBook);
 $('sheet-unit').addEventListener('change',()=>{sheet.unit=$('sheet-unit').value;const u=catalog.units.find(x=>x.id===sheet.unit);sheet.group=u.groups[0].id;sheet.review=false;sheet.status={};sheet.typed={};sheetStore();initSheet();});
 $('sheet-group').addEventListener('change',()=>{sheet.group=$('sheet-group').value;sheet.review=false;sheet.status={};sheet.typed={};sheetStore();renderSheet();});
 $('sheet-count').addEventListener('change',ev=>{sheetStopRepeat();sheet.mode=ev.target.checked?'dictation':'practice';sheetStore();sheetPaint();});
 $('sheet-masken').addEventListener('change',ev=>{sheetStopRepeat();sheet.maskEn=ev.target.checked;sheetStore();sheetPaint();});
 $('sheet-maskzh').addEventListener('change',ev=>{sheetStopRepeat();sheet.maskZh=ev.target.checked;sheetStore();sheetPaint();});
 $('sheet-writezh').addEventListener('change',ev=>{sheet.writeZh=ev.target.checked;sheetStore();renderSheet();});
 $('sheet-review').addEventListener('click',sheetOpenBook);
 $('sheet-autoplay').addEventListener('change',ev=>{
  sheet.autoPlay=ev.target.checked;
  if(!sheet.autoPlay)sheetStopRepeat();
  sheetStore();
 });
 $('sheet-repeat').addEventListener('change',ev=>{sheet.repeatSec=Number(ev.target.value)||0;sheetStore();if(!sheet.repeatSec)sheetStopRepeat();});
 $('sheet-zoom').addEventListener('change',ev=>{sheet.zoom=Number(ev.target.value)||100;sheetStore();sheetPaint();});
 $('sheet-cleargroup').addEventListener('click',()=>{
  if(manualBookMode){sheetStopAll();sheet.status={};sheet.typed={};sheet.ok=0;sheet.bad=0;sheet.bookJudged={};renderSheet();return;}
  const gid=sheet.group;
  if(sheet.progress[gid])delete sheet.progress[gid];
  const clearedAt=Date.now(),clearedGroup=groups.find(x=>x.id===gid);
  if(clearedGroup)clearedGroup.words.forEach((_,i)=>{sheet.rowDrafts[gid+':'+i]={en:'',zh:'',st:'',at:clearedAt};});
  Object.keys(sheet.errors).forEach(w=>{if(sheet.errors[w]&&sheet.errors[w].group===gid)delete sheet.errors[w];});
  sheet.status={};sheet.typed={};sheetStore();renderSheet();
 });
 let sheetGotSync=false;
 window.addEventListener('message',ev=>{
  const d=ev.data;
  if(!d||d.type!=='iws-sheet-state'||!d.state)return;
  sheetGotSync=true;
  try{
   const st=d.state;
   if(st.progress&&typeof st.progress==='object'){
    for(const g of Object.keys(st.progress)){
     const src=st.progress[g]||{};sheet.progress[g]=sheet.progress[g]||{};
     for(const w of Object.keys(src)){const r=src[w],c=sheet.progress[g][w];if(!c||((r&&r.at)||0)>((c&&c.at)||0))sheet.progress[g][w]=r;}
    }
   }
   if(st.errors&&typeof st.errors==='object')for(const w of Object.keys(st.errors)){if(!sheet.errors[w])sheet.errors[w]=st.errors[w];}
   if(st.rowDrafts&&typeof st.rowDrafts==='object')for(const [key,r] of Object.entries(st.rowDrafts)){if(r&&typeof r.en==='string'&&typeof r.zh==='string'&&(!sheet.rowDrafts[key]||(r.at||0)>(sheet.rowDrafts[key].at||0)))sheet.rowDrafts[key]=r;}
   renderSheet();
  }catch{}
 });
 function sheetAskLoad(){try{if(isHost())window.parent.postMessage({type:'iws-sheet-load'},'*');}catch{}}
 setTimeout(sheetAskLoad,900);
 setTimeout(()=>{if(!sheetGotSync)sheetAskLoad();},2600);
 document.addEventListener('keydown', function navigateSheetWord(event) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (tab !== 'sheet' || document.querySelector('dialog[open]')) return;

  const target = event.target;
  if (!target.matches?.('body, #sheet-tab, #wordbook-back, #wordbook-open, #sheet-table .sen, #sheet-table .szh-in, #sheet-table .splay button')) return;
  const row = target.closest('tr[data-word]');
  let destination = $('sheet-table').tBodies[0].rows[0];
  if (row) destination = event.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;

  // At either end keep the current word and its playback.
  event.preventDefault();
  if (!destination) return;
  const column = target.matches('.szh-in') ? '.szh-in' : '.sen';
  destination.querySelector(column).focus();
 });
 $('sheet-table').addEventListener('focusin',ev=>{
  const t=ev.target;
  if(t&&t.tagName==='BUTTON')return;
  const tr=t&&t.closest?t.closest('tr'):null;
  if(!tr||!tr.dataset.word)return;
  if(sheet.autoPlay!==false)sheetPlayRow(tr);
  else if(sheetRepeat.row && sheetRepeat.row!==tr)sheetStopRepeat();
 });
 $('sheet-table').addEventListener('focusout',ev=>{
  const next=ev.relatedTarget;
  if(!next||!next.closest||!next.closest('#sheet-table'))sheetStopRepeat();
 });
 $('sheet-table').addEventListener('click',ev=>{
  const t=ev.target;
  if(!t||!t.closest)return;
  if(t.closest('button')||t.tagName==='INPUT')return;
  const tr=t.closest('tr');
  if(!tr||!tr.dataset.word)return;
  const input=tr.querySelector('.sen');
  if(input)input.focus();
 });

load();
})();

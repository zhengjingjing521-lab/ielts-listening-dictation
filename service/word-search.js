(function(root){
 'use strict';
 const norm=t=>String(t||'').trim().toLowerCase().replace(/\s+/g,' ');
 function buildIndex(catalog,gloss){return catalog.units.flatMap(u=>u.groups.flatMap(g=>g.words.map((word,index)=>({word,key:norm(word),unitId:u.id,unit:u.name,group:g.id,label:g.label,index,number:g.start+index,zh:(gloss[word]||{}).zh||'',ipa:(gloss[word]||{}).ipa||''}))));}
 function search(rows,text){const q=norm(text);if(!q)return [];const rank=r=>r.key===q?0:r.key.startsWith(q)?1:r.key.includes(q)?2:3;return rows.filter(r=>r.key.includes(q)||r.zh.includes(q)).sort((a,b)=>rank(a)-rank(b));}
 function createAutoQueue({send,storage,onStatus}){
  const key='ielts-wordbook-auto-v1';let pending=[],draining=null;
  try{const saved=JSON.parse(storage.getItem(key)||'[]');if(Array.isArray(saved))pending=saved.filter(p=>p&&p.action==='auto'&&typeof p.eventId==='string'&&typeof p.group==='string'&&Number.isInteger(p.index)&&typeof p.wrongSpelling==='string');}catch{onStatus('自动收录缓存暂时无法读取，请保持页面打开',true);}
  function persist(){try{storage.setItem(key,JSON.stringify(pending));return true;}catch{onStatus('自动收录尚未保存到本机缓存，请保持页面打开并重试',true);return false;}}
  function flush(){if(draining)return draining;if(!pending.length)return Promise.resolve();
   draining=(async()=>{while(pending.length){const item=pending[0];try{await send(item);}catch(e){onStatus('有 '+pending.length+' 个错词待同步：'+e.message,true);return;}pending=pending.filter(p=>p.eventId!==item.eventId);persist();}onStatus('错词已自动收录，可在错词本练习',false);})().finally(()=>{draining=null;});return draining;
  }
  function enqueue(item){if(!pending.some(p=>p.eventId===item.eventId)){pending.push(item);persist();}return flush();}
  return {enqueue,flush,pendingCount:()=>pending.length};
 }
 function createRemovalHistory({storage,validate}){
  const key='ielts-wordbook-undo-v1';let history=[],loadError=null;
  try{const saved=JSON.parse(storage.getItem(key)||'[]');if(!Array.isArray(saved))throw Error('记录格式无效');history=saved.filter(r=>r&&typeof r.id==='string'&&typeof r.key==='string'&&validate(r));}catch(e){loadError=e;}
  function commit(next){if(loadError)throw Error('撤销记录无法读取，尚未移出单词');storage.setItem(key,JSON.stringify(next));history=next;}
  return {list:()=>history.slice(),stage:r=>commit([...history.filter(x=>x.key!==r.key),r]),drop:id=>commit(history.filter(x=>x.id!==id)),reconcile:items=>{const next=history.filter(r=>!items.some(x=>x.key===r.key));if(next.length!==history.length)commit(next);}};
 }
 function mount({catalog,gloss,api,jump,openBook,onItems}){
  const $=id=>document.getElementById(id),rows=buildIndex(catalog,gloss),input=$('word-search-input'),list=$('word-search-results'),dialog=$('wordbook-dialog');
  let items=[],ready=false,pending=false,selected=null,trigger=null,limit=60,writeQueue=Promise.resolve(),removal=null,removeTrigger=null;
  const removeDialog=$('wordbook-remove-dialog');
  const undoHistory=createRemovalHistory({storage:window.practiceStorage,validate:r=>rows.some(x=>x.group===r.group&&x.index===r.index&&x.word===r.word&&x.key===r.key)});
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
  const entry=r=>items.find(e=>e.key===norm(r.word));
  function status(text,bad=false){$('wordbook-status').textContent=text;$('wordbook-status').classList.toggle('bad',bad);$('wordbook-status').parentElement.hidden=!bad;}
  function renderUndo(){const history=undoHistory.list(),last=history.at(-1);$('wordbook-undo-row').hidden=!last;$('wordbook-undo-label').textContent=last?'已移出 '+last.word+(history.length>1?' · '+history.length+' 项可撤销':''):'';$('wordbook-undo').disabled=pending||!ready;}
  function reconcileUndo(){try{undoHistory.reconcile(items);}catch(e){status('撤销记录尚未更新：'+e.message,true);}renderUndo();}
  function sync(value){items=value.items;ready=true;$('wordbook-open').disabled=false;$('wordbook-count').textContent=items.length;onItems(items);refreshButtons();if(!pending)reconcileUndo();}
  function refreshButtons(){document.querySelectorAll('[data-wordbook-add]').forEach(b=>{const exists=items.some(e=>e.key===b.dataset.wordbookAdd);b.disabled=!ready||exists;b.textContent=exists?'已收录':'补录错词';});document.querySelectorAll('[data-wordbook-history]').forEach(n=>{const saved=items.find(e=>e.key===n.dataset.wordbookHistory),text=(saved?.wrongSpellings||[]).join(' · ');n.textContent=text?'错拼：'+text:'';n.title=n.textContent;});}
  function mutate(body){const task=writeQueue.catch(()=>{}).then(async()=>{const value=await api('/api/wordbook',body);sync(value);return value;});writeQueue=task;return task;}
  const autoQueue=createAutoQueue({storage:window.practiceStorage,send:mutate,onStatus:(text,bad)=>{status(text,bad);$('wordbook-retry').hidden=!bad;}});
  async function reload(){try{await mutate();status('判错自动加入错词本；外部错词可搜索后补录');$('wordbook-retry').hidden=true;await autoQueue.flush();}catch(e){ready=false;$('wordbook-open').disabled=true;refreshButtons();status('错词本读取失败：'+e.message,true);$('wordbook-retry').hidden=false;}}
  function recordMistake(r){return autoQueue.enqueue({action:'auto',eventId:'sheet:'+crypto.randomUUID(),group:r.group,index:r.index,wrongSpelling:r.wrongSpelling,word:r.word});}
  function showAdd(r,button){if(!ready||entry(r))return;selected=r;trigger=button;$('wordbook-dialog-title').textContent='加入错词本 · '+r.word;$('wordbook-original').value='';$('wordbook-dialog-error').textContent='';dialog.showModal();$('wordbook-original').focus();}
  function addButton(r){const b=el('button','wordbook-add','补录错词');b.type='button';b.dataset.wordbookAdd=norm(r.word);b.setAttribute('aria-label','加入错词本 '+r.word);b.addEventListener('click',()=>showAdd(r,b));return b;}
  function renderResults(){const query=input.value,hits=search(rows,query);list.replaceChildren();$('word-search-panel').hidden=!norm(query);$('word-search-clear').hidden=!query;if(!norm(query))return;
   $('word-search-count').textContent=hits.length?('找到 '+hits.length+' 处 · 搜索全部 '+catalog.units.length+' 个词表'):'没有找到，试试部分英文或中文释义';
   for(const r of hits.slice(0,limit)){const li=el('li','word-search-result'),go=el('button','word-search-go');go.type='button';go.setAttribute('aria-label','定位 '+r.word+' '+r.unit+' '+r.label+' 第'+r.number+'词');go.append(el('strong','',r.word),el('span','word-search-meaning',r.zh||'暂无释义'),el('small','',r.unit+' / '+r.label+' / 第 '+r.number+' 词'));go.addEventListener('click',()=>{input.value='';renderResults();jump(r);});li.append(go,addButton(r));list.append(li);}
   $('word-search-more').hidden=hits.length<=limit;refreshButtons();
  }
  function askRemove(r,b){if(pending)return;removal=r;removeTrigger=b;$('wordbook-remove-title').textContent='移出「'+r.word+'」？';$('wordbook-remove-error').textContent='';removeDialog.showModal();$('wordbook-remove-cancel').focus();}
  async function confirmRemove(){if(pending||!removal)return;pending=true;const chosen=removal;$('wordbook-remove-confirm').disabled=true;$('wordbook-remove-cancel').disabled=true;$('wordbook-remove-error').textContent='';renderUndo();
   try{await autoQueue.flush();if(autoQueue.pendingCount())throw Error('还有错词未同步，请先重试同步');
    // Persist the inverse operation before sending; a lost response remains undoable.
    undoHistory.stage({id:crypto.randomUUID(),key:norm(chosen.word),word:chosen.word,group:chosen.group,index:chosen.index});
    await mutate({action:'remove',group:chosen.group,index:chosen.index});removeDialog.close();status('已移出 '+chosen.word+'，可以撤销');
   }catch(e){$('wordbook-remove-error').textContent='移出尚未确认：'+e.message+'。可重试，或取消后撤销。';}
   finally{pending=false;$('wordbook-remove-confirm').disabled=false;$('wordbook-remove-cancel').disabled=false;renderUndo();}
  }
  async function undoRemove(){if(pending||!ready)return;const chosen=undoHistory.list().at(-1);if(!chosen)return;pending=true;renderUndo();
   try{await mutate({action:'add',group:chosen.group,index:chosen.index,wrongSpelling:''});undoHistory.drop(chosen.id);status('已恢复 '+chosen.word);$('wordbook-open').focus();}
   catch(e){status('撤销尚未确认：'+e.message+'。请再点一次撤销。',true);}
   finally{pending=false;renderUndo();}
  }
  function decorateRow(tr,r,inBook){if(!inBook)return;const td=el('td','wordbook-cell');
   const history=el('span','wordbook-mistake raw');history.dataset.wordbookHistory=norm(r.word);tr.querySelector('.sword').append(history);
   const b=el('button','wordbook-remove','−');b.type='button';b.setAttribute('aria-label','移出错词本 '+r.word);b.title='移出错词本（需确认）';b.addEventListener('click',()=>askRemove(r,b));td.append(b);tr.append(td);
  }
  input.addEventListener('input',()=>{limit=60;renderResults();});input.addEventListener('keydown',e=>{if(e.key==='Escape'){input.value='';renderResults();}if(e.key==='ArrowDown'&&!e.isComposing){e.preventDefault();list.querySelector('button')?.focus();}if(e.key==='Enter'&&!e.isComposing){e.preventDefault();list.querySelector('.word-search-go')?.click();}});
  $('word-search-clear').addEventListener('click',()=>{input.value='';renderResults();input.focus();});$('word-search-more').addEventListener('click',()=>{limit+=60;renderResults();});
  $('wordbook-open').addEventListener('click',()=>{input.value='';renderResults();openBook();});$('wordbook-retry').addEventListener('click',reload);
  // Native form submission is blocked by the Obsidian iframe sandbox.
  // Invoke the existing API operations directly without navigating the frame.
  $('wordbook-remove-confirm').addEventListener('click',confirmRemove);
  $('wordbook-remove-form').addEventListener('submit',e=>e.preventDefault());
  $('wordbook-remove-cancel').addEventListener('click',()=>removeDialog.close());removeDialog.addEventListener('cancel',e=>{if(pending)e.preventDefault();});
  removeDialog.addEventListener('close',()=>{removal=null;if(removeTrigger?.isConnected)removeTrigger.focus();else $('wordbook-open').focus();});
  $('wordbook-undo').addEventListener('click',undoRemove);
  $('wordbook-cancel').addEventListener('click',()=>dialog.close());dialog.addEventListener('cancel',e=>{if(pending)e.preventDefault();});dialog.addEventListener('close',()=>{if(trigger?.isConnected)trigger.focus();else input.focus();});
  async function saveAddition(){if(pending||!selected||!dialog.open)return;pending=true;const chosen=selected;$('wordbook-save').disabled=true;$('wordbook-cancel').disabled=true;$('wordbook-dialog-error').textContent='';
   try{await mutate({action:'add',group:chosen.group,index:chosen.index,wrongSpelling:$('wordbook-original').value});status('已加入 '+chosen.word+'，可在错词本集中练习');dialog.close();}
   catch(err){$('wordbook-dialog-error').textContent='尚未保存：'+err.message;}
   finally{pending=false;$('wordbook-save').disabled=false;$('wordbook-cancel').disabled=false;reconcileUndo();}
  }
  $('wordbook-save').addEventListener('click',saveAddition);
  $('wordbook-form').addEventListener('submit',e=>e.preventDefault());
  $('wordbook-original').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();saveAddition();}});
  window.addEventListener('online',reload);
  renderUndo();reload();return {decorateRow,refreshButtons,recordMistake,refresh:reload,items:()=>items};
 }
 root.IeltsWordSearch={buildIndex,search,mount,createAutoQueue,createRemovalHistory};
})(globalThis);

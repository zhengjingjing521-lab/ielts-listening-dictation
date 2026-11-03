const {Plugin, ItemView, Notice} = require('obsidian');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {createInterface} = require('node:readline');
const {randomUUID} = require('node:crypto');

const VIEW = 'ielts-listening-dictation-view';

class PracticeView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW; }
  getDisplayText() { return '雅思单词听写'; }
  getIcon() { return 'headphones'; }
  async onOpen() {
    this.closed = false;
    const el = this.contentEl;
    el.empty();
    el.addClass('ild-public-view');
    const status = el.createEl('p', {text:'正在打开听写练习…'});
    try {
      const base = await this.plugin.start();
      if (this.closed) return;
      status.remove();
      const frame = el.createEl('iframe', {cls:'ild-public-frame', attr:{
        title:'雅思单词听写', sandbox:'allow-scripts allow-same-origin allow-downloads', allow:'autoplay'
      }});
      this.receive = async event => {
        if (event.origin !== base || event.source !== frame.contentWindow) return;
        const data = event.data;
        if (data?.type === 'iws-sheet-state' && data.state) {
          this.plugin.writeSheet(data.state);
        } else if (data?.type === 'iws-sheet-load') {
          await this.plugin.writes;
          try {
            const state = JSON.parse(await fs.promises.readFile(this.plugin.sheetFile,'utf8'));
            frame.contentWindow?.postMessage({type:'iws-sheet-state',state},base);
          } catch (error) {
            if (error.code !== 'ENOENT') new Notice('表格记录读取失败，请检查数据目录');
          }
        } else if (data?.type === 'ielts-export-ready') {
          require('electron').shell.showItemInFolder(path.join(this.plugin.dataDir,'dictation-records.xlsx'));
        }
      };
      window.addEventListener('message',this.receive);
      frame.src = base + '/?host=obsidian';
    } catch (error) {
      if (this.closed) return;
      status.setText(error.message);
      el.createEl('button',{text:'重试打开'}).onclick=()=>this.onOpen();
    }
  }
  async onClose() {
    this.closed = true;
    if (this.receive) window.removeEventListener('message',this.receive);
  }
}

module.exports = class DictationPlugin extends Plugin {
  async onload() {
    this.root = path.join(this.app.vault.adapter.getBasePath(),this.manifest.dir);
    this.dataDir = path.join(this.app.vault.adapter.getBasePath(),'IELTS Dictation Data');
    this.sheetFile = path.join(this.dataDir,'sheet.json');
    this.writes = Promise.resolve();
    this.settings = (await this.loadData()) || {};
    this.registerView(VIEW,leaf=>new PracticeView(leaf,this));
    this.addCommand({id:'open-dictation',name:'打开雅思单词听写',callback:()=>this.open()});
    this.addRibbonIcon('headphones','雅思单词听写',()=>this.open());
    this.registerMarkdownCodeBlockProcessor('ielts-dictation',(_,el)=>{
      el.createEl('button',{text:'打开雅思单词听写'}).onclick=()=>this.open();
    });
  }
  writeSheet(state) {
    const text = JSON.stringify(state);
    this.writes = this.writes.then(async ()=>{
      const temp = this.sheetFile+'.'+randomUUID()+'.tmp';
      try {
        await fs.promises.writeFile(temp,text,'utf8');
        await fs.promises.rename(temp,this.sheetFile);
      } finally { await fs.promises.rm(temp,{force:true}); }
    }).catch(()=>new Notice('表格记录写入失败，请检查数据目录'));
  }
  async open() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({type:VIEW,active:true});
    }
    await this.app.workspace.revealLeaf(leaf);
  }
  async start() {
    if (this.base) return this.base;
    if (this.starting) return this.starting;
    this.starting = this.startService();
    try { return await this.starting; } finally { this.starting = null; }
  }
  async startService() {
    const exe = path.join(this.root,'.venv',...(process.platform==='win32'?['Scripts','python.exe']:['bin','python']));
    if (!fs.existsSync(exe)) throw Error('请先按部署指南在插件目录创建 .venv 并安装 requirements.txt');
    // Reuse the previous port so browser preferences survive restarting the vault.
    // If another app occupies it, the fallback uses a fresh private listener.
    let base;
    try { base = await this.launch(exe,this.settings.port||0); }
    catch (error) {
      if (!this.settings.port || this.unloaded || error.code!=='PORT_BUSY') throw error;
      base = await this.launch(exe,0);
    }
    if (this.unloaded) throw Error('插件已关闭');
    this.base = base;
    this.settings.port = Number(new URL(base).port);
    await this.saveData(this.settings);
    return base;
  }
  launch(exe,port) {
    return new Promise((resolve,reject)=>{
      const child=spawn(exe,['-B','-u',path.join(this.root,'run.py'),'--port',String(port),'--data-dir',this.dataDir],
        {cwd:this.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
      this.child=child;
      let occupied=false;
      const timer=setTimeout(()=>{child.kill();reject(Error('服务启动超时，请检查 Python 环境'));},30000);
      child.stderr.on('data',chunk=>{if(/10048|EADDRINUSE|Address already in use/i.test(chunk.toString()))occupied=true;});
      const lines=createInterface({input:child.stdout});
      lines.on('line',line=>{
        let info; try { info=JSON.parse(line); } catch { return; }
        if (info.ready && Number.isInteger(info.port) && info.port>0 && info.port<=65535) {
          clearTimeout(timer);
          resolve('http://127.0.0.1:'+info.port);
        }
      });
      child.once('error',()=>{clearTimeout(timer);reject(Error('无法启动 Python，请检查插件的 .venv'));});
      child.once('exit',()=>{
        clearTimeout(timer); lines.close();
        if(this.child===child){this.child=null;this.base=null;}
        const error=Error('听写服务已退出，请按部署指南检查依赖');
        if(occupied)error.code='PORT_BUSY';
        reject(error);
      });
    });
  }
  onunload() {
    this.unloaded=true;
    this.app.workspace.detachLeavesOfType(VIEW);
    this.child?.kill();
  }
};

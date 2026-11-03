"""Dictation grading, journal and daily report."""
import json, re, sqlite3
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager
from pathlib import Path
from spellings import DEFAULT_SPELLINGS

ROOT = Path(__file__).resolve().parent
CATALOG = json.loads((ROOT/'catalog.json').read_text(encoding='utf-8'))
GROUPS = {g['id']: dict(g, unit=u['name']) for u in CATALOG['units'] for g in u['groups']}
VOICES = {'uk':'en-GB-SoniaNeural', 'us':'en-US-JennyNeural'}
NAMES = {'uk':'英音 Sonia', 'us':'美音 Jenny'}
TZ = timezone(timedelta(hours=8))
def normalized(text): return ' '.join(text.strip().lower().split())

def diff(a, b):
    a, b = normalized(a), normalized(b)
    d = [[0]*(len(b)+1) for _ in range(len(a)+1)]
    for i in range(len(a)+1): d[i][0]=i
    for j in range(len(b)+1): d[0][j]=j
    for i in range(1,len(a)+1):
        for j in range(1,len(b)+1):
            d[i][j]=min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]!=b[j-1]))
            if i>1 and j>1 and a[i-1]==b[j-2] and a[i-2]==b[j-1]: d[i][j]=min(d[i][j],d[i-2][j-2]+1)
    i,j=len(a),len(b); out=[]
    while i or j:
        if i and j and a[i-1]==b[j-1] and d[i][j]==d[i-1][j-1]:
            out.append(dict(kind='equal',typed=a[i-1],target=b[j-1]));i-=1;j-=1
        elif i>1 and j>1 and a[i-1]==b[j-2] and a[i-2]==b[j-1] and d[i][j]==d[i-2][j-2]+1:
            out.append(dict(kind='swap',typed=a[i-2:i],target=b[j-2:j]));i-=2;j-=2
        elif i and j and d[i][j]==d[i-1][j-1]+1:
            out.append(dict(kind='replace',typed=a[i-1],target=b[j-1]));i-=1;j-=1
        elif j and d[i][j]==d[i][j-1]+1:
            out.append(dict(kind='missing',typed='',target=b[j-1]));j-=1
        else: out.append(dict(kind='extra',typed=a[i-1],target=''));i-=1
    return list(reversed(out))

def describe(ops):
    names=[]
    for op in ops:
        a,b=op['typed'].replace(' ','空格'),op['target'].replace(' ','空格')
        if op['kind']=='missing': names.append('漏写 '+b)
        elif op['kind']=='extra': names.append('多写 '+a)
        elif op['kind']=='replace': names.append(a+' 应为 '+b)
        elif op['kind']=='swap': names.append('顺序 '+a+' → '+b)
    return '；'.join(names)

class Journal:
    def __init__(self,path,spellings=DEFAULT_SPELLINGS):
        self.spellings=spellings
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True)
        with self.connection() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE IF NOT EXISTS attempts (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, record TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS progress (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)')
    @contextmanager
    def connection(self):
        db=sqlite3.connect(self.path,timeout=15)
        try:
            db.execute('PRAGMA synchronous=FULL')
            with db: yield db
        finally: db.close()
    def append(self,payload,now=None):
        p=dict(payload)
        if not re.fullmatch(r'[0-9a-f-]{36}',str(p.get('id',''))): raise ValueError('记录编号无效')
        g=GROUPS.get(p.get('group'));idx=p.get('index')
        if not g or type(idx) is not int or not 0<=idx<len(g['words']): raise ValueError('分组或词号无效')
        if p.get('voice') not in VOICES or p.get('mode') not in ['练习','订正','复练']: raise ValueError('音色或练习模式无效')
        answer=p.get('answer','')
        if not isinstance(answer,str) or len(answer)>120: raise ValueError('答案过长')
        skip=p.get('skip') is True
        word=g['words'][idx]
        accepted=normalized(answer) in self.spellings.get(word,{})
        if not skip and not accepted and (not answer.strip() or not re.fullmatch(r"[A-Za-z'’ \-]+",answer)): raise ValueError('请填写英文拼写，或选择没听出来')
        heard=p.get('heard',[])
        if not isinstance(heard,list) or len(heard)>100 or any(h.get('voice') not in VOICES or h.get('rate') not in [1,.85] for h in heard): raise ValueError('播放信息无效')
        frozen=json.dumps(p,sort_keys=True,ensure_ascii=False)
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            prior=db.execute('SELECT payload,record FROM attempts WHERE id=?',(p['id'],)).fetchone()
            if prior:
                if prior[0]!=frozen: raise ValueError('同一记录编号不能提交不同答案')
                return json.loads(prior[1])
            correct=not skip and (normalized(answer)==normalized(word) or accepted)
            kind='正确' if correct else '未听出' if skip else '拼写错误'
            ops=[] if skip else diff(answer,answer if correct else word)
            stamp=now or datetime.now(TZ)
            row=dict(id=p['id'],time=stamp.isoformat(timespec='milliseconds'),day=stamp.strftime('%Y-%m-%d'),
                unit=g['unit'],group=g['label'],groupId=p['group'],wordNumber=g['start']+idx,word=word,wordKey=normalized(word),
                answer='' if skip else answer,result=kind,error='未听出' if skip else describe(ops),ops=ops,
                mode=p['mode'],voice=NAMES[p['voice']],heard=heard,
                heardVoices='、'.join(dict.fromkeys(NAMES[h['voice']] for h in heard)) or '本次未播放',plays=len(heard))
            db.execute('INSERT INTO attempts(id,payload,record) VALUES(?,?,?)',(p['id'],frozen,json.dumps(row,ensure_ascii=False)))
            return row
    def rows(self):
        with self.connection() as db: return [json.loads(r[0]) for r in db.execute('SELECT record FROM attempts ORDER BY seq')]
    def progress(self):
        with self.connection() as db:
            r=db.execute('SELECT value FROM progress WHERE id=1').fetchone()
            return json.loads(r[0]) if r else None
    def set_progress(self,p):
        if not isinstance(p,dict) or p.get('group') not in GROUPS or p.get('voice') not in VOICES: raise ValueError('进度无效')
        stamp=p.get('updatedAt',0)
        if type(stamp) not in [int,float] or not 0<=stamp<=9007199254740991: raise ValueError('进度版本无效')
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            existing=db.execute('SELECT value FROM progress WHERE id=1').fetchone()
            if existing and json.loads(existing[0]).get('updatedAt',0)>stamp:return False
            db.execute('INSERT INTO progress(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',(json.dumps(p,ensure_ascii=False),))
            return True

def report(rows):
    groups={}
    for r in rows: groups.setdefault((r['day'],r['wordKey']),[]).append(r)
    summary=[]
    for (day,key),items in groups.items():
        correct=sum(r['result']=='正确' for r in items)
        summary.append(dict(day=day,word=items[0]['word'],key=key,attempts=len(items),correct=correct,wrong=len(items)-correct,
            spelling=sum(r['result']=='拼写错误' for r in items),unheard=sum(r['result']=='未听出' for r in items),
            first=items[0]['result'],latest=items[-1]['result'],allCorrect=correct==len(items),
            examples='；'.join(dict.fromkeys((r['answer'] or '未听出')+'（'+r['error']+'）' for r in items if r['result']!='正确'))))
    return dict(rows=rows,summary=summary,today=datetime.now(TZ).strftime('%Y-%m-%d'),timezone='北京时间')


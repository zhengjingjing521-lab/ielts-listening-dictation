import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import zipfile
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from flask import Flask, Response, abort, jsonify, request, send_from_directory, session
from grading import CATALOG, GROUPS, ROOT, Journal, report
from spellings import DEFAULT_MEANINGS, DEFAULT_SPELLINGS
from wordbook import Wordbook
from export_xlsx import export


def load_secret(data_dir):
    secret_file = data_dir/'session.key'
    if not secret_file.exists():
        try:
            with secret_file.open('xb') as fp:
                os.chmod(secret_file,0o600)
                fp.write(secrets.token_bytes(32))
        except FileExistsError:
            pass
    value = secret_file.read_bytes()
    if len(value)!=32:
        raise RuntimeError('会话密钥文件不完整，请检查数据卷')
    return value


def create_app(data_dir, public_origin=None):
    data_dir.mkdir(parents=True,exist_ok=True)
    app = Flask(__name__, static_folder=None)
    app.secret_key = load_secret(data_dir)
    app.config.update(MAX_CONTENT_LENGTH=128000,SESSION_COOKIE_NAME='ielts_profile',
                      SESSION_COOKIE_HTTPONLY=True,SESSION_COOKIE_SECURE=bool(public_origin),
                      SESSION_COOKIE_SAMESITE='Strict')
    ipa=json.loads((ROOT/'ipa.json').read_text('utf-8'))
    gloss={w:{'zh':m,'ipa':ipa.get(w,''),'spellings':DEFAULT_SPELLINGS.get(w,{})} for w,m in DEFAULT_MEANINGS.items()}
    index=(ROOT/'index.html').read_text('utf-8')

    def profile():
        if not public_origin:
            return 'local'
        sid=session.get('profile','')
        if not isinstance(sid,str) or not re.fullmatch('[0-9a-f]{48}',sid):
            abort(403)
        return sid

    def proof(label):
        return hmac.new(app.secret_key,(label+':'+profile()).encode(),hashlib.sha256).hexdigest()

    @lru_cache(maxsize=128)
    def stores(sid):
        directory=data_dir if sid=='local' else data_dir/'profiles'/sid
        return Journal(directory/'practice.sqlite3'),Wordbook(directory/'wordbook.sqlite3',GROUPS)

    @app.before_request
    def check_request():
        origin=public_origin or app.config['LOCAL_ORIGIN']
        if request.host.lower()!=urlsplit(origin).netloc.lower():
            abort(403)
        if request.method=='POST':
            if request.headers.get('Origin',origin)!=origin or not hmac.compare_digest(request.headers.get('X-Practice-Token',''),proof('write')):
                abort(403)

    @app.after_request
    def headers(response):
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='no-referrer'
        if public_origin:
            response.headers['Content-Security-Policy']="default-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
        return response

    @app.errorhandler(403)
    def forbidden(_): return jsonify(error='访问或会话验证失败，请重新打开练习页'),403

    @app.errorhandler(ValueError)
    def invalid(exc): return jsonify(error=str(exc)),400

    @app.get('/')
    def home():
        if public_origin and not session.get('profile'):
            session['profile']=secrets.token_hex(24)
            session.permanent=True
        return Response(index.replace('__PRACTICE_SCOPE__',proof('browser')),mimetype='text/html')

    @app.get('/<asset>')
    def static_asset(asset):
        if asset not in {'style.css','storage.js','word-search.js','app.js'}:
            abort(404)
        return send_from_directory(ROOT,asset)

    @app.get('/api/health')
    def health():
        return jsonify(app='ielts-listening-dictation',version='1.1.8',words=CATALOG['recordCount'])

    @app.get('/api/init')
    def init():
        journal,_=stores(profile())
        return jsonify(token=proof('write'),catalog=CATALOG,gloss=gloss,progress=journal.progress(),report=report(journal.rows()))

    @app.get('/api/records')
    def records():
        journal,_=stores(profile())
        return jsonify(report(journal.rows()))

    @app.route('/api/wordbook',methods=['GET','POST'])
    def wordbook():
        _,book=stores(profile())
        if request.method=='GET':
            return jsonify(items=book.items())
        return jsonify(book.update(request.get_json()))

    @app.post('/api/progress')
    def progress():
        journal,_=stores(profile())
        return jsonify(saved=journal.set_progress(request.get_json()))

    @app.post('/api/attempts')
    def attempts():
        journal,book=stores(profile())
        data=request.get_json()
        if not isinstance(data,dict): abort(400)
        row=journal.append(data)
        result=dict(record=row,report=report(journal.rows()))
        if row['result']!='正确':
            group=GROUPS[row['groupId']]
            value=book.update(dict(action='auto',eventId='attempt:'+row['id'],group=row['groupId'],
                                   index=row['wordNumber']-group['start'],wrongSpelling=row['answer']))
            result['wordbook']={'items':value['items']}
        return jsonify(result)

    @app.get('/api/audio')
    def audio():
        voice=request.args.get('voice')
        group=GROUPS.get(request.args.get('group'))
        pos=request.args.get('index',type=int)
        if voice not in ('uk','us','zh') or not group or pos is None or not 0<=pos<len(group['words']):
            abort(400)
        word=group['words'][pos]
        value=DEFAULT_MEANINGS[word] if voice=='zh' else word
        key=hashlib.sha256(value.encode()).hexdigest()+'.mp3'
        with zipfile.ZipFile(ROOT.parent/'media'/(voice+'.zip')) as pack:
            return Response(pack.read(key),mimetype='audio/mpeg')

    @app.get('/api/export')
    def workbook():
        journal,_=stores(profile())
        data=export(report(journal.rows()))
        if not public_origin:
            with tempfile.NamedTemporaryFile(dir=data_dir,delete=False) as fp:
                fp.write(data)
                temp=Path(fp.name)
            try:
                os.replace(temp,data_dir/'dictation-records.xlsx')
            finally:
                temp.unlink(missing_ok=True)
        return Response(data,mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        headers={'Content-Disposition':'attachment; filename="dictation-records.xlsx"'})
    return app

"""Start the desktop/standalone loopback app, or an isolated-profile HTTPS deployment."""
import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0,str(Path(__file__).resolve().parent/'service'))
from waitress import create_server
from webapp import create_app


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=43219)
    parser.add_argument('--bind',default='127.0.0.1')
    parser.add_argument('--data-dir',type=Path,default=Path.home()/'.ielts-dictation')
    parser.add_argument('--public-origin',help='External HTTPS origin used by the reverse proxy')
    args=parser.parse_args()
    origin=args.public_origin.rstrip('/') if args.public_origin else None
    if origin:
        parsed=urlsplit(origin)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            parser.error('--public-origin must be an HTTPS origin without a path')
    elif args.bind!='127.0.0.1':
        parser.error('Local single-user mode must bind to 127.0.0.1')
    if not 0<=args.port<=65535:
        parser.error('Invalid port')
    app=create_app(args.data_dir.resolve(),origin)
    listener=create_server(app,host=args.bind,port=args.port,threads=6,max_request_body_size=128000)
    port=int(listener.effective_port)
    app.config['LOCAL_ORIGIN']=f'http://127.0.0.1:{port}'
    print(json.dumps({'ready':True,'port':port,'url':origin or app.config['LOCAL_ORIGIN']}),flush=True)
    listener.run()


if __name__=='__main__':
    main()

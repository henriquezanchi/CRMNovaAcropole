"""Publica somente o código versionado dos trabalhadores do CRM. Nunca lê arquivos de segredo."""
import os,sys,json,re,urllib.request,urllib.error,uuid,pathlib
root=pathlib.Path(__file__).resolve().parents[2]
slug=sys.argv[1]
permitidas={'sugerir-resposta-whatsapp','classificar-resposta-convite','analisar-funil-conversas','processar-especialistas','transcrever-audios-crm'}
assert slug in permitidas
entry=pathlib.Path('supabase/functions')/slug/'index.ts';files={}
def collect(path):
 path=path.resolve();assert path.is_relative_to(root/'supabase/functions')
 rel=str(path.relative_to(root))
 if rel in files:return
 content=path.read_bytes();files[rel]=content
 for imp in re.findall(r'(?:from\s*|import\s*)[\'\"](\.[^\'\"]+)[\'\"]',content.decode()):collect(path.parent/imp)
collect(root/entry)
boundary='crm-'+uuid.uuid4().hex;chunks=[]
metadata={'entrypoint_path':str(entry),'name':slug,'verify_jwt':slug not in {'analisar-funil-conversas','processar-especialistas','transcrever-audios-crm'}}
chunks.append(('--'+boundary+'\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n').encode()+json.dumps(metadata).encode()+b'\r\n')
for name,content in files.items():chunks.append(('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+name+'"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()+content+b'\r\n')
chunks.append(('--'+boundary+'--\r\n').encode());only='--bundle-only'in sys.argv
url='https://api.supabase.com/v1/projects/eovgljcowblwoxmobeno/functions/deploy?slug='+slug+('&bundleOnly=true'if only else'')
req=urllib.request.Request(url,data=b''.join(chunks),headers={'Authorization':'Bearer '+os.environ['SUPABASE_ACCESS_TOKEN'],'Content-Type':'multipart/form-data; boundary='+boundary},method='POST')
try:
 with urllib.request.urlopen(req,timeout=120)as r:
  data=r.read()
  if only:print(json.dumps({'slug':slug,'validacao_bundle':True,'http':r.status}))
  else:
   x=json.loads(data);print(json.dumps({k:x.get(k)for k in['slug','status','version','verify_jwt']}))
except urllib.error.HTTPError as e:print(e.code,e.read().decode()[:2000]);sys.exit(1)

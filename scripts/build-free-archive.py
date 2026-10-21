"""Build immutable, sharded archive assets without modifying the originals."""
from pathlib import Path
import sqlite3,json,hashlib,gzip,struct,array,base64,collections,os,re,time,subprocess,sys
ROOT=Path(__file__).resolve().parents[1]
DB=Path(os.environ.get('ARCHIVE_DB',str(ROOT/'work/cloud-snapshot.sqlite3')))
OUT=ROOT/'work/free-assets';TMP=ROOT/'work/free-build';TMP.mkdir(parents=True,exist_ok=True)
OUT.mkdir(parents=True,exist_ok=True)
STATE=TMP/'state.json';state=json.loads(STATE.read_text()) if STATE.exists() else {}
LIMIT=20*1024*1024
def log(**data):print(json.dumps(data,ensure_ascii=True),flush=True)
def save_state(key):state[key]=True;STATE.write_text(json.dumps(state))
def dumps(value):return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode('utf-8')
def write(path,value,compressed=False):
 path=OUT/path;path.parent.mkdir(parents=True,exist_ok=True);data=dumps(value)
 path.write_bytes(gzip.compress(data,compresslevel=6,mtime=0) if compressed else data)
def bucket(value):return hashlib.sha256(str(value).encode()).digest()[0]
def varints(ids):
 result=bytearray();last=0
 for ident in ids:
  value=ident-last;last=ident
  while value>=128:result.append((value&127)|128);value>>=7
  result.append(value)
 return base64.b64encode(result).decode()
class Records:
 def __init__(self,name,maximum):
  self.name=name+'-v2';self.index=array.array('I',[0])*((maximum+1)*3);self.block=0;self.offset=0;self.file=None
  (OUT/f'archive/{self.name}').mkdir(parents=True,exist_ok=True)
 def add(self,ident,value):
  data=dumps(value)+b'\n'
  if self.file is None or self.offset+len(data)>512*1024:
   if self.file:self.file.close();self.block+=1
   self.file=open(OUT/f'archive/{self.name}/{self.block:04d}.bin','wb');self.offset=0
  self.index[ident*3:ident*3+3]=array.array('I',[self.block,self.offset,len(data)])
  self.file.write(data);self.offset+=len(data)
 def finish(self):
  if self.file:self.file.close()
  data=self.index.tobytes();(OUT/f'archive/{self.name}-index.bin.gz').write_bytes(gzip.compress(data,6,mtime=0))
  # Worker requests only twelve bytes for an individual observation.
  for start in range(0,len(data),65536*12):
   (OUT/f'archive/{self.name}/index-{start//(65536*12):04d}.bin').write_bytes(data[start:start+65536*12])
c=sqlite3.connect(DB);c.row_factory=sqlite3.Row
sources={r['id']:dict(r) for r in c.execute('SELECT * FROM sources')}
students={r['sid']:dict(r) for r in c.execute('SELECT * FROM students')}
awards=[r[0] for r in c.execute('SELECT DISTINCT award FROM observations ORDER BY award')]
years=[r[0] for r in c.execute('SELECT DISTINCT year FROM observations ORDER BY year DESC')]
ai={x:i for i,x in enumerate(awards)};yi={x:i for i,x in enumerate(years)}
def source_info(s):
 result={k:s[k] for k in ['id','path','sha','size','ext','state','message','pages']}
 result['parts']=[{'path':f"/original/{s['sha']}/{i:04d}.bin",'offset':start,'length':min(LIMIT,s['size']-start)} for i,start in enumerate(range(0,s['size'],LIMIT))] if s['ext'] not in ['.zip','.rar'] and s['sha'] else []
 result['online_available']=bool(result['parts'])
 if s['ext'] in ['.zip','.rar']:result['message']='压缩包容器保留在本机；解压后的独立材料可分别查询和下载。'
 return result
if not state.get('sources'):
 for s in sources.values():write(Path(f"archive/sources/{s['id']}.json"),source_info(s))
 write(Path('archive/sources.json.gz'),[source_info(s) for s in sources.values()],True)
 save_state('sources');log(stage='sources',count=len(sources))
if not state.get('profiles'):
 shards=[{} for _ in range(256)];candidates=[{} for _ in range(128)]
 combos=collections.defaultdict(set);colleges=collections.defaultdict(set);counts=collections.defaultdict(set)
 records=Records('observations',c.execute('SELECT max(id) FROM observations').fetchone()[0])
 columns=['id','source','locator','sid','name','college','award','year','year_basis','level','amount','stage','excerpt','method']
 for n,row in enumerate(c.execute('SELECT '+','.join(columns)+' FROM observations ORDER BY id'),1):
  r=dict(row);r['record_hash']=hashlib.sha256(dumps(dict(sorted(r.items())))).hexdigest()
  records.add(r['id'],r)
  if r['sid'] in students:
   shards[bucket(r['sid'])].setdefault(r['sid'],[]).append(r)
   combo=yi[r['year']]*len(awards)+ai[r['award']];combos[r['sid']].add(combo)
   if r['college']:colleges[r['sid']].add(r['college'])
   if r['stage'] not in ['参考材料','未获奖/放弃']:counts[r['sid']].add(combo)
  elif not r['sid'] and r['name']:
   group=candidates[bucket(r['name'])%128].setdefault(r['name'],[])
   if len(group)<80:group.append(r)
  if n%100000==0:log(stage='profiles',records=n)
 records.finish()
 for i,shard in enumerate(shards):
  for rows in shard.values():rows.sort(key=lambda x:(x['year'],x['award'],x['stage']=='获奖/发放记录',-x['source']),reverse=True)
  write(Path(f'archive/profiles/{i:02x}.json.gz'),shard,True)
 for i,shard in enumerate(candidates):write(Path(f'archive/candidates/{i:02x}.json.gz'),shard,True)
 result=[]
 for sid,s in students.items():
  try:s['aliases']=json.loads(s['aliases'])
  except (ValueError,TypeError):s['aliases']=[]
  result.append({**s,'awards':len(counts[sid]),'combos':sorted(combos[sid]),'colleges':sorted(colleges[sid])})
 result.sort(key=lambda s:(not bool(s['name']),s['name'],s['sid']))
 write(Path('archive/students.json.gz'),result,True)
 save_state('profiles');log(stage='profiles_complete',students=len(result))
if not state.get('chunks'):
 records=Records('text',c.execute('SELECT max(id) FROM chunks').fetchone()[0])
 maps=[{} for _ in range(128)];tails=collections.defaultdict(list)
 exact=collections.defaultdict(list);known={sid.lower():sid for sid in students}
 pattern=re.compile(r'(?<![a-z0-9])(?:\d{8}|[a-z]{1,3}\d{6,10})(?![a-z0-9])')
 for n,row in enumerate(c.execute('SELECT * FROM chunks ORDER BY id'),1):
  r=dict(row);records.add(r['id'],r)
  maps[r['source']%128].setdefault(str(r['source']),[]).append([r['id'],r['locator'],r['method']])
  text=r['text'].lower()
  if len(text)>=2:tails[text[-2:]].append(r['id'])
  for sid in set(pattern.findall(text)):
   if sid in known:exact[known[sid]].append(r['id'])
  if n%100000==0:log(stage='text',records=n)
 records.finish()
 for i,shard in enumerate(maps):write(Path(f'archive/source-chunks/{i:02x}.json.gz'),shard,True)
 evidence=[{} for _ in range(256)]
 for sid,ids in exact.items():evidence[bucket(sid)][sid]=varints(ids)
 for i,shard in enumerate(evidence):write(Path(f'archive/evidence/{i:02x}.json.gz'),shard,True)
 (TMP/'tails.json').write_bytes(dumps(tails));save_state('chunks');log(stage='text_complete')
if not state.get('search'):
 handles=[]
 for i in range(256):handles.append(open(TMP/f'terms-{i:02x}.jsonl','wb'))
 def term_done(term,ids):
  handles[bucket(term[:2])].write(dumps([term,varints(ids)])+b'\n')
 c.execute('CREATE VIRTUAL TABLE temp.vocab USING fts5vocab(main,fulltext,instance)')
 current=None;ids=[];previous=('',0);terms=0
 for term,doc in c.execute('SELECT term,doc FROM temp.vocab'):
  if (term,doc)<previous:raise RuntimeError('Unexpected vocabulary order')
  previous=(term,doc)
  if term!=current:
   if current is not None:term_done(current,ids);terms+=1
   current=term;ids=[]
  if not ids or ids[-1]!=doc:ids.append(doc)
  if terms and terms%100000==0 and len(ids)==1:log(stage='search',terms=terms)
 if current is not None:term_done(current,ids)
 tails=json.loads((TMP/'tails.json').read_text(encoding='utf-8'))
 for term,ids in tails.items():term_done(term,ids)
 for h in handles:h.close()
 for i in range(256):
  shard=dict(json.loads(line) for line in (TMP/f'terms-{i:02x}.jsonl').read_bytes().splitlines())
  write(Path(f'archive/search/{i:02x}.json.gz'),shard,True)
 save_state('search');log(stage='search_complete',terms=terms)
if not state.get('originals'):
 unique={s['sha']:s for s in sources.values() if s['sha'] and s['ext'] not in ['.zip','.rar']}
 for n,s in enumerate(unique.values(),1):
  digest=hashlib.sha256();p=Path(s['actual']);info=source_info(s)
  with p.open('rb') as original:
   for part in info['parts']:
    target=OUT/part['path'].lstrip('/');target.parent.mkdir(parents=True,exist_ok=True)
    data=original.read(part['length']);digest.update(data)
    if not target.exists() or target.stat().st_size!=len(data):target.write_bytes(data)
  if digest.hexdigest()!=s['sha']:raise RuntimeError('Original changed: '+s['path'])
  if n%500==0:log(stage='originals',count=n,total=len(unique))
 save_state('originals');log(stage='originals_complete',count=len(unique))
subprocess.run([sys.executable,str(ROOT/'scripts/build-free-hashes.py')],check=True)
(OUT/'_headers').write_text('/*\n  Access-Control-Allow-Origin: '+os.environ.get('ARCHIVE_WEB_ORIGIN','https://YOUR_GITHUB_USERNAME.github.io')+'\n  Access-Control-Expose-Headers: Content-Length,Content-Range,Accept-Ranges,ETag\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: public, max-age=3600\n',encoding='utf-8')
paths=[p for p in OUT.rglob('*') if p.is_file() and p.name!='meta.json']
assert len(paths)+1<=20000,(len(paths),'asset file limit')
assert max(p.stat().st_size for p in paths)<=25*1024*1024,'asset size limit'
meta={
 'files':len(sources),'students':len(students),'observations':c.execute('SELECT count(*) FROM observations').fetchone()[0],
 'chunks':c.execute('SELECT count(*) FROM chunks').fetchone()[0],
 'states':dict(c.execute('SELECT state,count(*) FROM sources GROUP BY state')),
 'stages':dict(c.execute('SELECT stage,count(*) FROM observations GROUP BY stage')),
 'awards':awards,'years':years,'reviews':0,'issued':0,
 'meta':{'cloud_ready':'1','sync_phase':'档案与独立原件已准备完成；压缩包容器保留本机','updated':time.strftime('%Y-%m-%d %H:%M:%S')},
 'revision':hashlib.sha256((str(DB.stat().st_mtime_ns)+str(DB.stat().st_size)).encode()).hexdigest(),
 'asset_files':len(paths)+1,'asset_bytes':sum(p.stat().st_size for p in paths)
}
write(Path('archive/meta.json'),meta);log(stage='complete',files=meta['asset_files'],bytes=meta['asset_bytes'])

"""Build smaller default search data and self-contained profile shards."""
from pathlib import Path
import json,gzip,base64,collections
root=Path(__file__).resolve().parents[1];out=root/'work/free-assets/archive'
def read(path):return json.loads(gzip.decompress((out/path).read_bytes()))
def write(path,data):
 p=out/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(),6,mtime=0))
students=read('students.json.gz');pairs=read('award-students-v1.json.gz');policy=read('award-policy-v1.json.gz');codes=gzip.decompress((out/'award-status-v1.bin.gz').read_bytes())
colleges=sorted({s.get('college','') for s in students}|{c for s in students for c in s.get('colleges',[])})
ci={c:i for i,c in enumerate(colleges)};rows=[]
for s in students:
 if s['sid'] not in pairs:continue
 rows.append([s['sid'],s['name'],ci[s.get('college','')],pairs[s['sid']],s.get('conflict',0),[n for n in s['aliases'] if n!=s['name']],[ci[c] for c in s['colleges'] if c!=s.get('college','')]])
write('students-fast-v2.json.gz',{'colleges':colleges,'rows':rows})
sources={s['id']:s for s in read('sources.json.gz')};totals=collections.Counter()
def count_ids(encoded):return sum(not(b&128) for b in base64.b64decode(encoded or ''))
for bucket in range(256):
 name=f'{bucket:02x}.json.gz';profiles=read('profiles/'+name);evidence=read('evidence/'+name);result={}
 for sid,observations in profiles.items():
  records=[]
  for o in observations:
   s=sources[o['source']];code=codes[o['id']] or 6
   records.append({**o,**{k:s[k] for k in ['path','sha','ext','state']},'evidence_code':code,'evidence_label':policy['labels'][str(code)]})
  result[sid]={'observations':records,'evidence_count':count_ids(evidence.get(sid,''))}
 write('profiles-fast-v2/'+name,result);totals['profile_bytes']+=(out/'profiles-fast-v2'/name).stat().st_size
files=[p for p in out.parent.rglob('*') if p.is_file()];assert len(files)<=20000,len(files)
m=json.loads((out/'meta.json').read_bytes());m['fast_archive_version']=2;m['asset_files']=len(files);m['asset_bytes']=sum(p.stat().st_size for p in files);m['revision']+='-fast2-review2';(out/'meta.json').write_text(json.dumps(m,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(json.dumps({'default_students':len(rows),'old_index_bytes':(out/'students.json.gz').stat().st_size,'fast_index_bytes':(out/'students-fast-v2.json.gz').stat().st_size,'profile_bytes':totals['profile_bytes'],'asset_files':len(files)}))

from pathlib import Path
import sqlite3,json,gzip,os,collections
from award_policy import classify,LABELS,attach_headers
root=Path(__file__).resolve().parents[1];out=root/'work/free-assets/archive'
db=Path(os.environ.get('ARCHIVE_DB',str(root/'work/cloud-snapshot.sqlite3')))
c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
sources={r['id']:dict(r) for r in c.execute('SELECT id,path FROM sources')}
candidate_ids={r['source'] for row in c.execute('SELECT * FROM observations') if classify((r:=dict(row)),sources[r['source']])==1}
attach_headers(c,sources,candidate_ids)
meta=json.loads((out/'meta.json').read_bytes());awards=meta['awards'];years=meta['years'];ai={a:i for i,a in enumerate(awards)};yi={y:i for i,y in enumerate(years)}
codes=bytearray(c.execute('SELECT max(id) FROM observations').fetchone()[0]+1);counts=collections.Counter();pairs=collections.defaultdict(set);source_counts=collections.defaultdict(collections.Counter);old_positive=collections.Counter();examples=collections.defaultdict(list)
for row in c.execute('SELECT * FROM observations ORDER BY id'):
 r=dict(row);code=classify(r,sources[r['source']]);codes[r['id']]=code;counts[code]+=1;source_counts[r['source']][code]+=1
 if r['stage']=='获奖/发放记录' and code!=1:old_positive[code]+=1
 if code==1 and r['sid']:pairs[r['sid']].add(yi[r['year']]*len(awards)+ai[r['award']])
for ident,dist in source_counts.items():
 for code,n in dist.items():
  if len(examples[code])<12:examples[code].append({'source':ident,'path':sources[ident]['path'],'records':n})
def write(name,data,binary=False):
 raw=bytes(data) if binary else json.dumps(data,ensure_ascii=False,separators=(',',':')).encode()
 (out/name).write_bytes(gzip.compress(raw,6,mtime=0))
write('award-status-v1.bin.gz',codes,True);write('award-students-v1.json.gz',{sid:sorted(p) for sid,p in pairs.items()})
policy={'version':1,'labels':LABELS,'counts':dict(counts),'award_students':len(pairs),'award_records':counts[1],'downgraded_previous_award_records':dict(old_positive),'examples':dict(examples)}
write('award-policy-v1.json.gz',policy)
files=[p for p in out.parent.rglob('*') if p.is_file()];assert len(files)<=20000,len(files)
meta['asset_files']=len(files);meta['asset_bytes']=sum(p.stat().st_size for p in files);meta['revision']+='-award-policy1';(out/'meta.json').write_text(json.dumps(meta,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
(root/'work/award-policy-audit.json').write_text(json.dumps(policy,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:policy[k] for k in ['counts','award_students','award_records','downgraded_previous_award_records']},ensure_ascii=True))

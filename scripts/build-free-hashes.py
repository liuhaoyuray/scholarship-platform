from pathlib import Path
import sqlite3,json,hashlib,os
root=Path(__file__).resolve().parents[1]
out=root/'work/free-assets/archive/hashes';out.mkdir(parents=True,exist_ok=True)
c=sqlite3.connect(os.environ.get('ARCHIVE_DB',str(root/'work/cloud-snapshot.sqlite3')));c.row_factory=sqlite3.Row
sources={r['id']:r['sha'] for r in c.execute('SELECT id,sha FROM sources')}
columns=['id','source','locator','sid','name','college','award','year','year_basis','level','amount','stage','excerpt','method']
current=-1;data=None;total=0
for row in c.execute('SELECT '+','.join(columns)+' FROM observations ORDER BY id'):
 r=dict(row);part=r['id']//16384
 if part!=current:
  if data is not None:(out/f'{current:04d}.bin').write_bytes(data)
  current=part;data=bytearray(16384*64)
 digest=hashlib.sha256(json.dumps(r,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).digest()
 source=bytes.fromhex(sources[r['source']]);offset=r['id']%16384*64
 data[offset:offset+64]=digest+source;total+=1
if data is not None:(out/f'{current:04d}.bin').write_bytes(data)
print(json.dumps({'hash_records':total,'files':len(list(out.iterdir()))}),flush=True)

"""Give page assets and local module imports the deployed commit's version."""
from pathlib import Path
import re,sys
root=Path(__file__).resolve().parents[1];version=sys.argv[1]
assert re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',version)
p=root/'docs/index.html';s=p.read_text(encoding='utf-8')
s=re.sub(r'''((?:src|href)=)(["'])(\./(?:static/[^"'?]+|config\.js))\2''',lambda m:m[1]+m[2]+m[3]+'?v='+version+m[2],s)
p.write_text(s,encoding='utf-8')
for p in list((root/'docs/static').glob('*.js'))+list((root/'docs/static').glob('*.mjs'))+list((root/'docs/static/proof').glob('*.mjs')):
 s=p.read_text(encoding='utf-8');s=re.sub(r'''(from\s+|import\s*\()(["'])(\./[^"'?]+\.(?:mjs|js))\2''',lambda m:m[1]+m[2]+m[3]+'?v='+version+m[2],s);p.write_text(s,encoding='utf-8')

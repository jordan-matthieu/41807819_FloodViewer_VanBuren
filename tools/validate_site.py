"""Portable dependency and repository-content check for one static flood viewer."""
import argparse,json,os,re
from pathlib import Path
from urllib.parse import urlsplit,unquote

def assignment(path):
    return json.loads(path.read_text(encoding='utf-8').split('=',1)[1].strip().removesuffix(';'))

def repository_files(repo,failures):
    allowed={'site','tools','.github','README.md','deployment_manifest.json','.gitignore','.gitattributes'}
    forbidden_dirs={'cache','caches','source_cache','intermediate','intermediates','rendered','__pycache__','.pytest_cache','.cache','.venv','venv','node_modules'}
    forbidden_suffixes={'.mesh','.m21fm','.m3fm','.m21','.m3','.pfs','.tif','.tiff','.npy','.npz','.pkl','.pickle','.h5','.hdf5','.nc','.log','.tmp','.bak','.pyc','.zip'}
    files=[]
    for entry in repo.iterdir():
        if entry.name not in allowed|{'.git'}:failures.append('Unexpected repository-root entry: '+entry.name)
    for directory,dirs,names in os.walk(repo):
        parent=Path(directory)
        if parent==repo:dirs[:]=[name for name in dirs if name!='.git']
        for name in dirs:
            path=parent/name
            if name.lower() in forbidden_dirs or name=='.git':failures.append('Intermediate directory: '+str(path.relative_to(repo)))
            if path.is_symlink():failures.append('Linked directory: '+str(path.relative_to(repo)))
        for name in names:
            path=parent/name
            if parent==repo and name=='.git':continue
            relative=path.relative_to(repo).as_posix();suffix=path.suffix.lower()
            if suffix.startswith('.dfs') or suffix in forbidden_suffixes:failures.append('Numerical or intermediate file: '+relative)
            if path.is_symlink():failures.append('Linked file: '+relative)
            files.append(path)
    return files

def main():
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path('.'));p.add_argument('--require-ready',action='store_true');a=p.parse_args()
    repo=a.repo.resolve();site=repo/'site';failures=[];references=[]
    repo_files=repository_files(repo,failures)
    inventory={p.relative_to(site).as_posix() for p in site.rglob('*')};inventory.add('.')
    def ref(value,base):
        if not isinstance(value,str) or not value or value.startswith(('#','data:','mailto:')):return
        if value.startswith(('https://','http://')):return
        parsed=urlsplit(value);path=unquote(parsed.path)
        if not path:return
        if path.startswith('/') or re.match(r'^[A-Za-z]:',path) or parsed.scheme:
            failures.append('Absolute local URL: '+value);return
        target=(base/path).resolve()
        if not target.is_relative_to(site):failures.append('Escaped site: '+value);return
        if not target.exists():failures.append('Missing dependency: '+str(target.relative_to(site)));return
        # Preserve requested spelling: resolve() corrects case on Windows.
        lexical=Path(os.path.normpath(str(base/path)))
        if not lexical.is_relative_to(site):failures.append('Escaped site: '+value);return
        if lexical.relative_to(site).as_posix() not in inventory:failures.append('Case mismatch: '+value);return
        references.append(target)
    data=assignment(site/'data.js');confidence=assignment(site/'confidence.js')
    for v in [data.get('background'),data.get('overlay')]:ref(v,site)
    for x in data.get('backgrounds',[]):ref(x['url'],site)
    for x in data.get('sources',[]):ref(x['url'],site)
    ids=[]
    for frame in data['frames']:
        ids.append(frame['sourceIndex'])
        for key in ['frameData','hybrid','transparency','rawHybrid','rawTransparency','rawBands','strandedPng','png','hybridPng','transparencyPng','poster','qc']:
            if key in frame:ref(frame[key],site)
    if ids!=list(range(ids[0],ids[-1]+1)):failures.append('Non-contiguous source sequence')
    if [f['sourceIndex'] for f in confidence['frames']]!=ids:failures.append('Confidence sequence mismatch')
    metric_ids={m['id'] for m in confidence['metrics']}
    if not confidence.get('baselineAvailable') and 'scenarioSupport' in metric_ids:failures.append('Unavailable scenario metric included')
    for frame in confidence['frames']:
        if set(frame['images'])!=metric_ids:failures.append('Confidence metric mismatch')
        for v in frame['images'].values():ref(v,site)
    ref(confidence.get('methodUrl'),site)
    for f in site.rglob('*.html'):
        for v in re.findall(r'(?:href|src)=["\x27]([^"\x27]+)["\x27]',f.read_text(encoding='utf-8')):ref(v,f.parent)
    for f in site.rglob('*.css'):
        for v in re.findall(r'url\(\s*["\x27]?([^"\x27\s)]+)',f.read_text(encoding='utf-8')):ref(v,f.parent)
    files=[f for f in site.rglob('*') if f.is_file()];total=sum(f.stat().st_size for f in files)
    if total>=1_000_000_000:failures.append('Published site exceeds 1 GB')
    if any(f.stat().st_size>=100_000_000 for f in files):failures.append('File exceeds 100 MB')
    manifest=json.loads((repo/'deployment_manifest.json').read_text(encoding='utf-8'))
    # Git's configured LF conversion changes text byte totals after checkout.
    # Enforce actual size limits above and stable file/frame counts here.
    for key,value in [('siteFileCount',len(files)),('frameCount',len(ids))]:
        if manifest.get(key)!=value:failures.append('Deployment manifest mismatch: '+key)
    if a.require_ready and not manifest.get('readyForDeployment'):failures.append('Independent per-site QA has not marked this package ready')
    if failures:raise SystemExit('\n'.join(failures))
    print(json.dumps({'passed':True,'frames':len(ids),'confidenceMetrics':sorted(metric_ids),'files':len(files),'bytes':total,'repositoryFiles':len(repo_files),'repositoryBytes':sum(f.stat().st_size for f in repo_files),'numericalAndIntermediateFilesExcluded':True,'localReferences':len(references),'caseSensitiveInventoryValidated':True,'inventoryEntries':len(inventory)}))

if __name__=='__main__':main()

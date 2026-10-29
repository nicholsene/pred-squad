"""Disposable bare-Git integration tests for refresh publication and retry."""
import json,os,shlex,shutil,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
SCRIPT=(ROOT/'scripts/refresh.sh').read_text()
GIT=os.environ.get('TEST_GIT') or shutil.which('git')
assert GIT

def git(cwd,*args):
 return subprocess.check_output([GIT,*args],cwd=cwd,text=True,stderr=subprocess.DEVNULL).strip()
def configure(repo):
 git(repo,'config','user.name','test');git(repo,'config','user.email','test@example.invalid')
HELPER=r'''
import json,os,subprocess,sys
from pathlib import Path
root=Path.cwd();state=Path(os.environ['TEST_STATE']);p=state/'count'
count=int(p.read_text())+1 if p.exists() else 1;p.write_text(str(count))
record={'attempt':count,'generation':(root/'generation.txt').read_text(),'previous':json.loads((root/'docs/data/status.json').read_text()),'args':sys.argv[1:]}
with (state/'records').open('a') as f:f.write(json.dumps(record)+'\n')
scenario=os.environ['TEST_SCENARIO']
if scenario=='race' and count==1:
 peer=Path(os.environ['TEST_PEER']);(peer/'generation.txt').write_text('peer-new-main');(peer/'docs/data/status.json').write_text(json.dumps({'fetch':'peer'}))
 def git(*args):subprocess.run([os.environ['REAL_GIT'],*args],cwd=peer,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 git('add','.');git('commit','-qm','peer publication');git('push','origin','HEAD:main')
(root/'docs/data/status.json').write_text(json.dumps({'fetch':count}))
if scenario=='permanent' or scenario=='transient' and count==1:sys.exit(1)
'''
def case(parent,scenario,expected_status,expected_attempts,stale=False):
 base=parent/scenario;base.mkdir();remote,seed,client,peer=[base/n for n in ('remote.git','seed','client','peer')]
 git(base,'init','--bare',str(remote));git(base,'init',str(seed));configure(seed)
 (seed/'scripts').mkdir();(seed/'docs/data').mkdir(parents=True)
 (seed/'scripts/refresh.sh').write_text(SCRIPT);(seed/'scripts/fetch.py').write_text('# Stubbed by test interpreter.\n')
 (seed/'generation.txt').write_text('initial-main');(seed/'docs/data/status.json').write_text('{"fetch":0}')
 git(seed,'add','.');git(seed,'commit','-qm','initial');git(seed,'branch','-M','main');git(seed,'remote','add','origin',str(remote));git(seed,'push','-u','origin','main')
 git(base,'--git-dir',str(remote),'symbolic-ref','HEAD','refs/heads/main')
 git(base,'clone',str(remote),str(client));git(base,'clone',str(remote),str(peer));configure(peer)
 if stale:
  (peer/'generation.txt').write_text('queued-new-main');git(peer,'add','.');git(peer,'commit','-qm','main advanced');git(peer,'push','origin','HEAD:main')
 state,bin_dir=base/'state',base/'bin';state.mkdir();bin_dir.mkdir();helper=state/'fake_fetch.py';helper.write_text(HELPER)
 stub=bin_dir/'python';stub.write_text('#!/bin/sh\nexec '+shlex.quote(sys.executable)+' '+shlex.quote(str(helper))+' "$@"\n');stub.chmod(0o755)
 stub=bin_dir/'sleep';stub.write_text('#!/bin/sh\n[ "$1" = "300" ] || exit 90\nprintf "%s\\n" "$1" >> "$TEST_SLEEP_LOG"\n');stub.chmod(0o755)
 sleep_log=state/'sleeps'
 env={**os.environ,'GITHUB_ACTIONS':'true','PATH':str(bin_dir)+os.pathsep+str(Path(GIT).parent)+os.pathsep+os.environ['PATH'],'TEST_STATE':str(state),'TEST_SLEEP_LOG':str(sleep_log),'TEST_SCENARIO':scenario,'TEST_PEER':str(peer),'REAL_GIT':GIT}
 out=subprocess.run(['bash','scripts/refresh.sh','--skip-meta'],cwd=client,env=env,text=True,capture_output=True)
 assert out.returncode==expected_status,(scenario,out.stdout,out.stderr)
 records=[json.loads(x) for x in (state/'records').read_text().splitlines()]
 assert len(records)==expected_attempts,(scenario,records)
 assert all(x['args']==['scripts/fetch.py','--skip-meta'] for x in records)
 assert (sleep_log.read_text().splitlines() if sleep_log.exists() else [])==([] if expected_attempts==1 else ['300'])
 final=json.loads(git(base,'--git-dir',str(remote),'show','main:docs/data/status.json'));assert final['fetch']==expected_attempts
 if scenario in ('transient','permanent'):assert records[1]['previous']['fetch']==1
 if scenario=='race':
  assert records[1]['generation']=='peer-new-main';assert records[1]['previous']['fetch']=='peer'
  assert git(base,'--git-dir',str(remote),'show','main:generation.txt')=='peer-new-main'
 if stale:assert records[0]['generation']=='queued-new-main'
 before=git(client,'rev-parse','HEAD');refused=subprocess.run(['bash','scripts/refresh.sh'],cwd=client,env={**env,'GITHUB_ACTIONS':'false'},capture_output=True)
 assert refused.returncode==2;assert git(client,'rev-parse','HEAD')==before
with tempfile.TemporaryDirectory() as folder:
 p=Path(folder)
 case(p,'success',0,1);case(p,'transient',0,2);case(p,'permanent',1,2);case(p,'race',0,2);case(p,'queued',0,1,True)
print('ok: publication, partial fetch success, bounded retry, real push race, latest-main checkout and local-worktree guard')

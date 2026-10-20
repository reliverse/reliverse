import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
async function python(code: string) {
  const root = await mkdtemp(path.join(tmpdir(), "gr-owner-auth-install-"));
  try {
    const r = Bun.spawnSync(
      [
        "/usr/bin/python3",
        "-I",
        "-S",
        "-c",
        "import runpy,os,sys,json,stat,types; ns=runpy.run_path(sys.argv[1]); root=sys.argv[2]\n" +
          code,
        new URL("./owner-auth-bootstrap.py", import.meta.url).pathname,
        root,
      ],
      { timeout: 15000 },
    );
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("fixture passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("Auth bootstrap reads exact bounded public bytes and refuses symlink/hardlink/substitution", () =>
  python(`
fd=ns['directory']('/'); assert os.fstat(fd).st_uid==0; os.close(fd)
p=root+'/input'; data=b'PUBLIC'; open(p,'wb').write(data); d=ns['sha'](data)
assert ns['read'](p,os.getuid(),100,d)==data
for limit,digest in [(1,d),(100,'sha256:'+'0'*64)]:
 try: ns['read'](p,os.getuid(),limit,digest); raise AssertionError('bad bytes accepted')
 except RuntimeError: pass
os.symlink(p,root+'/link')
try: ns['read'](root+'/link',os.getuid(),100,d); raise AssertionError('link accepted')
except OSError: pass
os.link(p,root+'/hard')
try: ns['read'](p,os.getuid(),100,d); raise AssertionError('hardlink accepted')
except RuntimeError: pass
try: json.loads('{"a":1,"a":2}',object_pairs_hook=ns['unique']); raise AssertionError('duplicates accepted')
except RuntimeError: pass
print('fixture passed')
`));
test("bootstrap source root comes only from strict root-owned fixed-path policy", () =>
  python(`
original_read=ns['read']; calls=[]
policy={'schema':'gr.bootstrap-source.v0','sourceRoot':'/srv/operator/repository'}
def read(name,owner,limit,**kw):
 calls.append((name,owner,limit,kw));assert name==ns['SOURCE_POLICY'] and owner==0 and limit==4096 and kw=={'protected':True}
 return json.dumps(policy).encode()
ns['source_root'].__globals__['read']=read
os.environ['HOME']='/untrusted/home';os.environ['RELIVERSE_SOURCE_ROOT']='/untrusted/repo';sys.argv=['/untrusted/bootstrap.py']
assert ns['source_root']()=='/srv/operator/repository' and len(calls)==1
for value in ['/', 'relative', '/srv/../repository', '/srv//repository', '/srv/repository\\nother', None]:
 policy['sourceRoot']=value
 try:ns['source_root']();raise AssertionError('unsafe root accepted')
 except RuntimeError as e:assert str(e)=='SOURCE_POLICY_INVALID'
policy={'schema':'gr.bootstrap-source.v0','sourceRoot':'/srv/repository','override':True}
try:ns['source_root']();raise AssertionError('unknown policy field accepted')
except RuntimeError:pass
ns['source_root'].__globals__['read']=original_read
# Actual producer-owned policy bytes cannot become root policy authority.
p=root+'/untrusted.json';open(p,'wb').write(b'{}')
try:original_read(p,0,4096,protected=True);raise AssertionError('producer policy accepted')
except RuntimeError:pass
print('fixture passed')
`));
test("Auth identity and author are admitted policy data bound to checksum-pinned protected enrollment", () =>
  python(`
principal='prn_'+'a'*32
binding={'principal':{'id':principal,'kind':'human'},'boundByPrincipalId':principal,'status':'active','assurance':'verified','actor':{'id':'os-user.uid-995','kind':'human'},'provider':{'id':'local-os','subject':'uid:995'}}
enrollment={'schema':'rvs.secret-broker.owner-control-enrollment.v0','authenticationEnabled':True,'ownerUid':995,'agentUid':999,'brokerUid':996,'binding':binding}
p={'schema':'gr.owner-auth.host.v0','ownerEnrollmentDigest':ns['sha'](json.dumps(enrollment).encode()),'ownerPrincipalId':principal,'passwdDigest':'sha256:'+'b'*64,'groupDigest':'sha256:'+'c'*64,'author':{'name':'Fixture Owner','email':'owner@example.invalid'},'artifacts':[{'path':ns['EXECUTABLE'],'digest':'sha256:'+'d'*64},{'path':'/usr/bin/setpriv','digest':'sha256:'+'e'*64}],'links':[]}
now=ns['time'].time();iso=lambda t:ns['datetime'].fromtimestamp(t,ns['datetime'].fromisoformat('2026-01-01T00:00:00+00:00').tzinfo).isoformat().replace('+00:00','Z')
r={'schema':'gr.owner-auth.install-request.v0','createdAt':iso(now-1),'expiresAt':iso(now+100),'executable':{'source':'/fixture/temp/executable','digest':'sha256:'+'d'*64},'policy':{'source':'/fixture/temp/policy','digest':''},'bootstrapArtifacts':{os.path.realpath(sys.executable):'sha256:'+'f'*64}}
calls=[]
def read(name,owner,limit,digest=None,protected=False):
 calls.append((name,owner,protected))
 value=json.dumps(enrollment if name==ns['ENROLLMENT'] else p).encode() if name in [ns['ENROLLMENT'],r['policy']['source']] else b'{}'
 if name in [ns['ENROLLMENT'],r['policy']['source']] and digest!=ns['sha'](value):raise RuntimeError('fixture digest mismatch')
 if name==ns['ENROLLMENT']:assert owner==0 and protected is True
 return value
ns['validate'].__globals__.update(read=read,source_root=lambda:'/fixture')
def check():
 r['policy']['digest']=ns['sha'](json.dumps(p).encode());return ns['validate'](r)
assert check()[0]==p
for mutation in ['foreign-principal','disabled','actor','assurance','digest','author']:
 original_p=json.loads(json.dumps(p));original_e=json.loads(json.dumps(enrollment))
 if mutation=='foreign-principal':p['ownerPrincipalId']='prn_'+'b'*32
 if mutation=='disabled':enrollment['authenticationEnabled']=False;p['ownerEnrollmentDigest']=ns['sha'](json.dumps(enrollment).encode())
 if mutation=='actor':enrollment['binding']['actor']['id']='os-user.uid-1000';p['ownerEnrollmentDigest']=ns['sha'](json.dumps(enrollment).encode())
 if mutation=='assurance':enrollment['binding']['assurance']='unverified';p['ownerEnrollmentDigest']=ns['sha'](json.dumps(enrollment).encode())
 if mutation=='digest':p['ownerEnrollmentDigest']=None
 if mutation=='author':p['author']['name']='invalid\\nname'
 try:check();raise AssertionError('unbound policy accepted')
 except RuntimeError:pass
 p.clear();p.update(original_p);enrollment.clear();enrollment.update(original_e)
# A different independently enrolled owner works without changing production source.
p['ownerPrincipalId']='prn_'+'b'*32;enrollment['binding']['principal']['id']=p['ownerPrincipalId'];enrollment['binding']['boundByPrincipalId']=p['ownerPrincipalId'];p['ownerEnrollmentDigest']=ns['sha'](json.dumps(enrollment).encode())
assert check()[0]['ownerPrincipalId']==p['ownerPrincipalId']
assert not any(name==ns['EXECUTABLE'] for name,_,_ in calls)
print('fixture passed')
`));

const model = `
ns.update(EXECUTABLE=root+'/bin/owner-auth',POLICY=root+'/etc/policy.json',STATE=root+'/state/owner',CLAIM=root+'/claims/auth')
exe=b'\\x7fELFFIXTURE-NOT-EXECUTABLE'; policy=b'{}'; open(root+'/exe','wb').write(exe)
r={'executable':{'source':root+'/exe','digest':ns['sha'](exe)},'policy':{'digest':ns['sha'](policy)}}
def directory(name,create=False):
 if create: os.makedirs(name,exist_ok=True)
 return os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
ns.update(directory=directory,validate=lambda *a:({'ownerPrincipalId':'prn_'+'a'*32},policy))
for name in ['write','record','install','launch','update_helper','require_transition']: ns[name].__globals__.update(ns)
raw_install,raw_update,raw_launch=ns['install'],ns['update_helper'],ns['launch']
def serialized(function):
 def wrapped(*a,**kw):
  with ns['owner_transition'](a[1]):return function(*a,**kw)
 return wrapped
for name in ['install','launch','update_helper']:ns[name]=serialized(ns[name])
original_read=ns['read']
raw_install.__globals__['read']=lambda p,owner,*a,**kw:original_read(p,os.getuid(),*a,**kw)
os.fchown=lambda *a:None
`;
test("Auth admission is create-only, retains completion and never changes existing targets", () =>
  python(
    model +
      `
a=ns['install'](r,'sha256:'+'a'*64)
assert a['outcome']=='completed' and not a['authorityGranted'] and not a['gitExecutionAdmitted'] and not a['sshdChanged'] and not a['privateKeysRead']
assert stat.S_IMODE(os.stat(ns['STATE']).st_mode)==0o700
assert stat.S_IMODE(os.stat(ns['EXECUTABLE']).st_mode)==0o555
before=open(ns['CLAIM']+'/completed.json','rb').read()
try: ns['install'](r,'sha256:'+'a'*64); raise AssertionError('replay accepted')
except RuntimeError: pass
assert open(ns['CLAIM']+'/completed.json','rb').read()==before
print('fixture passed')
`,
  ));
const launchModel =
  model +
  `
ns['install'](r,'sha256:'+'a'*64)
os.isatty=lambda fd:True
result={'schema':'gr.owner-authentication.v0','principalId':'prn_'+'a'*32,'actorId':'os-user.uid-995','scopes':['identity.observe'],'audiences':['gr.owner-control'],'resources':['github:reliverse/reliverse'],'authorityGranted':False,'gitExecutionAdmitted':False,'campaignApproved':False}
def execute(file,argv,env):
 assert file=='/usr/bin/setpriv' and argv[-2:]==[ns['EXECUTABLE'],'authenticate']
 assert env=={'PATH':'/usr/bin:/bin','HOME':'/','LC_ALL':'C'}
 for flag in ['--clear-groups','--no-new-privs','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all']: assert flag in argv
 assert os.isatty(0) and stat.S_ISCHR(os.fstat(0).st_mode)
 os.write(1,json.dumps(result).encode()); os._exit(0)
os.execve=execute
`;
test("PTY bridge executes only fixed helper/clean environment and has separate no-replay history", () =>
  python(
    launchModel +
      `
a=ns['launch'](r,'sha256:'+'a'*64); assert a==result
assert os.path.exists(ns['CLAIM']+'/authentication-completed.json')
try: ns['launch'](r,'sha256:'+'a'*64); raise AssertionError('replay accepted')
except FileExistsError: pass
print('fixture passed')
`,
  ));
test("helper cannot authenticate a different Principal than the admitted enrollment-bound policy", () =>
  python(
    launchModel +
      `
result['principalId']='prn_'+'b'*32
try:ns['launch'](r,'sha256:'+'a'*64);raise AssertionError('foreign helper identity accepted')
except RuntimeError as e:assert str(e)=='AUTHENTICATION_RESULT_INVALID'
assert os.path.exists(ns['CLAIM']+'/authentication-reservation.json') and not os.path.exists(ns['CLAIM']+'/authentication-completed.json')
print('fixture passed')
`,
  ));

test("wrong Auth audience remains held without a completion or automatic replay", () =>
  python(
    launchModel +
      `
result['audiences']=['rvs.owner-control']
try: ns['launch'](r,'sha256:'+'a'*64); raise AssertionError('wrong audience accepted')
except RuntimeError: pass
assert os.path.exists(ns['CLAIM']+'/authentication-reservation.json') and not os.path.exists(ns['CLAIM']+'/authentication-completed.json')
try: ns['launch'](r,'sha256:'+'a'*64); raise AssertionError('held replay accepted')
except FileExistsError: pass
print('fixture passed')
`,
  ));
const updateModel =
  model +
  `
old=ns['install'](r,'sha256:'+'a'*64)
old_completion=open(ns['CLAIM']+'/completed.json','rb').read()
open(ns['STATE']+'/old-session.json','wb').write(b'fixture-history')
previous_exe=open(ns['EXECUTABLE'],'rb').read(); previous_policy=open(ns['POLICY'],'rb').read()
exe=b'\\x7fELFNEW-FIXTURE-NOT-EXECUTABLE'; open(root+'/new-exe','wb').write(exe)
r={**r,'executable':{'source':root+'/new-exe','digest':ns['sha'](exe)},'expectedInstallation':{'kind':'initial','requestDigest':old['requestDigest'],'executableDigest':old['executableDigest'],'policyDigest':old['policyDigest']}}
original_lstat=os.lstat
def metadata(p,*a,**kw):
 if p==ns['STATE']:return types.SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_uid=995,st_gid=985)
 return original_lstat(p,*a,**kw)
os.lstat=metadata
raw_update.__globals__.update(ns)
raw_update.__globals__['read']=lambda p,owner,*a,**kw:original_read(p,os.getuid(),*a,**kw)
`;
test("explicit helper update CAS-preserves initial admission and Auth history without replay", () =>
  python(
    updateModel +
      `
a,claim=ns['update_helper'](r,'sha256:'+'b'*64)
assert a['outcome']=='completed' and a['authStorePreserved'] and not a['authorityGranted']
assert open(ns['CLAIM']+'/completed.json','rb').read()==old_completion
assert open(ns['STATE']+'/old-session.json','rb').read()==b'fixture-history'
assert open(claim+'/previous-executable','rb').read()==previous_exe
assert open(claim+'/previous-policy.json','rb').read()==previous_policy
assert open(ns['EXECUTABLE'],'rb').read()==exe
try:ns['update_helper'](r,'sha256:'+'b'*64);raise AssertionError('replay accepted')
except RuntimeError:pass
print('fixture passed')
`,
  ));
test("helper update refuses stale prior admission before changing installed bytes", () =>
  python(
    updateModel +
      `
r['expectedInstallation']['executableDigest']='sha256:'+'0'*64
try:ns['update_helper'](r,'sha256:'+'b'*64);raise AssertionError('stale admission accepted')
except RuntimeError as e:assert str(e)=='PRIOR_ADMISSION_MISMATCH'
assert open(ns['EXECUTABLE'],'rb').read()==previous_exe
assert open(ns['POLICY'],'rb').read()==previous_policy
assert not os.path.exists(ns['CLAIM']+'-updates/'+'b'*64)
print('fixture passed')
`,
  ));

test("partial helper update retains unknown reservation, backups and no automatic rollback", () =>
  python(
    updateModel +
      `
replace=os.replace
calls=0
def uncertain(src,dst):
 global calls
 calls+=1
 if calls==2:raise OSError('fixture uncertain policy replacement')
 replace(src,dst)
os.replace=uncertain
try:ns['update_helper'](r,'sha256:'+'b'*64);raise AssertionError('partial update accepted')
except OSError:pass
claim=ns['CLAIM']+'-updates/'+'b'*64
assert os.path.exists(claim+'/reservation.json') and not os.path.exists(claim+'/completed.json')
assert open(claim+'/previous-executable','rb').read()==previous_exe
assert open(ns['EXECUTABLE'],'rb').read()==exe
assert open(ns['STATE']+'/old-session.json','rb').read()==b'fixture-history'
try:ns['update_helper'](r,'sha256:'+'b'*64);raise AssertionError('unknown replay accepted')
except (RuntimeError,FileExistsError):pass
assert calls==2
print('fixture passed')
`,
  ));

test("shared transition refuses an independent competing update before replace and during helper exec", () =>
  python(
    updateModel +
      `
def contender():
 # Independent process context: no inherited in-memory lock token is authority.
 rd,wr=os.pipe(); pid=os.fork()
 if pid==0:
  os.close(rd)
  raw_update.__globals__['_active_transition']=None
  try:
   with ns['owner_transition']('sha256:'+'c'*64):raw_update(r,'sha256:'+'c'*64)
  except FileExistsError:
   os.write(wr,b'blocked');os._exit(0)
  except BaseException:os._exit(2)
  os._exit(3)
 os.close(wr); answer=os.read(rd,100);os.close(rd)
 _,status=os.waitpid(pid,0)
 assert os.WIFEXITED(status) and os.WEXITSTATUS(status)==0 and answer==b'blocked'
 assert not os.path.exists(ns['CLAIM']+'-updates/'+'c'*64)
checks=0
def validate(request):
 global checks
 checks+=1
 if checks==2:contender()
 return {'ownerPrincipalId':'prn_'+'a'*32},policy
raw_update.__globals__['validate']=validate
os.isatty=lambda fd:True
result={'schema':'gr.owner-authentication.v0','principalId':'prn_'+'a'*32,'actorId':'os-user.uid-995','scopes':['identity.observe'],'audiences':['gr.owner-control'],'resources':['github:reliverse/reliverse'],'authorityGranted':False,'gitExecutionAdmitted':False,'campaignApproved':False}
def execute(file,argv,env):
 assert argv[-2:]==[ns['EXECUTABLE'],'reauthenticate']
 contender()
 assert open(ns['EXECUTABLE'],'rb').read()==exe
 os.write(1,json.dumps(result).encode());os._exit(0)
os.execve=execute
with ns['owner_transition']('sha256:'+'b'*64):
 a,claim=raw_update(r,'sha256:'+'b'*64)
 assert os.path.isdir(ns['CLAIM']+'-transition.lock')
 assert raw_launch(r,'sha256:'+'b'*64,claim,'reauthenticate')==result
 assert os.path.exists(claim+'/authentication-completed.json')
assert checks>=2 and not os.path.lexists(ns['CLAIM']+'-transition.lock')
assert open(ns['CLAIM']+'/completed.json','rb').read()==old_completion
# After release a second stale exact-old request still cannot replace the winner.
try:ns['update_helper'](r,'sha256:'+'c'*64);raise AssertionError('stale contender accepted')
except RuntimeError:pass
assert open(ns['EXECUTABLE'],'rb').read()==exe
print('fixture passed')
`,
  ));

test("failed transition remains durably held across process exit with no PID-based reclamation", () =>
  python(
    updateModel +
      `
pid=os.fork()
if pid==0:
 with ns['owner_transition']('sha256:'+'b'*64):os._exit(0)
_,status=os.waitpid(pid,0);assert os.WEXITSTATUS(status)==0
for digest in ['b','c']:
 try:
  with ns['owner_transition']('sha256:'+digest*64):raise AssertionError('dead-owner lock reclaimed')
 except FileExistsError:pass
assert os.path.exists(ns['CLAIM']+'-transition.lock/owner.json')
assert open(ns['EXECUTABLE'],'rb').read()==previous_exe
assert open(ns['STATE']+'/old-session.json','rb').read()==b'fixture-history'
print('fixture passed')
`,
  ));

test("install, update and launch require the same live transition guard", () =>
  python(
    updateModel +
      `
for function,args in [(raw_install,(r,'sha256:'+'b'*64)),(raw_update,(r,'sha256:'+'b'*64)),(raw_launch,(r,'sha256:'+'b'*64))]:
 try:function(*args);raise AssertionError('unguarded entry accepted')
 except RuntimeError as e:assert str(e)=='OWNER_AUTH_TRANSITION_REQUIRED'
assert open(ns['EXECUTABLE'],'rb').read()==previous_exe
print('fixture passed')
`,
  ));

test.skipIf(process.getuid?.() === 0)(
  "nonroot admission refuses before reading any packet or starting a PTY",
  () =>
    python(`
for mode in ['admit-and-authenticate','update-and-reauthenticate']:
 try: ns['main']([mode,'/never-read','sha256:'+'0'*64]); raise AssertionError('nonroot accepted')
 except RuntimeError as e: assert str(e)=='PERSONAL_OWNER_ROOT_COMMAND_REQUIRED'
print('fixture passed')
`),
);

import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
async function python(code: string) {
  const root = await mkdtemp(path.join(tmpdir(), "gr-publication-key-fixture-"));
  roots.push(root);
  const r = Bun.spawnSync(
    [
      "/usr/bin/python3",
      "-I",
      "-S",
      "-c",
      "import runpy,sys,os,json,hashlib,base64,stat,types,time; ns=runpy.run_path(sys.argv[1]); root=sys.argv[2]\n" +
        code,
      new URL("./publication-key-bootstrap.py", import.meta.url).pathname,
      root,
    ],
    { timeout: 15000 },
  );
  expect(r.stderr.toString()).toBe("");
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString()).toContain("fixture passed");
}

test("key bootstrap reads bounded exact source bytes, refuses links/drift and exposes only a valid public identity", () =>
  python(`
p=root+'/request'; data=b'PUBLIC REQUEST'; open(p,'wb').write(data); digest=ns['sha'](data)
assert ns['read_regular'](p,os.getuid(),1024,digest)==data
for limit,expected in [(2,digest),(1024,'sha256:'+'0'*64)]:
    try: ns['read_regular'](p,os.getuid(),limit,expected); raise AssertionError('bad source accepted')
    except RuntimeError: pass
os.symlink(p,root+'/link')
try: ns['read_regular'](root+'/link',os.getuid(),1024,digest); raise AssertionError('symlink accepted')
except OSError: pass
os.link(p,root+'/hard')
try: ns['read_regular'](p,os.getuid(),1024,digest); raise AssertionError('hardlink accepted')
except RuntimeError: pass
wire=b'\\x00\\x00\\x00\\x0bssh-ed25519\\x00\\x00\\x00\\x20'+bytes(range(32))
public=('ssh-ed25519 '+base64.b64encode(wire).decode()+' '+ns['COMMENT']+'\\n').encode()
identity=ns['public_identity'](public); assert identity['fingerprint']=='SHA256:'+base64.b64encode(hashlib.sha256(wire).digest()).decode().rstrip('=')
# Real OpenSSH parses only the synthetic public fixture, never a private key.
open(root+'/public.pub','wb').write(public)
r=ns['subprocess'].run(['/usr/bin/ssh-keygen','-lf',root+'/public.pub'],capture_output=True,text=True,timeout=5)
assert r.returncode==0 and identity['fingerprint'] in r.stdout
for raw in [b'PRIVATE KEY',public.replace(b'ssh-ed25519',b'ssh-rsa'),public.replace(ns['COMMENT'].encode(),b'other-repo')]:
    try: ns['public_identity'](raw); raise AssertionError('bad public record accepted')
    except (RuntimeError,ValueError): pass
try: json.loads('{"a":1,"a":2}',object_pairs_hook=ns['unique']); raise AssertionError('duplicate accepted')
except RuntimeError: pass
print('fixture passed')
`));

test("key requests bind the owner to protected enrollment while historical inspection grants no authority", () =>
  python(`
now=time.time(); iso=lambda t:ns['datetime'].fromtimestamp(t,ns['datetime'].fromisoformat('2026-01-01T00:00:00+00:00').tzinfo).isoformat().replace('+00:00','Z')
artifacts={p:'sha256:'+'a'*64 for p in ['/usr/bin/ssh-keygen','/usr/bin/setpriv',os.path.realpath(sys.executable)]}
principal='prn_'+'a'*32
enrollment={'schema':'rvs.secret-broker.owner-control-enrollment.v0','authenticationEnabled':True,'ownerUid':995,'agentUid':999,'brokerUid':996,'binding':{'principal':{'id':principal,'kind':'human'},'boundByPrincipalId':principal,'status':'active','assurance':'verified','actor':{'id':'os-user.uid-995','kind':'human'},'provider':{'id':'local-os','subject':'uid:995'}}}
p={'schema':'gr.publication-key.request.v0','repository':ns['REPOSITORY'],'requestedOwnerPrincipalId':principal,'ownerEnrollmentDigest':ns['sha'](json.dumps(enrollment).encode()),'createdAt':iso(now-10),'expiresAt':iso(now+100),'passwdDigest':'sha256:'+'b'*64,'groupDigest':'sha256:'+'c'*64,'artifacts':artifacts}
calls=[]; accounts={'reliverse-owner-control':(995,985),'producer':(1000,1000),'reviewer':(994,984)}
def read(name,owner,limit,expected=None,**kw):
 calls.append((name,owner,limit,expected))
 if name==ns['ENROLLMENT']:
  value=json.dumps(enrollment).encode();assert owner==0 and kw=={'protected_parents':True}
  if expected!=ns['sha'](value):raise RuntimeError('fixture enrollment digest mismatch')
  return value
 return b'{}'
ns['validate_request'].__globals__['read_regular']=read
ns['pwd'].getpwnam=lambda name:types.SimpleNamespace(pw_uid=accounts[name][0],pw_gid=accounts[name][1])
ns['pwd'].getpwuid=lambda uid:types.SimpleNamespace(pw_uid=uid,pw_gid=1000 if uid==1000 else 984)
ns['grp'].getgrall=lambda:[]
ns['validate_request'](p,'prepare'); assert len(calls)==len(artifacts)+3
for q in [dict(p,repository='foreign/repo'),dict(p,expiresAt=iso(now-1)),dict(p,passwdDigest=None),dict(p,artifacts={}),dict(p,requestedOwnerPrincipalId='prn_'+'0'*32),dict(p,ownerEnrollmentDigest='sha256:'+'0'*64),dict(p,ownerEnrollmentDigest=None)]:
    try: ns['validate_request'](q,'prepare'); raise AssertionError('bad request accepted')
    except RuntimeError: pass
before=len(calls); ns['validate_request'](dict(p,expiresAt=iso(now-1)),'inspect'); assert len(calls)==before
for field,value in [('authenticationEnabled',False),('ownerUid',1000)]:
 old=enrollment[field];enrollment[field]=value;changed=dict(p,ownerEnrollmentDigest=ns['sha'](json.dumps(enrollment).encode()))
 try:ns['validate_request'](changed,'prepare');raise AssertionError('invalid root enrollment accepted')
 except RuntimeError:pass
 enrollment[field]=old
for field,value in [('status','revoked'),('assurance','unverified'),('boundByPrincipalId','prn_'+'b'*32),('actor',{'id':'os-user.uid-1000','kind':'human'}),('provider',{'id':'local-os','subject':'uid:1000'})]:
 old=enrollment['binding'][field];enrollment['binding'][field]=value;changed=dict(p,ownerEnrollmentDigest=ns['sha'](json.dumps(enrollment).encode()))
 try:ns['validate_request'](changed,'prepare');raise AssertionError('foreign or revoked binding accepted')
 except RuntimeError:pass
 enrollment['binding'][field]=old
# The root binding, not a source constant, selects a different legitimate owner.
enrollment['binding']['principal']['id']='prn_'+'b'*32;enrollment['binding']['boundByPrincipalId']='prn_'+'b'*32
changed=dict(p,requestedOwnerPrincipalId='prn_'+'b'*32,ownerEnrollmentDigest=ns['sha'](json.dumps(enrollment).encode()))
ns['validate_request'](changed,'prepare')
accounts['reliverse-owner-control']=(1000,1000)
try: ns['validate_request'](changed,'prepare'); raise AssertionError('shared UID accepted')
except RuntimeError: pass
print('fixture passed')
`));

test("new root-parent modes remain traversable under secret umask without widening existing directories", () =>
  python(`
original_stat=os.fstat
# Model root ownership only; chmod and umask operate on real disposable directories.
def root_stat(fd):
    s=original_stat(fd); return types.SimpleNamespace(st_uid=0,st_mode=s.st_mode&~0o022)
os.fstat=root_stat; ns['directory'].__globals__['os']=os
before=stat.S_IMODE(os.stat(root).st_mode); old=os.umask(0o077)
try:
    fd=ns['directory'](root+'/parent/child',create=True); os.close(fd)
finally: os.umask(old)
assert stat.S_IMODE(os.stat(root+'/parent').st_mode)==0o755
assert stat.S_IMODE(os.stat(root+'/parent/child').st_mode)==0o755
assert stat.S_IMODE(os.stat(root).st_mode)==before
print('fixture passed')
`));

const authHostKey =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";

test("authentication requests pin the official host key, native SSH and generation identity", () =>
  python(`
now=time.time(); iso=lambda t:ns['datetime'].fromtimestamp(t,ns['datetime'].fromisoformat('2026-01-01T00:00:00+00:00').tzinfo).isoformat().replace('+00:00','Z')
p={'schema':'gr.publication-key.authentication-request.v0','repository':ns['REPOSITORY'],'requestedOwnerPrincipalId':'prn_'+'a'*32,'ownerEnrollmentDigest':'sha256:'+'e'*64,'createdAt':iso(now-10),'expiresAt':iso(now+100),'passwdDigest':'sha256:'+'b'*64,'groupDigest':'sha256:'+'c'*64,'artifacts':{'/usr/bin/ssh':'sha256:'+'a'*64},'generationRequestDigest':'sha256:'+'d'*64,'keyFingerprint':'SHA256:'+'A'*43,'githubHostKey':'${authHostKey}'}
calls=[]; ns['validate_auth_request'].__globals__['validate_request']=lambda *a:calls.append(a)
ns['validate_auth_request'](p,'authenticate'); assert calls[-1][0]['schema']=='gr.publication-key.request.v0'
assert 'githubHostKey' not in calls[-1][0]
for q in [dict(p,githubHostKey=p['githubHostKey']+'\\n'),dict(p,githubHostKey=None),dict(p,githubHostKey=p['githubHostKey'].replace('GKJl','GKJm')),dict(p,generationRequestDigest='bad'),dict(p,keyFingerprint='bad'),dict(p,artifacts={}),dict(p,schema='gr.publication-key.request.v0')]:
    try: ns['validate_auth_request'](q,'authenticate'); raise AssertionError('bad auth request accepted')
    except RuntimeError: pass
ns['validate_auth_request'](p,'inspect-auth'); assert calls[-1][1]=='inspect'
print('fixture passed')
`));

test("authentication argv is fixed, isolated, host-pinned and has no Git or remote command", () =>
  python(`
a=ns['authentication_argv'](); assert a[-1]=='git@github.com' and a[-2]==ns['KEY']
assert a[:3]==['/usr/bin/setpriv','--reuid=995','--regid=985']
for flag in ['--clear-groups','--no-new-privs','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','/usr/bin/ssh','-T']: assert flag in a
options=[a[i+1] for i,x in enumerate(a) if x=='-o']
for option in ['IdentityAgent=none','CertificateFile=none','IdentitiesOnly=yes','BatchMode=yes','StrictHostKeyChecking=yes','ForwardAgent=no','ClearAllForwardings=yes','ControlPath=none','ProxyCommand=none','ProxyJump=none','UserKnownHostsFile='+ns['KNOWN_HOSTS'],'GlobalKnownHostsFile=/dev/null','HostKeyAlgorithms=ssh-ed25519','UpdateHostKeys=no','ConnectTimeout=10','ConnectionAttempts=1']: assert option in options
assert a[a.index('-F')+1]=='/dev/null' and a[a.index('-p')+1]=='22'
greeting=b"Hi reliverse/reliverse! You've successfully authenticated, but GitHub does not provide shell access.\\n"
assert ns['github_authentication_result'](1,greeting)
for code,data in [(0,greeting),(255,greeting),(1,greeting.replace(b'reliverse/reliverse',b'other/repo')),(1,greeting+b'error'),(1,b'')]: assert not ns['github_authentication_result'](code,data)
print('fixture passed')
`));

test("authentication custody binds completed generation and public identity without private reads", () =>
  python(`
wire=b'\\x00\\x00\\x00\\x0bssh-ed25519\\x00\\x00\\x00\\x20'+bytes(range(32))
public=('ssh-ed25519 '+base64.b64encode(wire).decode()+' '+ns['COMMENT']).encode()
identity=ns['public_identity'](public)
request={'generationRequestDigest':'sha256:'+'a'*64,'keyFingerprint':identity['fingerprint']}
receipt=dict(identity,outcome='completed',recordRole='completion',requestDigest=request['generationRequestDigest'],repository=ns['REPOSITORY'])
calls=[]; denied=True; original_lstat=os.lstat; original_directory=ns['DIRECTORY']; original_key=ns['KEY']
def read(name,*a,**kw):
    calls.append(name); assert name!=original_key,'PRIVATE_READ'
    return public if name==original_key+'.pub' else json.dumps(receipt).encode()
def metadata(name):
    return types.SimpleNamespace(st_uid=995,st_gid=985,st_mode=(stat.S_IFDIR|0o700) if name==original_directory else (stat.S_IFREG|0o600),st_nlink=1,st_size=100)
ns['assert_auth_custody'].__globals__.update(read_regular=read,directory=lambda *a:os.open(root,os.O_RDONLY|os.O_DIRECTORY),excluded_access_denied=lambda *a:denied)
os.lstat=metadata
ns['assert_auth_custody'](request); assert calls==[ns['CLAIM']+'/completed.json',original_key+'.pub']
for field,value in [('outcome','outcome-unknown'),('requestDigest','sha256:'+'b'*64),('fingerprint','SHA256:'+'B'*43),('publicKey','other')]:
    before=receipt[field]; receipt[field]=value
    try: ns['assert_auth_custody'](request); raise AssertionError('bad generation accepted')
    except RuntimeError: pass
    receipt[field]=before
denied=False
try: ns['assert_auth_custody'](request); raise AssertionError('producer access accepted')
except RuntimeError: pass
os.lstat=original_lstat
print('fixture passed')
`));

const authModel = `
ns.update(UID=os.getuid(),GID=os.getgid(),DIRECTORY=root+'/credentials',KEY=root+'/credentials/private',KNOWN_HOSTS=root+'/credentials/known_hosts')
os.mkdir(ns['DIRECTORY'],0o700)
request={'generationRequestDigest':'sha256:'+'a'*64,'keyFingerprint':'SHA256:'+'A'*43,'githubHostKey':'${authHostKey}'}
actual_open=os.open; calls=[]; custody=[]; code=1
real_read=ns['read_regular']
def guarded_open(name,flags,*a,**kw):
    assert name!=ns['KEY'],'PRIVATE_OPENED'
    return actual_open(name,flags,*a,**kw)
def directory(name,create=False):
    if create: os.makedirs(name,exist_ok=True)
    return actual_open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
def run(argv,**kw):
    calls.append(argv); assert argv==ns['authentication_argv']()
    assert kw['env']=={'PATH':'/usr/bin:/bin','HOME':'/','LC_ALL':'C'} and kw['cwd']=='/' and kw['timeout']==25
    assert kw['stdin']==ns['subprocess'].DEVNULL and kw['stdout'] is kw['stderr']
    kw['stdout'].write(b"Hi reliverse/reliverse! You've successfully authenticated, but GitHub does not provide shell access.\\n")
    return types.SimpleNamespace(returncode=code)
ns.update(directory=directory,validate_auth_request=lambda *a:None,assert_auth_custody=lambda *a:custody.append(True))
for name in ['authenticate','write_new','authentication_argv']: ns[name].__globals__.update(ns)
os.open=guarded_open; ns['subprocess'].run=run
claim=root+'/auth-checks/attempt'
`;

test("authentication is create-only, bounded and never reads private bytes", () =>
  python(
    authModel +
      `
r=ns['authenticate'](request,'sha256:'+'b'*64,claim)
assert r['outcome']=='completed' and r['repositoryAuthenticationVerified'] and not r['privateKeyReadByBootstrap']
assert r['writePermission']=='owner-reported-not-probed' and not r['gitExecutionAdmitted'] and not r['campaignApproved']
assert len(calls)==1 and len(custody)==3
assert ns['resource'].getrlimit(ns['resource'].RLIMIT_FSIZE)==(65536,65536)
assert os.listdir(claim)==['reservation.json','completed.json']
assert stat.S_IMODE(os.stat(ns['KNOWN_HOSTS']).st_mode)==0o600
before=open(claim+'/completed.json','rb').read()
try: ns['authenticate'](request,'sha256:'+'b'*64,claim); raise AssertionError('replay accepted')
except RuntimeError: pass
assert len(calls)==1 and open(claim+'/completed.json','rb').read()==before
print('fixture passed')
`,
  ));

for (const failure of ["code=255", "open(ns['KNOWN_HOSTS'],'wb').write(b'foreign host key')"])
  test(`authentication failure retains reservation without retry or overwrite: ${failure}`, () =>
    python(
      authModel +
        failure +
        `
try: ns['authenticate'](request,'sha256:'+'b'*64,claim); raise AssertionError('failure accepted')
except RuntimeError: pass
assert os.path.exists(claim+'/reservation.json') and not os.path.exists(claim+'/completed.json')
count=len(calls)
try: ns['authenticate'](request,'sha256:'+'b'*64,claim); raise AssertionError('partial replay accepted')
except RuntimeError: pass
assert len(calls)==count
if count==0: assert open(ns['KNOWN_HOSTS'],'rb').read()==b'foreign host key'
print('fixture passed')
`,
    ));

const model = `
ns.update(UID=os.getuid(),GID=os.getgid(),DIRECTORY=root+'/credentials/key',CLAIM=root+'/requests/key',KEY=root+'/credentials/key/deploy-ed25519')
wire=b'\\x00\\x00\\x00\\x0bssh-ed25519\\x00\\x00\\x00\\x20'+bytes(range(32))
public=('ssh-ed25519 '+base64.b64encode(wire).decode()+' '+ns['COMMENT']+'\\n').encode()
real_read=ns['read_regular']; actual_open=os.open; runs=[]; denied=True; exit_code=0
def directory(name,create=False):
    if create: os.makedirs(name,exist_ok=True)
    return actual_open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
def source(name,*a,**k):
    assert name!=ns['KEY'],'PRIVATE_CONTENT_READ'
    return real_read(name,*a,**k)
def guarded_open(name,flags,*a,**k):
    if name==ns['KEY']: assert flags&os.O_ACCMODE==os.O_WRONLY,'PRIVATE_OPENED_FOR_READ'
    return actual_open(name,flags,*a,**k)
def run(argv,**kw):
    runs.append((argv,kw)); assert argv[0]=='/usr/bin/setpriv' and argv[-1]==ns['KEY']
    for flag in ['--clear-groups','--no-new-privs','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all']: assert flag in argv
    assert kw['cwd']=='/' and kw['env']=={'PATH':'/usr/bin:/bin','HOME':'/','LC_ALL':'C'}
    assert kw['stdin']==ns['subprocess'].DEVNULL and kw['stdout']==ns['subprocess'].DEVNULL and kw['stderr']==ns['subprocess'].DEVNULL
    # Dummy bytes, not a generated private credential. Only filesystem effects modeled.
    for name,data in [(ns['KEY'],b'FIXTURE-NOT-A-PRIVATE-KEY'),(ns['KEY']+'.pub',public)]:
        f=actual_open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600); os.write(f,data); os.close(f)
    return types.SimpleNamespace(returncode=exit_code)
ns.update(directory=directory,read_regular=source,validate_request=lambda *a:None,assert_owner_parent_traversal=lambda:None,excluded_access_denied=lambda *a:denied)
for name in ['write_new','prepare']: ns[name].__globals__.update(ns)
os.open=guarded_open; ns['subprocess'].run=run
`;

test("candidate preparation is create-only, suppresses tool output and does not read private bytes", () =>
  python(
    model +
      `
r=ns['prepare']({},'sha256:'+'1'*64)
assert r['outcome']=='completed' and r['keyCreated'] and not r['privateKeyContentsRead']
assert not r['githubRegistered'] and not r['gitExecutionAdmitted'] and not r['campaignApproved']
assert r['publicKey'].encode()==public.strip() and len(runs)==1
assert stat.S_IMODE(os.stat(ns['DIRECTORY']).st_mode)==0o700
assert stat.S_IMODE(os.stat(ns['KEY']).st_mode)==0o600
completed=open(ns['CLAIM']+'/completed.json','rb').read()
try: ns['prepare']({},'sha256:'+'1'*64); raise AssertionError('replay accepted')
except RuntimeError: pass
assert len(runs)==1 and open(ns['CLAIM']+'/completed.json','rb').read()==completed
print('fixture passed')
`,
  ));

for (const failure of ["exit_code=1", "denied=False"])
  test(`uncertain key preparation retains claim without completion or retry: ${failure}`, () =>
    python(
      model +
        failure +
        `
try: ns['prepare']({},'sha256:'+'1'*64); raise AssertionError('failure accepted')
except RuntimeError: pass
assert os.path.exists(ns['CLAIM']+'/reservation.json') and not os.path.exists(ns['CLAIM']+'/completed.json')
try: ns['prepare']({},'sha256:'+'1'*64); raise AssertionError('partial replay accepted')
except RuntimeError: pass
assert len(runs)==1
print('fixture passed')
`,
    ));

test.skipIf(process.getuid?.() === 0)(
  "ordinary producer cannot invoke native generation or inspect private root state",
  () =>
    python(`
for op in ['prepare','inspect','authenticate','inspect-auth']:
    try: ns['main']([op,'/never-read','sha256:'+'0'*64]); raise AssertionError('ordinary producer admitted')
    except RuntimeError as e: assert str(e)=='PERSONAL_OWNER_ROOT_COMMAND_REQUIRED'
print('fixture passed')
`),
);

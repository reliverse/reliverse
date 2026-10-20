import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const source = new URL("./native-review-apparmor-acceptance.py", import.meta.url).pathname;
function python(code: string) {
  const r = spawnSync("/usr/bin/python3", ["-I", "-S", "-c", code, source], {
    encoding: "utf8",
    timeout: 10000,
  });
  expect(r.error).toBeUndefined();
  expect(r.status).toBe(0);
  return r.stdout;
}
const load = `import runpy,sys,json,base64,time,hashlib\na=runpy.run_path(sys.argv[1])\n`;

test("AppArmor acceptance module loads/compiles without native execution", () => {
  expect(python(load + 'compile(a["PROBE"],"probe","exec"); print("no-effects")')).toBe(
    "no-effects\n",
  );
});
test("request rejects duplicate fields, changed profile, includes, expiry and tool widening", () => {
  expect(
    python(
      load +
        `
def must_fail(f):
 try: f()
 except Exception: return
 raise AssertionError("accepted invalid request")
must_fail(lambda: json.loads('{"x":1,"x":2}',object_pairs_hook=a['unique']))
profile=b'profile reliverse-gr-native-review flags=(attach_disconnected,mediate_deleted) {\\n file,\\n}\\n'
a['validate'].__globals__['read']=lambda *args,**kwargs: b''
a['validate'].__globals__['directory']=lambda *args,**kwargs: __import__('os').open('/',__import__('os').O_RDONLY)
r={'schema':'gr.native-review.apparmor-acceptance-request.v0','createdAtUnix':time.time()-1,'expiresAtUnix':time.time()+3600,'profileBase64':base64.b64encode(profile).decode(),'profileDigest':a['sha'](profile),'artifacts':{k:'sha256:'+'a'*64 for k in [a['PARSER'],a['SETPRIV'],a['PYTHON']]}}
assert a['validate'](r)==profile
for patch in [{'expiresAtUnix':0},{'createdAtUnix':time.time()+7200},{'expiresAtUnix':time.time()+90000},{'profileDigest':'sha256:'+'0'*64},{'artifacts':{**r['artifacts'],'/usr/bin/sh':'sha256:'+'a'*64}}]:
 must_fail(lambda: a['validate']({**r,**patch}))
for p in [profile+b'#include <abstractions/base>\\n',profile+profile,profile.replace(b'reliverse-gr-native-review',b'other')]:
 must_fail(lambda: a['validate']({**r,'profileBase64':base64.b64encode(p).decode(),'profileDigest':a['sha'](p)}))
print('rejected')
`,
    ),
  ).toBe("rejected\n");
});
test("result checks require every alias denied, exact enforcement and no content reads", () => {
  expect(
    python(
      load +
        `
names=['direct','dirfd','proc-dirfd','proc-leaffd','proc-root']
r={'label':'fixture (enforce)','metadataVerified':True,'caps':'0x80004','noNewPrivileges':True,'opens':{k:'denied' for k in names},'credentialContentsRead':False}
assert a['check_result'](json.dumps(r),'fixture (enforce)',True)==r
for key,value in [('label','unconfined'),('caps','0x0'),('credentialContentsRead',True),('metadataVerified',False)]:
 try: a['check_result'](json.dumps({**r,key:value}),'fixture (enforce)',True)
 except RuntimeError: pass
 else: raise AssertionError(key)
for name in names:
 x={**r,'opens':{**r['opens'],name:'opened-without-read'}}
 try: a['check_result'](json.dumps(x),'fixture (enforce)',True)
 except RuntimeError: pass
 else: raise AssertionError(name)
print('closed')
`,
    ),
  ).toBe("closed\n");
});
test("producer cannot execute acceptance even with a well-shaped request object", () => {
  expect(
    python(
      load +
        `
a['execute'].__globals__['os'].getuid=lambda:1000
try: a['execute']({},'sha256:'+'a'*64,b'')
except RuntimeError as e: assert str(e)=='PERSONAL_OWNER_ROOT_REQUIRED'
else: raise AssertionError('root refusal missing')
print('refused')
`,
    ),
  ).toBe("refused\n");
});
test("fixture lifecycle is create-only, unloads only on success and retains uncertain loads without replay", () => {
  expect(
    python(
      load +
        `
from types import SimpleNamespace
import os
for uncertain in [False,True]:
 g=runpy.run_path(sys.argv[1]); glob=g['execute'].__globals__
 dirs=set(); files={}; loaded=[]; commands=[]
 digest='sha256:'+'a'*64
 name='gr-native-review-acceptance-'+digest[7:]
 def mkdir(p,mode=0o700,dir_fd=None):
  p=os.path.join(dir_fd,p) if dir_fd else p
  if p in dirs: raise FileExistsError(p)
  dirs.add(p)
 def write(p,b):
  if p in files: raise FileExistsError(p)
  files[p]=b
 def result(label,denied):
  return json.dumps({'label':label,'metadataVerified':True,'caps':'0x80004','noNewPrivileges':True,'opens':{k:'denied' if denied else 'opened-without-read' for k in ['direct','dirfd','proc-dirfd','proc-leaffd','proc-root']},'credentialContentsRead':False}).encode()
 def run(argv,state):
  commands.append(argv)
  if argv[0]==g['PARSER']:
   if '--add' in argv:
    loaded.append(name+' (enforce)')
    if uncertain: raise TimeoutError('fixture unknown parser result')
   else:
    assert '--remove' in argv
    loaded.clear()
   return b''
  confined=any(x.startswith('--apparmor-profile=') for x in argv)
  return result(name+' (enforce)' if confined else 'unconfined',confined)
 glob.update(os=SimpleNamespace(getuid=lambda:0,geteuid=lambda:0,getgid=lambda:0,getegid=lambda:0,path=os.path,mkdir=mkdir,fsync=lambda fd:None,close=lambda fd:None,chown=lambda *a,**k:None,lstat=lambda p:SimpleNamespace(st_dev=1,st_ino=2,st_ctime_ns=3),unlink=lambda p:files.pop(p),rmdir=lambda p:dirs.remove(p)),directory=lambda p,create=False:p,write=write,record=lambda p,v:write(p,json.dumps(v).encode()),read=lambda *a,**k:b'',validate=lambda r:None,profiles=lambda:loaded.copy(),run=run)
 original=b'profile reliverse-gr-native-review {\\n file,\\n}\\n'
 state=g['STATE']+'/'+digest[7:]
 if uncertain:
  try:g['execute']({},digest,original)
  except TimeoutError:pass
  else:raise AssertionError('unknown load accepted')
  assert loaded and state+'/held.json' in files and state+'/completed.json' not in files
  assert not any('--remove' in c for c in commands)
 else:
  r=g['execute']({},digest,original)
  assert r['outcome']=='completed' and r['testProfileUnloaded'] and not loaded
  assert state+'/completed.json' in files and state+'/held.json' not in files
  assert not any(p.startswith(g['ACTORS']+'/') for p in dirs)
 previous=len(commands)
 try:g['execute']({},digest,original)
 except (RuntimeError,FileExistsError):pass
 else:raise AssertionError('replay accepted')
 assert len(commands)==previous
print('one-shot')
`,
    ),
  ).toBe("one-shot\n");
});

test("captured input refuses symlinks, writable metadata and digest changes", () => {
  expect(
    python(
      load +
        `
import tempfile,os,pathlib
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d)/'input'; p.write_bytes(b'{}'); p.chmod(0o600)
 assert a['read'](str(p),100,a['sha'](b'{}'),owner=os.getuid())==b'{}'
 link=pathlib.Path(d)/'link'; link.symlink_to(p)
 for name,digest in [(str(link),None),(str(p),'sha256:'+'0'*64)]:
  try: a['read'](name,100,digest,owner=os.getuid())
  except (RuntimeError,OSError): pass
  else: raise AssertionError('unsafe input')
 p.chmod(0o666)
 try: a['read'](str(p),100,owner=os.getuid())
 except RuntimeError: pass
 else: raise AssertionError('writable input')
print('pinned')
`,
    ),
  ).toBe("pinned\n");
});

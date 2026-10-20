import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function python(code: string) {
  const root = await mkdtemp(path.join(tmpdir(), "gr-publication-admission-"));
  try {
    const r = Bun.spawnSync(
      [
        "/usr/bin/python3",
        "-I",
        "-S",
        "-c",
        "import runpy,os,sys,json,hashlib,base64,time,stat; ns=runpy.run_path(sys.argv[1]); root=sys.argv[2]\n" +
          code,
        new URL("./owner-publication-bootstrap.py", import.meta.url).pathname,
        root,
      ],
      { timeout: 15000 },
    );
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("fixture passed");
  } finally {
    // Failed assertions may leave fixture-only public receipt directories sealed.
    Bun.spawnSync([
      "/usr/bin/python3",
      "-I",
      "-S",
      "-c",
      "import os,sys\nfor p,_,_ in os.walk(sys.argv[1],followlinks=False):\n if not os.path.islink(p):os.chmod(p,0o700)",
      root,
    ]);
    await rm(root, { recursive: true, force: true });
  }
}
const model = `
a=runpy.run_path(ns['AUTH_SOURCE']); corpus=runpy.run_path(ns['CORPUS_SOURCE'])
ns['SCOPE']=['apps/cli/gr','bun.lock','docs/specs/gr','extensions/plugins/rq/repo','package.json','packages/gr-action-runtime','packages/gr-core','packages/quality']
ns.update(ROOT=root+'/publication/repo',EXECUTABLE=root+'/bin/owner-launch',POLICY=root+'/etc/policy.json',CLAIMS=root+'/claims',READBACK=root+'/public',LAUNCH_POLICY=root+'/launch-policy.json',source_root=lambda:root+'/producer-repo')
for fn in ['prepare','install','native_prepare']:ns[fn].__globals__.update(ns)
h=ns['sha'];payload=b'{"name":"fixture"}\\n';blob=hashlib.sha1(b'blob '+str(len(payload)).encode()+b'\\0'+payload).hexdigest()
files=[{'path':p if p in ['package.json','bun.lock'] else p+'/fixture.txt','gitBlob':blob,'sha256':h(payload),'bytes':len(payload),'executable':False} for p in ns['SCOPE']]
tree={}
for f in files:
 node=tree
 parts=f['path'].split('/')
 for part in parts[:-1]:node=node.setdefault(part,{})
 node[parts[-1]]=blob
nodes=[]
def build(node):
 entries=[{'mode':'40000' if isinstance(v,dict) else '100644','name':k,'oid':build(v) if isinstance(v,dict) else v} for k,v in sorted(node.items())]
 raw=b''.join((e['mode']+' '+e['name']+'\\0').encode()+bytes.fromhex(e['oid']) for e in entries)
 oid=hashlib.sha1(b'tree '+str(len(raw)).encode()+b'\\0'+raw).hexdigest()
 if not any(n['oid']==oid for n in nodes):nodes.append({'oid':oid,'entries':entries})
 return oid
candidate=build(tree)
manifest={'schema':'rvs.campaign-review-corpus.v0','campaignFingerprint':'e'*64,'candidateTree':candidate,'scope':ns['SCOPE'],'files':files}
proof={'schema':'gr.campaign-review-tree-proof.v0','candidateTree':candidate,'trees':nodes}
packet={'schema':'rvs.reviewer-corpus.install-packet.v0','manifest':manifest,'contents':{f['path']:base64.b64encode(payload).decode() for f in files},'context':'fixture','treeProof':proof}
now=time.time();begin=__import__('datetime').datetime.fromtimestamp(now-1,__import__('datetime').timezone.utc).isoformat();end=__import__('datetime').datetime.fromtimestamp(now+3600,__import__('datetime').timezone.utc).isoformat()
exe=b'\\x7fELFFIXTURE';config=b'fixture config';basebytes=b'fixture-base-not-executed'
p={'schema':'gr.owner-publication.host.v0','createdAt':begin,'expiresAt':end,'custody':{'root':ns['ROOT'],'launcherExecutable':ns['EXECUTABLE'],'ownerUid':995,'ownerGid':985,'producerUid':1000,'reviewerUid':994,'remoteUrl':'git@github.com:reliverse/reliverse.git','gitConfigDigest':h(config),'gitExecutable':'/usr/bin/git','sshExecutable':'/usr/bin/ssh','artifacts':[{'path':ns['EXECUTABLE'],'digest':h(exe)},{'path':'/usr/bin/git','digest':h(b'git')},{'path':'/usr/bin/ssh','digest':h(b'ssh')}]},'links':[],'authPolicyDigest':h(b'{}'),'baseCommit':'a'*40,'baseTree':'b'*40,'baseBundleDigest':h(basebytes),'expectedCandidateTree':candidate,'ownerAuth':{'sessionId':'fixture-session'}}
_,evidence,md=corpus['prepare_corpus_packet'](json.dumps(packet).encode())
p['sourceManifestDigest']=md;p['sourceTreeProofDigest']=h(next(b for name,b,mode in evidence if name=='tree-proof.json'))
b={'schema':'gr.campaign-public-base.v0','baseCommit':p['baseCommit'],'baseTree':p['baseTree'],'digest':h(basebytes),'bytes':len(basebytes),'contentBase64':base64.b64encode(basebytes).decode()}
p['campaign']={'id':'fixture-publication','paths':ns['SCOPE'],'commits':[{'id':'fixture-first','title':'fixture first','paths':ns['SCOPE'][:1]},{'id':'fixture-second','title':'fixture second','paths':ns['SCOPE'][1:]}]}
inputs={'executable':exe,'policy':json.dumps(p).encode(),'corpus':json.dumps(packet).encode(),'base':json.dumps(b).encode(),'gitConfig':config};virtual={}
r={'schema':'gr.owner-publication.install-request.v0','createdAt':begin,'expiresAt':end,'sourceModules':dict(ns['TRUSTED_SOURCE_MODULES']),'bootstrapArtifacts':{os.path.realpath(sys.executable):h(b'os'),'/usr/bin/setpriv':h(b'setpriv')}}
for k,data in inputs.items():
 name=ns['source_root']()+'/temp/gr-campaign002-reviewer/fixture/'+k;virtual[name]=data;r[k]={'source':name,'digest':h(data)}
def directory(p,create=False):
 if create:os.makedirs(p,exist_ok=True)
 return os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
a['write'].__globals__['directory']=directory
rawread=a['read']
def read(p,owner,limit,digest=None,protected=False):
 if p in virtual:
  data=virtual[p]
  assert len(data)<=limit and (digest is None or h(data)==digest)
  return data
 if p.startswith(root+'/'):return rawread(p,os.getuid(),limit,digest)
 return b'{}'
a.update(directory=directory,read=read)
os.chown=lambda *a,**k:None;os.fchown=lambda *a,**k:None
# Fixture target replaces native-only fixed path; production still requires /usr.
ns['prepare'].__globals__['re']=__import__('types').SimpleNamespace(fullmatch=lambda pattern,value: True if value==ns['EXECUTABLE'] else __import__('re').fullmatch(pattern,value))
result={'schema':'gr.campaign-publication-preparation.v0','outcome':'completed','authorityGranted':False,'commitPerformed':False,'pushPerformed':False,'plan':{'repository':{'root':ns['ROOT']},'campaignId':'fixture-publication','scope':{'paths':ns['SCOPE'],'commits':p['campaign']['commits']},'policy':{},'base':{'commit':{'oid':p['baseCommit']}},'frozen':{'candidateTree':{'oid':candidate},'steps':[{'commitId':'fixture-first','beforeTree':p['baseTree'],'afterTree':'c'*40},{'commitId':'fixture-second','beforeTree':'c'*40,'afterTree':candidate}]},'campaignFingerprint':'f'*64},'manifest':{**manifest,'campaignFingerprint':'f'*64},'treeProof':proof}
ns['install'].__globals__['native_prepare']=lambda auth:result
`;

test("native publication installer is create-only, source-scoped and emits only preparation receipt", () =>
  python(
    model +
      `
value=ns['install'](r,'sha256:'+'a'*64,a,corpus)
assert value['outcome']=='completed' and value['preparationGitExecuted'] and not value['commitPerformed'] and not value['pushPerformed'] and not value['publicationExecutionAdmitted']
assert open(ns['ROOT']+'/.git/HEAD','rb').read()==b'ref: refs/heads/main\\n'
for f in files:assert open(ns['ROOT']+'/'+f['path'],'rb').read()==payload
assert not os.path.exists(ns['ROOT']+'/.private')
assert json.load(open(value['prepared']))['plan']['repository']['root']==ns['ROOT']
before=open(ns['EXECUTABLE'],'rb').read()
try:ns['install'](r,'sha256:'+'b'*64,a,corpus);raise AssertionError('re-adoption accepted')
except RuntimeError as e:assert str(e)=='EXISTING_TARGET_NO_REPLAY'
assert open(ns['EXECUTABLE'],'rb').read()==before
os.chmod(os.path.dirname(value['prepared']),0o700)
print('fixture passed')
`,
  ));
test("native failure retains private workspace and unknown admission without public completion or rollback", () =>
  python(
    model +
      `
def fail(auth):raise RuntimeError('fixture native failure')
ns['install'].__globals__['native_prepare']=fail
try:ns['install'](r,'sha256:'+'a'*64,a,corpus);raise AssertionError('failed native accepted')
except RuntimeError as e:assert str(e)=='fixture native failure'
claim=ns['CLAIMS']+'/'+'a'*64
assert os.path.exists(ns['ROOT']) and os.path.exists(claim+'/reservation.json') and not os.path.exists(claim+'/completed.json')
assert not os.path.exists(ns['READBACK']+'/'+'a'*64)
try:ns['install'](r,'sha256:'+'b'*64,a,corpus);raise AssertionError('partial re-adoption accepted')
except RuntimeError:pass
print('fixture passed')
`,
  ));
const successorModel =
  model +
  `
old=ns['install'](r,'sha256:'+'a'*64,a,corpus)
old_root=ns['ROOT'];new_root=old_root+'-'+candidate
old_completion=open(ns['READBACK']+'/'+'a'*64+'/completed.json','rb').read()
old_prepared=open(old['prepared'],'rb').read();old_exe=open(ns['EXECUTABLE'],'rb').read();old_policy=open(ns['POLICY'],'rb').read()
r['expectedInstallation']={k:old[k] for k in ['requestDigest','executableDigest','policyDigest','preparedDigest']}
p['custody']['root']=new_root
new_exe=b'\\x7fELFNEW-PUBLICATION-FIXTURE'
virtual[r['executable']['source']]=new_exe;r['executable']['digest']=h(new_exe);p['custody']['artifacts'][0]['digest']=h(new_exe)
virtual[r['policy']['source']]=json.dumps(p).encode();r['policy']['digest']=h(virtual[r['policy']['source']])
result['plan']['repository']['root']=new_root
`;
test("successor exact-old CAS preserves the old replica and receipts and prepares a new root", () =>
  python(
    successorModel +
      `
value=ns['install'](r,'sha256:'+'b'*64,a,corpus)
assert value['root']==new_root and value['previousRequestDigest']==old['requestDigest']
assert open(old['prepared'],'rb').read()==old_prepared and open(ns['READBACK']+'/'+'a'*64+'/completed.json','rb').read()==old_completion
for f in files:assert open(old_root+'/'+f['path'],'rb').read()==payload and open(new_root+'/'+f['path'],'rb').read()==payload
claim=ns['CLAIMS']+'/'+'b'*64
assert open(claim+'/previous-executable','rb').read()==old_exe and open(claim+'/previous-policy.json','rb').read()==old_policy
assert open(ns['EXECUTABLE'],'rb').read()==new_exe and not os.path.exists(ns['CLAIMS']+'/.transition')
for d in ['a','b']:os.chmod(ns['READBACK']+'/'+d*64,0o700)
print('fixture passed')
`,
  ));
const completedExecutionModel =
  successorModel +
  `
fixture_paths=dict(GATEHOUSE=root+'/gatehouse',NATIVE_REVIEW=root+'/native-review',SIGNING_POLICY=root+'/etc/signing.json',BRIDGE_POLICY=root+'/etc/bridge.json',STAGED_OWNER=(os.getuid(),os.getgid()))
ns.update(fixture_paths);ns['completed_execution'].__globals__.update(fixture_paths)
old['baseCommit']='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
fp=lambda v:h(json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())
reviewer='prn_fixture_reviewer'
plan=json.loads(old_prepared)['plan']
plan['base']['commit']['oid']=old['baseCommit']
completed_steps=[{'gateId':'gate_'+'1'*32,'commitId':'fixture-first','beforeCommit':'a'*40,'afterCommit':'1'*40,'resultDigest':'sha256:'+'1'*64},{'gateId':'gate_'+'2'*32,'commitId':'fixture-second','beforeCommit':'1'*40,'afterCommit':'2'*40,'resultDigest':'sha256:'+'2'*64}]
intents={};expected={'gates':{},'native':{},'steps':completed_steps};gate_files={};native_files={}
for index,step in enumerate(completed_steps):
 gid,oid,result_digest=step['gateId'],step['afterCommit'],step['resultDigest']
 intent={'id':'intent-'+gid,'digest':'sha256:'+str(index+1)*64,'target':{'parameters':{'action':{'kind':'commit','commitId':step['commitId'],'expectedBeforeCommit':step['beforeCommit']},'campaignFingerprint':old['campaignFingerprint'],'root':old_root,'candidateTree':{'oid':old['candidateTree']}}}}
 intents[gid]=intent
 endorsements=[{'id':'endorsement-owner','principalId':'prn_fixture_owner','decision':'approve'},{'id':'endorsement-reviewer','principalId':reviewer,'decision':'approve'}]
 execution={'outcome':'completed','gateId':gid,'intentDigest':intent['digest'],'resultDigest':result_digest,'leaseId':'lease','consumptionId':'consumption','attemptId':'attempt'}
 records={'gate.json':{'id':gid,'status':'completed','intentDigest':intent['digest']},'intent.json':intent,'execution.json':execution,'lease.json':{'status':'consumed','id':'lease'},'consumption.json':{'id':'consumption','attemptId':'attempt'},'approval.json':{'fixture':True}}
 for e in endorsements:
  records['endorsements/'+e['id']+'.json']=e
  records['decisions/'+e['id']+'.json']={'id':'decision-'+e['id'],'endorsementId':e['id'],'accepted':True}
 gate_dir=ns['GATEHOUSE']+'/'+old['campaignFingerprint']+'/gates/'+gid
 for name,v in records.items():
  os.makedirs(os.path.dirname(gate_dir+'/'+name),mode=0o700,exist_ok=True);a['write'](gate_dir+'/'+name,json.dumps(v).encode(),0o600)
 gate_files[gid]={k:json.dumps(v).encode() for k,v in records.items()}
 expected['gates'][gid]={k:h(v) for k,v in gate_files[gid].items()}
 done={'outcome':'completed','gateId':gid,'intentDigest':intent['digest'],'endorsementDigest':fp(endorsements[1]),'reviewer':{'uid':994,'gid':984},'nonce':'native-'+gid}
 native={'completed.json':done,'reservation.json':{'nonce':done['nonce']},'sealed.json':{'nonce':done['nonce'],'completionDigest':fp(done)}}
 journal=ns['NATIVE_REVIEW']+'/'+gid
 os.makedirs(journal,mode=0o700)
 for name,v in native.items():a['write'](journal+'/'+name,json.dumps(v).encode(),0o600)
 native_files[gid]={k:json.dumps(v).encode() for k,v in native.items()}
 expected['native'][gid]={k:h(v) for k,v in native_files[gid].items()}
signing={'intent':intents['gate_22222222222222222222222222222222'],'bindings':{'plan':plan,'review':{'reviewerPrincipalId':reviewer},'action':{'kind':'commit','commitId':'fixture-second','expectedBeforeCommit':'1111111111111111111111111111111111111111'}}}
bridge={'signing':signing,'signingPolicyFileDigest':h(json.dumps(signing).encode())}
launch={'custody':{'root':old_root},'signingPolicyDigest':fp(signing),'bridgePolicyDigest':h(json.dumps(bridge).encode())}
gid='gate_22222222222222222222222222222222';journal=ns['NATIVE_REVIEW']+'/'+gid
done=json.loads(native_files[gid]['completed.json']);done['signingPolicyDigest']=fp(signing)
seal=json.loads(native_files[gid]['sealed.json']);seal['completionDigest']=fp(done)
for name,v in [('completed.json',done),('sealed.json',seal)]:
 os.unlink(journal+'/'+name);a['write'](journal+'/'+name,json.dumps(v).encode(),0o600);native_files[gid][name]=json.dumps(v).encode();expected['native'][gid][name]=h(json.dumps(v).encode())
for field,file,value in [('launchPolicyDigest',ns['LAUNCH_POLICY'],launch),('signingPolicyDigest',ns['SIGNING_POLICY'],signing),('bridgePolicyDigest',ns['BRIDGE_POLICY'],bridge)]:
 a['write'](file,json.dumps(value).encode(),0o644);expected[field]=h(json.dumps(value).encode())
a['write'](old_root+'/.git/refs/heads/main',b'2222222222222222222222222222222222222222\\n',0o600)
for directory_name,_,_ in os.walk(ns['GATEHOUSE']):os.chmod(directory_name,0o700)
p['retainedPrefix']={'commitId':'fixture-first','commit':'1'*40,'tree':'c'*40,'title':'fixture first','contentBase64':''}
virtual[r['policy']['source']]=json.dumps(p).encode();r['policy']['digest']=h(virtual[r['policy']['source']])
r['expectedCompletedExecution']=expected
`;
test("completed predecessor readback preserves exact primary/native records with endorsement-keyed decisions", () =>
  python(
    completedExecutionModel +
      `
ns['validate_request'](r)
before=ns['completed_execution'](r,a,old)
assert before==ns['completed_execution'](r,a,old) and len(before)>20
assert not os.path.exists(old_root+'/.git/refs/heads/successor')
assert open(ns['EXECUTABLE'],'rb').read()==old_exe
os.chmod(os.path.dirname(old['prepared']),0o700)
print('fixture passed')
`,
  ));
for (const mutation of [
  "execution",
  "consumed",
  "head",
  "decision",
  "held",
  "seal",
  "policy",
  "namespace",
  "order",
  "parent",
  "retained",
  "intent-action",
] as const)
  test(`completed successor refuses changed ${mutation} without mutations`, () =>
    python(
      completedExecutionModel +
        `
gid='gate_22222222222222222222222222222222';gd=ns['GATEHOUSE']+'/'+old['campaignFingerprint']+'/gates/'+gid;journal=ns['NATIVE_REVIEW']+'/'+gid
mutation=${JSON.stringify(mutation)}
def replace(file,value):
 os.unlink(file);a['write'](file,json.dumps(value).encode(),0o600)
if mutation=='execution':
 v=json.loads(gate_files[gid]['execution.json']);v['resultDigest']='sha256:'+'0'*64;replace(gd+'/execution.json',v);expected['gates'][gid]['execution.json']=h(json.dumps(v).encode())
if mutation=='consumed':
 v={'id':'lease','status':'active'};replace(gd+'/lease.json',v);expected['gates'][gid]['lease.json']=h(json.dumps(v).encode())
if mutation=='head':
 os.unlink(old_root+'/.git/refs/heads/main');a['write'](old_root+'/.git/refs/heads/main',b'wrong\\n',0o600)
if mutation=='decision':
 name='decisions/endorsement-reviewer.json';v=json.loads(gate_files[gid][name]);v['endorsementId']='foreign';replace(gd+'/'+name,v);expected['gates'][gid][name]=h(json.dumps(v).encode())
if mutation=='held':a['write'](journal+'/held.json',b'{}',0o600)
if mutation=='seal':
 v=json.loads(native_files[gid]['sealed.json']);v['completionDigest']='bad';replace(journal+'/sealed.json',v);expected['native'][gid]['sealed.json']=h(json.dumps(v).encode())
if mutation=='policy':expected['signingPolicyDigest']='sha256:'+'0'*64
if mutation=='namespace':a['write'](gd+'/.lock',b'{}',0o600)
if mutation=='order':expected['steps'].reverse()
if mutation=='parent':expected['steps'][1]['beforeCommit']='f'*40
if mutation=='retained':
 changed=json.loads(virtual[r['policy']['source']]);changed['retainedPrefix']['tree']='f'*40;virtual[r['policy']['source']]=json.dumps(changed).encode();r['policy']['digest']=h(virtual[r['policy']['source']])
if mutation=='intent-action':
 v=json.loads(gate_files[gid]['intent.json']);v['target']['parameters']['action']['commitId']='foreign';replace(gd+'/intent.json',v);expected['gates'][gid]['intent.json']=h(json.dumps(v).encode())
try:ns['completed_execution'](r,a,old);raise AssertionError('changed completed history accepted')
except RuntimeError:pass
assert open(ns['EXECUTABLE'],'rb').read()==old_exe
assert not os.path.exists(new_root)
os.chmod(os.path.dirname(old['prepared']),0o700)
print('fixture passed')
`,
    ));
test("completed successor request requires separate mode-shaped expectations, not expired/unused or held authority", () =>
  python(
    completedExecutionModel +
      `
for field in ['expectedExpiredExecution','expectedUnusedExecution','heldPreparation']:
 changed={**r,field:{}}
 try:ns['validate_request'](changed);raise AssertionError('mixed successor authority accepted')
 except RuntimeError:pass
try:ns['validate_request'](r,historical=True);raise AssertionError('completed request adopted as history')
except RuntimeError:pass
os.chmod(os.path.dirname(old['prepared']),0o700)
print('fixture passed')
`,
  ));

test("campaign metadata is mandatory and cannot expand corpus scope or substitute prepared commit specs", () =>
  python(
    model +
      `
original=json.loads(virtual[r['policy']['source']])
for mutation in ['missing','paths','commit-paths','duplicate','publication']:
 changed=json.loads(json.dumps(original))
 if mutation=='missing':changed.pop('campaign')
 if mutation=='paths':changed['campaign']['paths']=['../escape']
 if mutation=='commit-paths':changed['campaign']['commits'][0]['paths']=['outside']
 if mutation=='duplicate':changed['campaign']['commits'][1]['id']=changed['campaign']['commits'][0]['id']
 if mutation=='publication':changed['campaign']['publication']={'mode':'source-only','installability':'claimed','exceptionRef':'fixture'}
 virtual[r['policy']['source']]=json.dumps(changed).encode();r['policy']['digest']=h(virtual[r['policy']['source']])
 try:ns['prepare'](r,a,corpus);raise AssertionError('invalid policy metadata accepted')
 except RuntimeError:pass
 assert not os.path.exists(ns['ROOT'])
virtual[r['policy']['source']]=json.dumps(original).encode();r['policy']['digest']=h(virtual[r['policy']['source']])
result['plan']['scope']['commits']=[{'id':'foreign','title':'foreign','paths':ns['SCOPE']}]
try:ns['install'](r,'sha256:'+'a'*64,a,corpus);raise AssertionError('native result substituted specs')
except RuntimeError as e:assert str(e)=='PREPARATION_BINDING_INVALID'
assert not os.path.exists(ns['READBACK']+'/'+'a'*64)
print('fixture passed')
`,
  ));

const expiredExecutionModel =
  successorModel +
  `
fixture_paths=dict(GATEHOUSE=root+'/gatehouse',NATIVE_REVIEW=root+'/native-review',SIGNING_POLICY=root+'/etc/signing.json',BRIDGE_POLICY=root+'/etc/bridge.json',STAGED_OWNER=(os.getuid(),os.getgid()))
ns.update(fixture_paths);ns['install'].__globals__.update(fixture_paths)
fp=lambda value:h(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())
intent={'id':'fixture-intent','digest':'sha256:'+'d'*64,'expiresAt':'2020-01-01T00:00:00Z','target':{'parameters':{'action':{'kind':'commit','commitId':'fixture-first','expectedBeforeCommit':old['baseCommit']},'campaignFingerprint':old['campaignFingerprint'],'root':old_root,'candidateTree':{'oid':old['candidateTree']}}}}
gate_id='gate_'+fp(intent['id'])[7:39]
signing={'schema':'gr.campaign-reviewer-signing-policy.v0','intent':intent,'bindings':{'plan':json.loads(old_prepared)['plan'],'action':intent['target']['parameters']['action']}}
bridge={'schema':'gr.native-review.host.v0','signing':signing,'signingPolicyFileDigest':h(json.dumps(signing).encode()),'expiresAt':intent['expiresAt']}
launch={'schema':'gr.owner-launch.host.v0','custody':{'root':old_root},'expiresAt':intent['expiresAt'],'signingPolicyDigest':fp(signing),'bridgePolicyDigest':h(json.dumps(bridge).encode())}
for file,value in [(ns['LAUNCH_POLICY'],launch),(ns['SIGNING_POLICY'],signing),(ns['BRIDGE_POLICY'],bridge)]:a['write'](file,json.dumps(value).encode(),0o644)
gate_dir=ns['GATEHOUSE']+'/'+old['campaignFingerprint']+'/gates/'+gate_id
os.makedirs(gate_dir,mode=0o700)
for parent in [gate_dir,os.path.dirname(gate_dir),os.path.dirname(os.path.dirname(gate_dir))]:os.chmod(parent,0o700)
gate={'schemaVersion':'gatehouse.gate.v0','id':gate_id,'intentDigest':intent['digest'],'expiresAt':intent['expiresAt'],'status':'pending','endorsementIds':[]}
for name,value in [('gate',gate),('intent',intent)]:a['write'](gate_dir+'/'+name+'.json',json.dumps(value).encode(),0o600)
a['write'](old_root+'/.git/refs/heads/main',(old['baseCommit']+'\\n').encode(),0o600)
journal=ns['NATIVE_REVIEW']+'/'+gate_id;os.makedirs(journal,mode=0o700)
completed={'schema':'gr.native-review-attempt.v0','outcome':'completed','gateId':gate_id,'intentDigest':intent['digest'],'signingPolicyDigest':fp(signing),'nonce':'fixture-review'}
seal={'schema':'gr.native-review-seal.v0','nonce':completed['nonce'],'completionDigest':fp(completed)}
for name,value in [('completed',completed),('sealed',seal),('reservation',completed)]:a['write'](journal+'/'+name+'.json',json.dumps(value).encode(),0o600)
r['expectedExpiredExecution']={'launchPolicyDigest':h(json.dumps(launch).encode()),'signingPolicyDigest':h(json.dumps(signing).encode()),'bridgePolicyDigest':h(json.dumps(bridge).encode()),'gateDigest':h(json.dumps(gate).encode()),'nativeCompletionDigest':h(json.dumps(completed).encode()),'nativeSealDigest':h(json.dumps(seal).encode())}
`;

const unusedExecutionModel =
  expiredExecutionModel +
  `
# Orchestration fixture only. Native Gatehouse API/CAS is exercised by owner-launch.test.ts.
r['expectedUnusedExecution']=r.pop('expectedExpiredExecution')
r['expectedUnusedExecution']['reason']='fixture approved-unused disposition'
intent['expiresAt']=end
bridge['expiresAt']=end;launch['expiresAt']=end
signing['bindings']['review']={'ownerPrincipalId':'prn_'+'a'*32,'reviewerPrincipalId':'prn_'+'b'*32}
bridge['signingPolicyFileDigest']=h(json.dumps(signing).encode());launch['signingPolicyDigest']=fp(signing);launch['bridgePolicyDigest']=h(json.dumps(bridge).encode())
for name,file,value in [('launchPolicyDigest',ns['LAUNCH_POLICY'],launch),('signingPolicyDigest',ns['SIGNING_POLICY'],signing),('bridgePolicyDigest',ns['BRIDGE_POLICY'],bridge)]:
 os.unlink(file);a['write'](file,json.dumps(value).encode(),0o644);r['expectedUnusedExecution'][name]=h(json.dumps(value).encode())
completed['signingPolicyDigest']=fp(signing);seal['completionDigest']=fp(completed)
for name,value in [('completed',completed),('sealed',seal),('reservation',completed)]:
 file=journal+'/'+name+'.json';os.unlink(file);a['write'](file,json.dumps(value).encode(),0o600)
r['expectedUnusedExecution']['nativeCompletionDigest']=h(json.dumps(completed).encode());r['expectedUnusedExecution']['nativeSealDigest']=h(json.dumps(seal).encode())
gate.update(status='quorum-satisfied',endorsementIds=['endorsement-owner','endorsement-reviewer'],expiresAt=end)
for name,value in [('gate',gate),('intent',intent)]:
 file=gate_dir+'/'+name+'.json';os.unlink(file);a['write'](file,json.dumps(value).encode(),0o600)
a['write'](gate_dir+'/approval.json',b'{"status":"quorum-satisfied"}',0o600)
for name in ['endorsements','decisions']:
 os.mkdir(gate_dir+'/'+name,0o700)
 for who in ['owner','reviewer']:a['write'](gate_dir+'/'+name+'/'+who+'.json',json.dumps({'id':who}).encode(),0o600)
original={}
for parent,_,names in os.walk(gate_dir):
 for name in names:original[os.path.relpath(parent+'/'+name,gate_dir)]=open(parent+'/'+name,'rb').read()
r['expectedUnusedExecution']['gateDigest']=h(original['gate.json'])
r['expectedUnusedExecution']['gateInventoryDigest']=fp({name:h(data) for name,data in original.items()})
p['retireUnusedExecution']=r['expectedUnusedExecution'];virtual[r['policy']['source']]=json.dumps(p).encode();r['policy']['digest']=h(virtual[r['policy']['source']])
revocation={'schemaVersion':'gatehouse.revocation.v0','id':'gatehouse_revocation_fixture','gateId':gate_id,'actor':{'id':'prn_'+'a'*32,'kind':'human'},'reason':'fixture approved-unused disposition','createdAt':begin}
def native_retire(auth):
 os.mkdir(gate_dir+'/revocations',0o700)
 a['write'](gate_dir+'/revocations/'+revocation['id']+'.json',json.dumps(revocation).encode(),0o600)
 gate.update(status='revoked',revocationId=revocation['id'],updatedAt=begin)
 os.unlink(gate_dir+'/gate.json');a['write'](gate_dir+'/gate.json',json.dumps(gate).encode(),0o600)
 result['retirement']={'schema':'gr.campaign-unused-retirement.v0','gateId':gate_id,'intentDigest':intent['digest'],'revocation':revocation,'outcome':'completed','authorityGranted':False,'commitPerformed':False,'pushPerformed':False}
 return result
ns['install'].__globals__['native_prepare']=native_retire
`;

test("explicit approved-unused successor retires without waiting for expiry and preserves old approvals/history", () =>
  python(
    unusedExecutionModel +
      `
value=ns['install'](r,'sha256:'+'b'*64,a,corpus)
assert value['outcome']=='completed' and value['retirement']['outcome']=='completed' and value['previousExecutionPreserved']
assert value['previousUnusedExecution']==r['expectedUnusedExecution'] and 'previousExpiredExecution' not in value
assert json.load(open(gate_dir+'/gate.json'))['status']=='revoked'
for name,data in original.items():
 if name!='gate.json':assert open(gate_dir+'/'+name,'rb').read()==data
 assert open(ns['CLAIMS']+'/'+'b'*64+'/previous-execution-gate-'+name.replace('/','__'),'rb').read()==data
assert open(old_root+'/.git/refs/heads/main','rb').read()==(old['baseCommit']+'\\n').encode()
assert not value['commitPerformed'] and not value['pushPerformed'] and not value['publicationExecutionAdmitted']
try:ns['install'](r,'sha256:'+'c'*64,a,corpus);raise AssertionError('retirement replay accepted')
except RuntimeError:pass
for d in ['a','b']:os.chmod(ns['READBACK']+'/'+d*64,0o700)
print('fixture passed')
`,
  ));

for (const changed of [
  "lease.json",
  "consumption.json",
  "execution.json",
  ".lock",
  "inventory",
  "policy",
  "base",
  "missing-seal",
]) {
  test(`approved-unused successor refuses changed ${changed} before replacement`, () =>
    python(
      unusedExecutionModel +
        `
changed=${JSON.stringify(changed)}
if changed=='.lock':os.mkdir(gate_dir+'/.lock',0o700)
elif changed in ['lease.json','consumption.json','execution.json']:a['write'](gate_dir+'/'+changed,b'{}',0o600)
elif changed=='inventory':
 file=gate_dir+'/endorsements/owner.json';os.unlink(file);a['write'](file,b'{"changed":true}',0o600)
elif changed=='policy':
 file=ns['LAUNCH_POLICY'];os.unlink(file);a['write'](file,b'{}',0o644)
elif changed=='base':
 file=old_root+'/.git/refs/heads/main';os.unlink(file);a['write'](file,b'wrong\\n',0o600)
else:os.unlink(journal+'/sealed.json')
try:ns['install'](r,'sha256:'+'b'*64,a,corpus);raise AssertionError('changed state admitted')
except (RuntimeError,FileNotFoundError):pass
assert open(ns['EXECUTABLE'],'rb').read()==old_exe and not os.path.exists(new_root)
assert not os.path.exists(gate_dir+'/revocations')
os.chmod(ns['READBACK']+'/'+'a'*64,0o700)
print('fixture passed')
`,
    ));
}

test("post-retirement history substitution retains unknown transition with no completion or rollback", () =>
  python(
    unusedExecutionModel +
      `
def corrupt(auth):
 value=native_retire(auth)
 file=gate_dir+'/endorsements/owner.json';os.unlink(file);a['write'](file,b'{"changed":true}',0o600)
 return value
ns['install'].__globals__['native_prepare']=corrupt
try:ns['install'](r,'sha256:'+'b'*64,a,corpus);raise AssertionError('changed history accepted')
except RuntimeError as e:assert str(e)=='UNUSED_RETIREMENT_HISTORY_CHANGED_NO_RETRY'
assert os.path.exists(ns['CLAIMS']+'/.transition') and not os.path.exists(ns['READBACK']+'/'+'b'*64)
assert json.load(open(gate_dir+'/gate.json'))['status']=='revoked' and open(ns['EXECUTABLE'],'rb').read()==new_exe
os.chmod(ns['READBACK']+'/'+'a'*64,0o700)
print('fixture passed')
`,
  ));

test("explicit expired execution successor preserves policies, Gate, sealed review and old replica without inheriting execution authority", () =>
  python(
    expiredExecutionModel +
      `
ns['validate_request'](r)
before=ns['expired_execution'](r,a,old)
implicit={k:v for k,v in r.items() if k!='expectedExpiredExecution'}
try:ns['previous_installation'](implicit,a);raise AssertionError('implicit expired successor accepted')
except RuntimeError as e:assert str(e)=='PUBLICATION_EXECUTION_ALREADY_ADMITTED'
value=ns['install'](r,'sha256:'+'b'*64,a,corpus)
assert value['previousExpiredExecution']==r['expectedExpiredExecution'] and value['previousExecutionPreserved']
assert not any(value[k] for k in ['commitPerformed','pushPerformed','signingGranted','campaignApproved','publicationExecutionAdmitted'])
assert ns['expired_execution'](r,a,old)==before
for name,data in before.items():assert open(ns['CLAIMS']+'/'+'b'*64+'/previous-execution-'+name,'rb').read()==data
assert open(old['prepared'],'rb').read()==old_prepared and open(old_root+'/.git/refs/heads/main','rb').read()==(old['baseCommit']+'\\n').encode()
assert not os.path.exists(ns['CLAIMS']+'/.transition')
print('fixture passed')
`,
  ));

test("expired execution transition refuses active authority, policy drift, effects and uncertain review before new preparation", () =>
  python(
    expiredExecutionModel +
      `
def refused():
 try:ns['previous_installation'](r,a);raise AssertionError('unsafe expired transition accepted')
 except (RuntimeError,OSError):pass
 assert not os.path.exists(new_root)
# Exact file CAS, even if the replacement is also expired.
file=ns['LAUNCH_POLICY'];raw=open(file,'rb').read();open(file,'wb').write(raw+b' ');refused();open(file,'wb').write(raw)
# A fresh launch window cannot masquerade as expired by supplying its new digest.
changed={**launch,'expiresAt':end};open(file,'wb').write(json.dumps(changed).encode());r['expectedExpiredExecution']['launchPolicyDigest']=h(json.dumps(changed).encode());refused()
open(file,'wb').write(raw);r['expectedExpiredExecution']['launchPolicyDigest']=h(raw)
for name in ['.lock','lease.json','consumption.json','execution.json','approval.json','endorsements','decisions','revocations']:
 file=gate_dir+'/'+name;a['write'](file,b'{}',0o600);refused();os.unlink(file)
file=gate_dir+'/gate.json';raw=open(file,'rb').read()
for change in [{'status':'approved'},{'endorsementIds':['old-approval']}]:
 data=json.dumps({**gate,**change}).encode();open(file,'wb').write(data);r['expectedExpiredExecution']['gateDigest']=h(data);refused()
open(file,'wb').write(raw);r['expectedExpiredExecution']['gateDigest']=h(raw)
for name in ['held.json','completion.lock']:
 file=journal+'/'+name;a['write'](file,b'{}',0o600);refused();os.unlink(file)
file=journal+'/sealed.json';raw=open(file,'rb').read();os.unlink(file);refused();a['write'](file,raw,0o600)
file=old_root+'/.git/refs/heads/main';raw=open(file,'rb').read();open(file,'wb').write(b'0'*40+b'\\n');refused();open(file,'wb').write(raw)
ns['previous_installation'](r,a)
print('fixture passed')
`,
  ));

test("expired transition refuses unsafe file metadata, symlinks, transient Gate mutation and changed state at final readback", () =>
  python(
    expiredExecutionModel +
      `
file=gate_dir+'/gate.json';raw=open(file,'rb').read()
def refused():
 try:ns['expired_execution'](r,a,old);raise AssertionError('unsafe Gate read accepted')
 except (RuntimeError,OSError):pass
os.chmod(file,0o644);refused();os.chmod(file,0o600)
os.link(file,file+'.link');refused();os.unlink(file+'.link')
os.unlink(file);os.symlink('/never-follow',file);refused();os.unlink(file);a['write'](file,raw,0o600)
original=ns['expired_owner_read']
def racing(fd,name,digest=None):
 data=original(fd,name,digest)
 if name=='intent.json':
  os.mkdir(gate_dir+'/.lock');os.rmdir(gate_dir+'/.lock')
 return data
ns['install'].__globals__['expired_owner_read']=racing;refused();ns['install'].__globals__['expired_owner_read']=original
def native(auth):
 a['write'](gate_dir+'/execution.json',b'{}',0o600)
 return result
ns['install'].__globals__['native_prepare']=native
try:ns['install'](r,'sha256:'+'b'*64,a,corpus);raise AssertionError('changed Gate completed preparation')
except RuntimeError:pass
assert os.path.exists(ns['CLAIMS']+'/.transition') and os.path.exists(ns['CLAIMS']+'/'+'b'*64+'/reservation.json')
assert not os.path.exists(ns['READBACK']+'/'+'b'*64+'/completed.json')
assert open(ns['LAUNCH_POLICY'],'rb').read()==json.dumps(launch).encode()
print('fixture passed')
`,
  ));

test("expired execution request must explicitly name the completed-successor mode and cannot mix held recovery", () =>
  python(
    expiredExecutionModel +
      `
for change in [{'expectedInstallation':None},{'expectedExpiredExecution':{}},{'heldPreparation':{}}]:
 bad={**r,**change}
 try:ns['validate_request'](bad);raise AssertionError('invalid transition request accepted')
 except (RuntimeError,TypeError):pass
print('fixture passed')
`,
  ));

test("stale successor CAS refuses before replica creation and retains the transition hold", () =>
  python(
    successorModel +
      `
r['expectedInstallation']['executableDigest']='sha256:'+'0'*64
try:ns['install'](r,'sha256:'+'b'*64,a,corpus);raise AssertionError('stale CAS accepted')
except RuntimeError:pass
assert not os.path.exists(new_root) and open(ns['EXECUTABLE'],'rb').read()==old_exe
assert os.path.exists(ns['CLAIMS']+'/.transition') and open(old['prepared'],'rb').read()==old_prepared
os.chmod(os.path.dirname(old['prepared']),0o700)
print('fixture passed')
`,
  ));
test("successor lock spans native execution; failure retains replacement and unknown state without replay", () =>
  python(
    successorModel +
      `
def native(auth):
 try:ns['install'](r,'sha256:'+'c'*64,a,corpus);raise AssertionError('concurrent installer entered')
 except RuntimeError as e:assert str(e)=='PUBLICATION_TRANSITION_HELD_NO_RETRY'
 pid=os.fork()
 if pid==0:
  try:ns['install'](r,'sha256:'+'c'*64,a,corpus);os._exit(1)
  except RuntimeError as e:os._exit(0 if str(e)=='PUBLICATION_TRANSITION_HELD_NO_RETRY' else 1)
 assert os.waitpid(pid,0)[1]==0
 assert open(ns['EXECUTABLE'],'rb').read()==new_exe
 raise RuntimeError('fixture native failure')
ns['install'].__globals__['native_prepare']=native
try:ns['install'](r,'sha256:'+'b'*64,a,corpus);raise AssertionError('native failure accepted')
except RuntimeError as e:assert str(e)=='fixture native failure'
claim=ns['CLAIMS']+'/'+'b'*64
assert os.path.exists(new_root) and os.path.exists(claim+'/reservation.json') and not os.path.exists(claim+'/completed.json')
assert os.path.exists(ns['CLAIMS']+'/.transition') and open(ns['EXECUTABLE'],'rb').read()==new_exe and open(old['prepared'],'rb').read()==old_prepared
try:ns['install_locked'](r,'sha256:'+'d'*64,a,corpus);raise AssertionError('unguarded internal entry accepted')
except RuntimeError as e:assert str(e)=='PUBLICATION_TRANSITION_REQUIRED'
os.chmod(os.path.dirname(old['prepared']),0o700)
print('fixture passed')
`,
  ));
test("native completion cannot publish success after installed byte drift", () =>
  python(
    model +
      `
def native(auth):
 os.chmod(ns['EXECUTABLE'],0o700);open(ns['EXECUTABLE'],'wb').write(b'changed');os.chmod(ns['EXECUTABLE'],0o555)
 return result
ns['install'].__globals__['native_prepare']=native
try:ns['install'](r,'sha256:'+'a'*64,a,corpus);raise AssertionError('drift accepted')
except RuntimeError:pass
assert os.path.exists(ns['CLAIMS']+'/.transition') and not os.path.exists(ns['READBACK']+'/'+'a'*64)
print('fixture passed')
`,
  ));
test("bootstrap publishes traversable read-only child delegation under production umask before releasing the native exec barrier", () =>
  python(
    model +
      `
ns['install'].__globals__['native_prepare']=ns['native_prepare']
os.umask(0o077)
def execute(file,argv,env):
 assert file=='/usr/bin/setpriv' and argv[-2:]==[ns['EXECUTABLE'],'prepare-source']
 delegation=ns['CLAIMS']+'/.transition/child.json'
 value=json.load(open(delegation))
 assert value['childPid']==os.getpid() and value['parentPid']==os.getppid()
 assert value['childStart']==ns['process_start'](os.getpid()) and value['parentStart']==ns['process_start'](os.getppid())
 assert value['policyDigest']==h(open(ns['POLICY'],'rb').read()) and value['root']==ns['ROOT'] and value['candidateTree']==candidate
 s=os.stat(ns['CLAIMS']+'/.transition');assert (value['lockDevice'],value['lockInode'])==(s.st_dev,s.st_ino)
 assert stat.S_IMODE(s.st_mode)==0o755
 assert stat.S_IMODE(os.stat(delegation).st_mode)==0o444 and value['operation']=='prepare-source'
 os.write(1,json.dumps(result).encode());os._exit(0)
os.execve=execute
value=ns['install'](r,'sha256:'+'a'*64,a,corpus)
assert value['outcome']=='completed' and not os.path.exists(ns['CLAIMS']+'/.transition')
os.chmod(os.path.dirname(value['prepared']),0o700)
print('fixture passed')
`,
  ));
test("source scope/tree or expiry mismatch refuses before target creation", () =>
  python(
    model +
      `
for key,value in [('expiresAt','2000-01-01T00:00:00Z')]:
 try:ns['prepare']({**r,key:value},a,corpus);raise AssertionError('bad request accepted')
 except RuntimeError:pass
packet['manifest']['scope']=['.private'];virtual[r['corpus']['source']]=json.dumps(packet).encode();r['corpus']['digest']=h(virtual[r['corpus']['source']])
try:ns['prepare'](r,a,corpus);raise AssertionError('private scope accepted')
except RuntimeError:pass
assert not os.path.exists(ns['ROOT'])
print('fixture passed')
`,
  ));
test("publication bootstrap resolves pinned relative modules only under root-owned host policy", () =>
  python(`
raw_capture=ns['capture'];policy={'schema':'gr.bootstrap-source.v0','sourceRoot':'/srv/operator/repository'}
def read_policy(p,d,limit,owner):
 assert p==ns['SOURCE_POLICY'] and d is None and limit==4096 and owner==0
 return json.dumps(policy).encode()
ns['source_root'].__globals__['capture']=read_policy
os.environ['HOME']='/untrusted';os.environ['RELIVERSE_SOURCE_ROOT']='/untrusted';sys.argv=['/untrusted.py']
assert ns['source_root']()=='/srv/operator/repository'
for value in ['/', 'relative', '/srv/../repository', '/srv//repository', '/srv/repository\\nother', None]:
 policy['sourceRoot']=value
 try:ns['source_root']();raise AssertionError('unsafe root accepted')
 except RuntimeError as e:assert str(e)=='SOURCE_POLICY_INVALID'
ns['source_root'].__globals__['capture']=raw_capture
p=root+'/untrusted-policy.json';open(p,'wb').write(b'{}')
try:raw_capture(p,None,4096,owner=0);raise AssertionError('producer-owned policy accepted')
except RuntimeError:pass
# Relative request keys are descriptions, never library path or digest authority.
ns['libraries'].__globals__['source_root']=lambda:os.getcwd()
a,c=ns['libraries'](dict(ns['TRUSTED_SOURCE_MODULES']))
assert callable(a['source_root']) and callable(c['prepare_corpus_packet'])
print('fixture passed')
`));
test("bootstrap library digests are independently anchored and request overrides never open code", () =>
  python(`
trusted=ns['TRUSTED_SOURCE_MODULES']
assert set(trusted)=={ns['AUTH_SOURCE'],ns['CORPUS_SOURCE']}
for p,d in trusted.items():assert ns['sha'](open(p,'rb').read())==d
calls=[]
def never_capture(*args):calls.append(args);raise AssertionError('request selected executable code')
ns['libraries'].__globals__['capture']=never_capture
for modules in [{**trusted,ns['AUTH_SOURCE']:'sha256:'+'a'*64},{**trusted,ns['CORPUS_SOURCE']:'sha256:'+'b'*64},{'/tmp/arbitrary.py':'sha256:'+'c'*64}]:
 try:ns['libraries'](modules);raise AssertionError('untrusted closure accepted')
 except RuntimeError as e:assert str(e)=='SOURCE_CLOSURE_INVALID'
assert not calls
print('fixture passed')
`));
test("all pinned library bytes are captured before any library is executed", () =>
  python(`
ns['libraries'].__globals__['source_root']=lambda:os.getcwd()
marker=root+'/executed';bad=root+'/substituted.py'
payload=('open('+repr(marker)+',"w").write("executed")').encode()
open(bad,'wb').write(payload)
real_capture=ns['capture'];calls=[]
def capture(p,d,limit=65536):
 calls.append(p)
 if p==os.getcwd()+'/'+ns['AUTH_SOURCE']:return payload
 return real_capture(bad,d,limit)
ns['libraries'].__globals__['capture']=capture
try:ns['libraries'](dict(ns['TRUSTED_SOURCE_MODULES']));raise AssertionError('substituted module accepted')
except RuntimeError as e:assert str(e)=='SOURCE_CHANGED'
assert calls==[os.getcwd()+'/'+ns['AUTH_SOURCE'],os.getcwd()+'/'+ns['CORPUS_SOURCE']] and not os.path.exists(marker)
print('fixture passed')
`));
test("root terminal guards, request schema, expiry and duplicate keys refuse before library loading", () =>
  python(`
os.getuid=lambda:0;os.geteuid=lambda:0;os.isatty=lambda fd:False
calls=[]
def no_capture(*args):calls.append(args);raise AssertionError('read before terminal guard')
ns['main'].__globals__['capture']=no_capture
try:ns['main'](['admit-and-prepare','/never-read','sha256:'+'a'*64]);raise AssertionError('nonterminal accepted')
except RuntimeError as e:assert str(e)=='PERSONAL_OWNER_CLEAN_TERMINAL_REQUIRED'
assert not calls
os.isatty=lambda fd:True;os.environ.clear()
def no_libraries(*args):raise AssertionError('invalid request reached code execution')
ns['main'].__globals__['libraries']=no_libraries
expired={key:None for key in ['schema','createdAt','expiresAt','sourceModules','executable','policy','corpus','base','gitConfig','bootstrapArtifacts']}
expired.update(schema='gr.owner-publication.install-request.v0',createdAt='2000-01-01T00:00:00Z',expiresAt='2000-01-01T01:00:00Z',sourceModules=dict(ns['TRUSTED_SOURCE_MODULES']))
for data in [b'{"schema":"wrong"}', b'{"sourceModules":{},"sourceModules":{}}',json.dumps(expired).encode()]:
 ns['main'].__globals__['capture']=lambda *args:data
 try:ns['main'](['--validate','/fixture','sha256:'+'a'*64]);raise AssertionError('invalid request accepted')
 except RuntimeError as e:assert str(e) in ['REQUEST_INVALID','DUPLICATE_KEY','REQUEST_EXPIRED']
print('fixture passed')
`));
const heldModel =
  successorModel +
  `
failed_request=json.loads(json.dumps(r));failed_digest='sha256:'+'b'*64
boot=open('/proc/sys/kernel/random/boot_id').read().strip()
dead=[]
for _ in range(2):
 pid=os.fork()
 if pid==0:os._exit(0)
 os.waitpid(pid,0);dead.append(pid)
def fail_before_claim(auth):
 lock=ns['CLAIMS']+'/.transition';os.chmod(lock,0o700);s=os.stat(lock)
 child={'schema':'gr.owner-publication.child.v0','operation':'prepare-source','policyDigest':r['policy']['digest'],'root':new_root,'candidateTree':candidate,'bootId':boot,'parentPid':dead[0],'parentStart':'1','childPid':dead[1],'childStart':'2','lockDevice':s.st_dev,'lockInode':s.st_ino}
 a['write'](lock+'/child.json',(json.dumps(child)+'\\n').encode(),0o444)
 raise RuntimeError('fixture pre-GR failure')
ns['install'].__globals__['native_prepare']=fail_before_claim
try:ns['install'](r,failed_digest,a,corpus);raise AssertionError('failure accepted')
except RuntimeError as e:assert str(e)=='fixture pre-GR failure'
failed_claim=ns['CLAIMS']+'/'+failed_digest[7:];lock=ns['CLAIMS']+'/.transition'
original_reservation=open(failed_claim+'/reservation.json','rb').read();original_child=open(lock+'/child.json','rb').read();lock_stat=os.stat(lock)
failed_path=ns['source_root']()+'/temp/gr-campaign002-reviewer/failed-request.json';virtual[failed_path]=json.dumps(failed_request).encode()
failed_digest=h(virtual[failed_path])
# The live fixture claim was allocated with b*64; rename only fixture setup so its
# identity agrees with the checksum of the historical request.
os.rename(failed_claim,ns['CLAIMS']+'/'+failed_digest[7:]);failed_claim=ns['CLAIMS']+'/'+failed_digest[7:]
a['write'].__globals__['directory']=directory
os.unlink(failed_claim+'/reservation.json');a['record'](failed_claim+'/reservation.json',{'requestDigest':failed_digest,'outcome':'outcome-unknown'})
original_reservation=open(failed_claim+'/reservation.json','rb').read()
# A genuinely different source tree, fresh policy/session and distinct inputs.
payload=b'{"name":"successor"}\\n';blob=hashlib.sha1(b'blob '+str(len(payload)).encode()+b'\\0'+payload).hexdigest()
for f in files:f.update(gitBlob=blob,sha256=h(payload),bytes=len(payload))
def replace_blobs(node):
 for k,v in node.items():
  if isinstance(v,dict):replace_blobs(v)
  else:node[k]=blob
replace_blobs(tree);nodes.clear();candidate=build(tree)
manifest.update(candidateTree=candidate,files=files);proof.update(candidateTree=candidate,trees=nodes)
packet.update(manifest=manifest,treeProof=proof,contents={f['path']:base64.b64encode(payload).decode() for f in files})
p['expectedCandidateTree']=candidate;p['custody']['root']=ns['ROOT']+'-'+candidate;p['ownerAuth']['sessionId']='new-fixture-session'
fresh=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat();p['createdAt']=fresh
_,evidence,md=corpus['prepare_corpus_packet'](json.dumps(packet).encode());p['sourceManifestDigest']=md;p['sourceTreeProofDigest']=h(next(b for n,b,m in evidence if n=='tree-proof.json'))
r=json.loads(json.dumps(failed_request));r['createdAt']=fresh
for key,value in {'executable':new_exe,'policy':json.dumps(p).encode(),'corpus':json.dumps(packet).encode(),'base':json.dumps(b).encode(),'gitConfig':config}.items():
 name=ns['source_root']()+'/temp/gr-campaign002-reviewer/recovery/'+key;virtual[name]=value;r[key]={'source':name,'digest':h(value)}
r['heldPreparation']={'request':{'source':failed_path,'digest':failed_digest},'reservationDigest':h(original_reservation),'delegationDigest':h(original_child),'lockDevice':lock_stat.st_dev,'lockInode':lock_stat.st_ino}
ns['held_preparation'].__globals__['STAGED_OWNER']=(os.getuid(),os.getgid())
real_lstat=os.lstat
class RootLock:
 def __init__(self,s):self.s=s;self.st_uid=0
 def __getattr__(self,k):return getattr(self.s,k)
os.lstat=lambda name,*args,**kwargs:RootLock(real_lstat(name,*args,**kwargs)) if name==lock else real_lstat(name,*args,**kwargs)
real_fstat=os.fstat
def fixture_fstat(fd):
 s=real_fstat(fd)
 return RootLock(s) if (s.st_dev,s.st_ino)==(lock_stat.st_dev,lock_stat.st_ino) else s
os.fstat=fixture_fstat
result['plan']['repository']['root']=p['custody']['root'];result['plan']['frozen']['candidateTree']['oid']=candidate
result['manifest']=dict(manifest,campaignFingerprint='f'*64);result['treeProof']=proof
ns['install'].__globals__['native_prepare']=lambda auth:result
`;

test("explicit held successor retains old fence, unknown receipt and replica while preparing only a new tree", () =>
  python(
    heldModel +
      `
value=ns['install_from_held'](r,'sha256:'+'c'*64,a,corpus)
assert value['outcome']=='completed' and value['previousRequestDigest']==failed_digest
assert open(failed_claim+'/reservation.json','rb').read()==original_reservation
assert open(failed_claim+'/reconciliation/previous-transition/child.json','rb').read()==original_child
assert os.path.exists(new_root) and not os.path.exists(new_root+'/.git/gr-publication-preparation')
assert not os.path.exists(lock) and not os.path.exists(failed_claim+'/completed.json')
assert json.load(open(failed_claim+'/reconciliation/completed.json'))['classification']=='pre-gr-preparation'
for d in ['a','c']:os.chmod(ns['READBACK']+'/'+d*64,0o700)
print('fixture passed')
`,
  ));

test("held successor refuses existing Git effects, bytes drift, stale binding and live process without moving fence", () =>
  python(
    heldModel +
      `
import copy
base_request=copy.deepcopy(r)
for kind in ['reservation','delegation','inode','session','source','claim','ref','object','symlink','live']:
 r=copy.deepcopy(base_request);cleanup=lambda:None
 if kind in ['reservation','delegation']:r['heldPreparation'][kind+'Digest']='sha256:'+'0'*64
 elif kind=='inode':r['heldPreparation']['lockInode']+=1
 elif kind=='session':
  policy=json.loads(virtual[r['policy']['source']]);policy['ownerAuth']['sessionId']='fixture-session';previous=virtual[r['policy']['source']];virtual[r['policy']['source']]=json.dumps(policy).encode();r['policy']['digest']=h(virtual[r['policy']['source']]);cleanup=lambda:virtual.__setitem__(r['policy']['source'],previous)
 elif kind in ['claim','ref','object']:
  path=new_root+{'claim':'/.git/gr-publication-preparation','ref':'/.git/refs/heads/main','object':'/.git/objects/pack/extra.pack'}[kind]
  if kind=='claim':os.mkdir(path);cleanup=lambda:os.rmdir(path)
  else:open(path,'wb').write(b'extra');cleanup=lambda:os.unlink(path)
 elif kind=='symlink':
  path=new_root+'/package.json';os.rename(path,path+'.saved');os.symlink(path+'.saved',path)
  def cleanup():os.unlink(path);os.rename(path+'.saved',path)
 elif kind=='source':
  path=new_root+'/package.json';before=open(path,'rb').read();open(path,'wb').write(b'bad')
  def cleanup():open(path,'wb').write(before)
 elif kind=='live':
  child=json.loads(original_child);child['parentPid']=os.getpid();os.chmod(lock+'/child.json',0o600);open(lock+'/child.json','wb').write(json.dumps(child).encode());os.chmod(lock+'/child.json',0o444);r['heldPreparation']['delegationDigest']=h(open(lock+'/child.json','rb').read())
  def cleanup():os.chmod(lock+'/child.json',0o600);open(lock+'/child.json','wb').write(original_child);os.chmod(lock+'/child.json',0o444)
 try:ns['install_from_held'](r,'sha256:'+'c'*64,a,corpus);raise AssertionError('bad held state accepted: '+kind)
 except (RuntimeError,AssertionError,OSError) as e:
  if isinstance(e,AssertionError) and str(e).startswith('bad held state'):raise
 finally:cleanup()
 assert os.path.exists(lock) and not os.path.exists(failed_claim+'/reconciliation')
os.chmod(os.path.dirname(old['prepared']),0o700)
print('fixture passed')
`,
  ));

test("concurrent held reconciliation is create-only and cannot move the prior fence twice", () =>
  python(
    heldModel +
      `
original_check=ns['held_preparation'];entered=False
recovery=failed_claim+'/reconciliation'
def check(request,auth,engine):
 global entered
 value=original_check(request,auth,engine)
 if os.path.isdir(recovery) and not entered:
  entered=True
  try:ns['install_from_held'](request,'sha256:'+'d'*64,auth,engine);raise AssertionError('concurrent reconciliation accepted')
  except FileExistsError:pass
 return value
ns['install_from_held'].__globals__['held_preparation']=check
value=ns['install_from_held'](r,'sha256:'+'c'*64,a,corpus)
assert entered and value['outcome']=='completed'
assert open(recovery+'/previous-transition/child.json','rb').read()==original_child
for d in ['a','c']:os.chmod(ns['READBACK']+'/'+d*64,0o700)
print('fixture passed')
`,
  ));

test("held-successor fence is continuously named across delegation archival and context entry", () =>
  python(
    heldModel +
      `
real_rename=os.rename;contenders=0
original_transition=ns['publication_transition']
def contender():
 global contenders
 s=os.stat(lock);assert (s.st_dev,s.st_ino)==(lock_stat.st_dev,lock_stat.st_ino)
 pid=os.fork()
 if pid==0:
  try:ns['install'](failed_request,'sha256:'+'d'*64,a,corpus);os._exit(1)
  except RuntimeError as e:os._exit(0 if str(e)=='PUBLICATION_TRANSITION_HELD_NO_RETRY' else 2)
 assert os.waitpid(pid,0)[1]==0
 assert not os.path.exists(ns['CLAIMS']+'/'+'d'*64)
 contenders+=1
def rename(source,target,*args,**kwargs):
 if source==lock+'/child.json':
  contender();real_rename(source,target,*args,**kwargs);contender()
 else:real_rename(source,target,*args,**kwargs)
def transition(auth,retained_identity=None):
 if retained_identity is not None:contender()
 return original_transition(auth,retained_identity=retained_identity)
os.rename=rename;ns['install_from_held'].__globals__['publication_transition']=transition
value=ns['install_from_held'](r,'sha256:'+'c'*64,a,corpus)
assert contenders==3 and value['outcome']=='completed' and not os.path.exists(lock)
metadata=json.load(open(failed_claim+'/reconciliation/previous-transition/lock.json'))
assert metadata['device']==lock_stat.st_dev and metadata['inode']==lock_stat.st_ino and metadata['mode']==0o700
assert open(failed_claim+'/reconciliation/previous-transition/child.json','rb').read()==original_child
for d in ['a','c']:os.chmod(ns['READBACK']+'/'+d*64,0o700)
print('fixture passed')
`,
  ));

test("an interruption after delegation archival retains the same fence and cannot create a new installer hold", () =>
  python(
    heldModel +
      `
real_rename=os.rename
def interrupt(source,target,*args,**kwargs):
 real_rename(source,target,*args,**kwargs)
 if source==lock+'/child.json':raise RuntimeError('fixture interrupted after archival')
os.rename=interrupt
try:ns['install_from_held'](r,'sha256:'+'c'*64,a,corpus);raise AssertionError('interruption accepted')
except RuntimeError as e:assert str(e)=='fixture interrupted after archival'
s=os.stat(lock);assert (s.st_dev,s.st_ino)==(lock_stat.st_dev,lock_stat.st_ino)
assert open(failed_claim+'/reconciliation/previous-transition/child.json','rb').read()==original_child
assert open(failed_claim+'/reservation.json','rb').read()==original_reservation
assert not os.path.exists(p['custody']['root']) and not os.path.exists(ns['CLAIMS']+'/'+'c'*64)
try:ns['install'](failed_request,'sha256:'+'d'*64,a,corpus);raise AssertionError('installer stole fence')
except RuntimeError as e:assert str(e)=='PUBLICATION_TRANSITION_HELD_NO_RETRY'
assert not os.path.exists(ns['CLAIMS']+'/'+'d'*64)
os.chmod(os.path.dirname(old['prepared']),0o700)
print('fixture passed')
`,
  ));

test("failed reconciliation completion retains the fence even after native preparation completed", () =>
  python(
    heldModel +
      `
record=a['record']
def fail_completion(name,value):
 if name==failed_claim+'/reconciliation/completed.json':
  assert os.path.exists(lock)
  raise RuntimeError('fixture completion write failed')
 return record(name,value)
a['record']=fail_completion
try:ns['install_from_held'](r,'sha256:'+'c'*64,a,corpus);raise AssertionError('missing reconciliation completion accepted')
except RuntimeError as e:assert str(e)=='fixture completion write failed'
assert os.path.exists(lock) and not os.path.exists(failed_claim+'/reconciliation/completed.json')
assert os.path.exists(ns['CLAIMS']+'/'+'c'*64+'/completed.json')
assert open(failed_claim+'/reservation.json','rb').read()==original_reservation
for d in ['a','c']:os.chmod(ns['READBACK']+'/'+d*64,0o700)
print('fixture passed')
`,
  ));

test("held successor rechecks installed CAS before replacement and preserves the fence on drift", () =>
  python(
    heldModel +
      `
check=ns['assert_reconciled_installation'];calls=0
def drift(request,auth):
 global calls
 calls+=1
 if calls==2:
  os.chmod(ns['EXECUTABLE'],0o700);open(ns['EXECUTABLE'],'wb').write(b'fixture concurrent drift');os.chmod(ns['EXECUTABLE'],0o555)
 return check(request,auth)
ns['install_locked'].__globals__['assert_reconciled_installation']=drift
try:ns['install_from_held'](r,'sha256:'+'c'*64,a,corpus);raise AssertionError('stale installed CAS accepted')
except RuntimeError:pass
assert calls==2 and os.path.exists(lock)
assert not os.path.exists(ns['CLAIMS']+'/'+'c'*64+'/completed.json')
assert not os.path.exists(failed_claim+'/reconciliation/completed.json')
assert open(failed_claim+'/reservation.json','rb').read()==original_reservation
os.chmod(os.path.dirname(old['prepared']),0o700)
print('fixture passed')
`,
  ));

test("a failed fresh held-successor preparation preserves both histories and never enables replay", () =>
  python(
    heldModel +
      `
def fail_fresh(auth):raise RuntimeError('fresh native failure')
ns['install'].__globals__['native_prepare']=fail_fresh
try:ns['install_from_held'](r,'sha256:'+'c'*64,a,corpus);raise AssertionError('failed fresh preparation accepted')
except RuntimeError as e:assert str(e)=='fresh native failure'
assert open(failed_claim+'/reservation.json','rb').read()==original_reservation
assert open(failed_claim+'/reconciliation/previous-transition/child.json','rb').read()==original_child
assert os.path.exists(lock) and stat.S_IMODE(os.stat(lock).st_mode)==0o755
assert not os.path.exists(failed_claim+'/reconciliation/completed.json')
assert os.path.exists(ns['CLAIMS']+'/'+'c'*64+'/reservation.json')
assert not os.path.exists(ns['CLAIMS']+'/'+'c'*64+'/completed.json')
try:ns['install_from_held'](r,'sha256:'+'d'*64,a,corpus);raise AssertionError('replay accepted')
except (RuntimeError,OSError):pass
assert open(old['prepared'],'rb').read()==old_prepared
os.chmod(os.path.dirname(old['prepared']),0o700)
print('fixture passed')
`,
  ));

test("producer cannot run root publication admission or nominate arbitrary source libraries", () =>
  python(`
for mode in ['admit-and-prepare','admit-successor-and-prepare','admit-held-successor-and-prepare','admit-expired-execution-successor-and-prepare']:
 try:ns['main']([mode,'/never-read','sha256:'+'a'*64]);raise AssertionError('producer accepted')
 except RuntimeError as e:assert str(e)=='PERSONAL_OWNER_ROOT_REQUIRED'
try:ns['libraries']({'/tmp/arbitrary.py':'sha256:'+'a'*64});raise AssertionError('module path accepted')
except RuntimeError:pass
print('fixture passed')
`));

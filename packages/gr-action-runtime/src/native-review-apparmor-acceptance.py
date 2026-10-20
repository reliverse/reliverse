"""Owner-only, one-shot synthetic AppArmor acceptance; no real credential access.

Trusted OS Python/stdlib/parser/setpriv and root administration. Invoke captured,
checksum-bound source under OS Python -I -S. No production service or key use.
"""
import base64
import hashlib
import json
import os
import re
import resource
import signal
import stat
import subprocess
import sys
import tempfile
import time

STATE = "/var/lib/reliverse/gr/native-review-acceptance"
ACTORS = "/var/lib/reliverse/actors"
PARSER = "/usr/sbin/apparmor_parser"
SETPRIV = "/usr/bin/setpriv"
PYTHON = "/usr/bin/python3.12"
PROFILES = "/sys/kernel/security/apparmor/profiles"
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/", "LC_ALL": "C"}
ORIGINAL = "profile reliverse-gr-native-review "

# This child knows only the synthetic path. It never reads credential contents,
# even in the unconfined baseline or if an expected open denial fails.
PROBE = r'''
import errno,json,os,stat,sys
root,label,confined=sys.argv[1:]
assert root.startswith("/var/lib/reliverse/actors/gr-native-review-acceptance-")
assert len(root.rsplit("-",1)[1])==64
actual=open("/proc/self/attr/apparmor/current").read().strip()
assert actual==label, "LABEL_MISMATCH"
s=open("/proc/self/status").read()
fields=dict(line.split(":",1) for line in s.splitlines() if ":" in line)
assert os.getuid()==os.geteuid()==0 and os.getgid()==os.getegid()==0
assert os.getgroups()==[], "GROUPS"
assert fields["NoNewPrivs"].strip()=="1"
for k in ["CapEff","CapPrm","CapBnd"]: assert int(fields[k].strip(),16)==0x80004, k
for k in ["CapInh","CapAmb"]: assert int(fields[k].strip(),16)==0, k
handles=[]
try:
 d=os.open("/",os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW); handles.append(d)
 for part in (root+"/campaign-reviewer-credential/private").split("/")[1:]:
  d=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=d); handles.append(d)
 meta=os.stat("sentinel.json",dir_fd=d,follow_symlinks=False)
 assert stat.S_ISREG(meta.st_mode) and meta.st_uid==994 and meta.st_gid==984
 assert stat.S_IMODE(meta.st_mode)==0o600 and meta.st_nlink==1
 leaf=os.open("sentinel.json",os.O_PATH|os.O_NOFOLLOW,dir_fd=d); handles.append(leaf)
 assert (os.fstat(leaf).st_dev,os.fstat(leaf).st_ino)==(meta.st_dev,meta.st_ino)
 target=root+"/campaign-reviewer-credential/private/sentinel.json"
 attempts=[("direct",target,None),("dirfd","sentinel.json",d),
  ("proc-dirfd","/proc/self/fd/"+str(d)+"/sentinel.json",None),
  ("proc-leaffd","/proc/self/fd/"+str(leaf),None),
  ("proc-root","/proc/self/root"+target,None)]
 outcomes={}
 for name,path,dfd in attempts:
  try:
   fd=os.open(path,os.O_RDONLY|os.O_NONBLOCK,dir_fd=dfd)
  except OSError as e:
   assert e.errno in (errno.EACCES,errno.EPERM), "UNEXPECTED_OPEN_ERROR"
   outcomes[name]="denied"
  else:
   os.close(fd)
   outcomes[name]="opened-without-read"
 expected="denied" if confined=="yes" else "opened-without-read"
 assert all(v==expected for v in outcomes.values()), "CONTENT_ACCESS_UNEXPECTED"
 print(json.dumps({"label":actual,"metadataVerified":True,"caps":"0x80004",
  "noNewPrivileges":True,"opens":outcomes,"credentialContentsRead":False}))
finally:
 for fd in reversed(handles): os.close(fd)
'''


def fail(code):
    raise RuntimeError(code)


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def unique(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            fail("DUPLICATE_JSON_KEY")
        out[key] = value
    return out


def read(file, limit, digest=None, owner=0):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != owner or before.st_nlink != 1 or before.st_size > limit or before.st_mode & 0o7022:
            fail("INPUT_METADATA_INVALID")
        data = bytearray()
        while len(data) <= limit:
            b = os.read(fd, min(65536, limit + 1 - len(data)))
            if not b:
                break
            data.extend(b)
        after, named = os.fstat(fd), os.lstat(file)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_ctime_ns, s.st_size)
        if len(data) != before.st_size or len(data) > limit or identity(before) != identity(after) or identity(before) != identity(named) or (digest is not None and sha(data) != digest):
            fail("INPUT_CHANGED")
        return bytes(data)
    finally:
        os.close(fd)


def directory(path, create=False):
    if not path.startswith("/") or os.path.normpath(path) != path:
        fail("PATH_INVALID")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.split("/")[1:]:
            if create:
                try:
                    os.mkdir(part, 0o755, dir_fd=fd)
                    os.fsync(fd)
                except FileExistsError:
                    pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
            s = os.fstat(fd)
            if s.st_uid != 0 or s.st_mode & 0o7022:
                fail("ROOT_PARENT_INVALID")
        return os.dup(fd)
    finally:
        os.close(fd)


def write(file, data):
    parent = directory(os.path.dirname(file))
    try:
        fd = os.open(os.path.basename(file), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        try:
            os.fchmod(fd, 0o600)
            view = memoryview(data)
            while view:
                n = os.write(fd, view)
                if n <= 0:
                    fail("SHORT_WRITE")
                view = view[n:]
            os.fsync(fd)
        finally:
            os.close(fd)
        os.fsync(parent)
    finally:
        os.close(parent)


def record(file, value):
    write(file, (json.dumps(value, indent=2) + "\n").encode())


def validate(request):
    if set(request) != {"schema", "createdAtUnix", "expiresAtUnix", "profileBase64", "profileDigest", "artifacts"} or request["schema"] != "gr.native-review.apparmor-acceptance-request.v0":
        fail("REQUEST_INVALID")
    begin, end = request["createdAtUnix"], request["expiresAtUnix"]
    if type(begin) not in (int, float) or type(end) not in (int, float) or not begin <= time.time() < end or not 0 < end - begin <= 86400:
        fail("REQUEST_EXPIRED")
    profile = base64.b64decode(request["profileBase64"], validate=True)
    if len(profile) > 4096 or sha(profile) != request["profileDigest"] or not profile.startswith(ORIGINAL.encode()) or profile.count(ORIGINAL.encode()) != 1:
        fail("PROFILE_CHANGED")
    # Captured request admits these exact policy bytes. No includes, namespace or
    # secondary profile is permitted, even if another request is later prepared.
    text = profile.decode("ascii")
    if "#" in text or text.count("{") != 1 or text.count("}") != 1 or not text.endswith("}\n"):
        fail("PROFILE_SHAPE_INVALID")
    artifacts = request["artifacts"]
    if not isinstance(artifacts, dict) or set(artifacts) != {PARSER, SETPRIV, PYTHON}:
        fail("TOOLS_INVALID")
    for path, digest in artifacts.items():
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
            fail("TOOLS_INVALID")
        fd = directory(os.path.dirname(path))
        os.close(fd)
        read(path, 16 * 1024 ** 2, digest)
    return profile


def limits():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 ** 2, 512 * 1024 ** 2))
    resource.setrlimit(resource.RLIMIT_FSIZE, (32768, 32768))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))


def run(argv, state):
    # Regular output files, not unbounded communicate() buffers. Any timeout or
    # partial parser result leaves the whole attempt held without automatic retry.
    with tempfile.TemporaryFile(dir=state) as out, tempfile.TemporaryFile(dir=state) as err:
        p = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=out, stderr=err, env=ENV, cwd="/", close_fds=True, start_new_session=True, preexec_fn=limits)
        try:
            p.wait(timeout=30)
        except BaseException:
            os.killpg(p.pid, signal.SIGKILL)
            p.wait()
            raise
        out.seek(0)
        err.seek(0)
        stdout, stderr = out.read(32769), err.read(32769)
        if p.returncode != 0 or len(stdout) > 32768 or len(stderr) > 32768:
            record(state + "/subprocess-failure.json", {"executable": argv[0], "exit": p.returncode, "stderr": stderr[:4096].decode("utf8", errors="replace")})
            fail("ACCEPTANCE_SUBPROCESS_FAILED")
        return stdout


def profiles():
    with open(PROFILES, encoding="ascii") as f:
        lines = f.read(4 * 1024 ** 2 + 1)
    if len(lines) > 4 * 1024 ** 2:
        fail("PROFILE_LIST_TOO_LARGE")
    return lines.splitlines()


def check_result(raw, label, confined):
    result = json.loads(raw, object_pairs_hook=unique)
    expected = "denied" if confined else "opened-without-read"
    if result != {"label": label, "metadataVerified": True, "caps": "0x80004", "noNewPrivileges": True, "opens": {k: expected for k in ["direct", "dirfd", "proc-dirfd", "proc-leaffd", "proc-root"]}, "credentialContentsRead": False}:
        fail("PROBE_RESULT_INVALID")
    return result


def execute(request, request_digest, original):
    if os.getuid() != 0 or os.geteuid() != 0 or os.getgid() != 0 or os.getegid() != 0:
        fail("PERSONAL_OWNER_ROOT_REQUIRED")
    name = "gr-native-review-acceptance-" + request_digest[7:]
    state, fixture = STATE + "/" + request_digest[7:], ACTORS + "/" + name
    label = name + " (enforce)"
    if any(line.split(" ", 1)[0] == name for line in profiles()):
        fail("EXISTING_PROFILE_REFUSED")
    for root in [STATE, ACTORS]:
        d = directory(root, create=root == STATE)
        try:
            os.mkdir(os.path.basename(state if root == STATE else fixture), 0o700, dir_fd=d)
            os.fsync(d)
        finally:
            os.close(d)
        if root == STATE:
            record(state + "/reservation.json", {"requestDigest": request_digest, "profile": name, "outcome": "outcome-unknown"})
    try:
        # Root-owned 0700 fixture directories exclude concurrent reviewer writes;
        # only the nonsecret leaf has reviewer ownership to exercise DAC bypass.
        private = fixture + "/campaign-reviewer-credential/private"
        for part in [fixture + "/campaign-reviewer-credential", private]:
            os.mkdir(part, 0o700)
        leaf = private + "/sentinel.json"
        write(leaf, b'{"synthetic":true,"secret":false}\n')
        os.chown(leaf, 994, 984, follow_symlinks=False)
        named = os.lstat(leaf)
        transformed = original.replace(ORIGINAL.encode(), ("profile " + name + " ").encode(), 1)
        profile = state + "/profile.apparmor"
        write(profile, transformed)
        record(state + "/request.json", request)
        command = [SETPRIV, "--bounding-set=-all,+sys_ptrace,+dac_read_search", "--inh-caps=-all", "--ambient-caps=-all", "--clear-groups", "--no-new-privs"]
        baseline = check_result(run(command + [PYTHON, "-I", "-S", "-c", PROBE, fixture, "unconfined", "no"], state), "unconfined", False)
        validate(request)
        read(profile, 4096, sha(transformed))
        run([PARSER, "--config-file", "/dev/null", "--skip-cache", "--jobs", "1", "--add", profile], state)
        if label not in profiles():
            fail("ENFORCING_PROFILE_NOT_LOADED")
        confined = check_result(run(command + ["--apparmor-profile=" + name, PYTHON, "-I", "-S", "-c", PROBE, fixture, label, "yes"], state), label, True)
        read(profile, 4096, sha(transformed))
        validate(request)
        run([PARSER, "--config-file", "/dev/null", "--skip-cache", "--jobs", "1", "--remove", profile], state)
        if any(line.split(" ", 1)[0] == name for line in profiles()):
            fail("PROFILE_CLEANUP_UNCONFIRMED")
        after = os.lstat(leaf)
        if (after.st_dev, after.st_ino, after.st_ctime_ns) != (named.st_dev, named.st_ino, named.st_ctime_ns):
            fail("FIXTURE_CHANGED")
        os.unlink(leaf)
        for part in [private, os.path.dirname(private), fixture]:
            os.rmdir(part)
        parent = directory(ACTORS)
        os.fsync(parent)
        os.close(parent)
        result = {"schema": "gr.native-review.apparmor-acceptance-result.v0", "requestDigest": request_digest, "reviewedProfileDigest": sha(original), "testProfileDigest": sha(transformed), "profileNameOnlyChanged": True, "outcome": "completed", "baseline": baseline, "confined": confined, "testProfileUnloaded": True, "syntheticFixtureRemoved": True, "productionKeysOpened": False, "productionServiceStarted": False, "signingGranted": False, "campaignApproved": False, "completedAtUnix": time.time(), "limits": "Synthetic AppArmor enforcement only; not production service/cross-UID/native signing or loaded production-policy identity acceptance."}
        record(state + "/completed.json", result)
        return result
    except BaseException as cause:
        try:
            record(state + "/held.json", {"requestDigest": request_digest, "outcome": "outcome-unknown", "automaticRetry": False, "errorKind": type(cause).__name__, "error": str(cause)[:200]})
        except BaseException:
            pass
        raise


def main(args):
    validation = len(args) == 3 and args[0] == "--validate"
    if validation:
        args = args[1:]
    if len(args) != 2 or not re.fullmatch(r"sha256:[a-f0-9]{64}", args[1]):
        fail("EXACT_REQUEST_REQUIRED")
    raw = read(args[0], 16384, args[1], owner=1000)
    request = json.loads(raw, object_pairs_hook=unique)
    original = validate(request)
    if validation:
        print(json.dumps({"schema": "gr.native-review.apparmor-acceptance-validation.v0", "requestDigest": args[1], "reviewedProfileDigest": sha(original), "nativeEffects": False}))
    else:
        print(json.dumps(execute(request, args[1], original)))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except BaseException:
        print("GR_APPARMOR_ACCEPTANCE_HELD_NO_RETRY", file=sys.stderr)
        sys.exit(1)

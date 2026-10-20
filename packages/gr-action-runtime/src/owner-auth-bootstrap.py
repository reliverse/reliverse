"""Personal owner admission of the fixed GR identity-only Auth helper.

OS Python/stdlib and root administration are trusted. No SSH/key/Git operation.
Invoke captured checksum-bound source under python -I -S and an empty environment.
"""
import hashlib
import json
import os
import pty
import re
import select
import signal
import stat
import sys
import time
import resource
from datetime import datetime
from contextlib import contextmanager

EXECUTABLE = "/usr/lib/reliverse/gr/owner-auth"
POLICY = "/etc/reliverse/gr/owner-auth.json"
STATE = "/var/lib/reliverse/gr/auth/owner"
CLAIM = "/var/lib/reliverse/gr/admissions/owner-auth"
ENROLLMENT = "/etc/reliverse/secret-broker/owner-control.json"
SOURCE_POLICY = "/etc/reliverse/gr/bootstrap-source.json"

_active_transition = None


def fail(code):
    raise RuntimeError(code)


def sha(b):
    return "sha256:" + hashlib.sha256(b).hexdigest()


def unique(pairs):
    v = {}
    for k, x in pairs:
        if k in v:
            fail("DUPLICATE_KEY")
        v[k] = x
    return v


def directory(name, create=False):
    if not name.startswith("/") or os.path.normpath(name) != name:
        fail("PATH_INVALID")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in filter(None, name.split("/")[1:]):
            made = False
            if create:
                try:
                    os.mkdir(part, 0o755, dir_fd=fd)
                    made = True
                    os.fsync(fd)
                except FileExistsError:
                    pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
            if made:
                os.fchmod(fd, 0o755)
                os.fsync(fd)
            s = os.fstat(fd)
            if s.st_uid != 0 or s.st_mode & 0o7022:
                fail("ROOT_PARENT_INVALID")
        return os.dup(fd)
    finally:
        os.close(fd)


def read(name, owner, limit, digest=None, protected=False):
    if not name.startswith("/") or os.path.normpath(name) != name:
        fail("PATH_INVALID")
    if protected:
        d = directory(os.path.dirname(name))
        os.close(d)
    f = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        s = os.fstat(f)
        if not stat.S_ISREG(s.st_mode) or s.st_uid != owner or s.st_nlink != 1 or s.st_size > limit or s.st_mode & (0o7022 if protected else 0o002):
            fail("FILE_INVALID")
        chunks, n = [], 0
        while n <= limit:
            b = os.read(f, min(1048576, limit + 1 - n))
            if not b:
                break
            n += len(b)
            chunks.append(b)
        data = b"".join(chunks)
        after, named = os.fstat(f), os.lstat(name)
        if n > limit or n != s.st_size or (s.st_dev, s.st_ino, s.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_ctime_ns) or (s.st_dev, s.st_ino, s.st_ctime_ns) != (named.st_dev, named.st_ino, named.st_ctime_ns) or (digest is not None and sha(data) != digest):
            fail("FILE_CHANGED")
        return data
    finally:
        os.close(f)


def source_root():
    policy = json.loads(read(SOURCE_POLICY, 0, 4096, protected=True), object_pairs_hook=unique)
    if set(policy) != {"schema", "sourceRoot"} or policy["schema"] != "gr.bootstrap-source.v0":
        fail("SOURCE_POLICY_INVALID")
    root = policy["sourceRoot"]
    if not isinstance(root, str) or not root.startswith("/") or root == "/" or os.path.normpath(root) != root or any(c in root for c in "\r\n\0"):
        fail("SOURCE_POLICY_INVALID")
    return root


def write(name, data, mode):
    d = directory(os.path.dirname(name))
    try:
        f = os.open(os.path.basename(name), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=d)
        try:
            os.fchmod(f, mode)
            view = memoryview(data)
            while view:
                n = os.write(f, view)
                if n <= 0:
                    fail("SHORT_WRITE")
                view = view[n:]
            os.fsync(f)
        finally:
            os.close(f)
        os.fsync(d)
    finally:
        os.close(d)


def record(name, value):
    write(name, (json.dumps(value, indent=2) + "\n").encode(), 0o600)


def validate(request):
    required = {"schema", "createdAt", "expiresAt", "executable", "policy", "bootstrapArtifacts"}
    if not required.issubset(request) or set(request) - required - {"expectedInstallation"} or request["schema"] != "gr.owner-auth.install-request.v0":
        fail("REQUEST_INVALID")
    if "expectedInstallation" in request:
        old = request["expectedInstallation"]
        if not isinstance(old, dict) or set(old) != {"requestDigest", "executableDigest", "policyDigest", "kind"} or old["kind"] not in ("initial", "update") or any(not re.fullmatch(r"sha256:[a-f0-9]{64}", old[k]) for k in ("requestDigest", "executableDigest", "policyDigest")):
            fail("UPDATE_EXPECTATION_INVALID")
    begin, end = (datetime.fromisoformat(request[k].replace("Z", "+00:00")).timestamp() for k in ("createdAt", "expiresAt"))
    if not begin <= time.time() < end or not 0 < end - begin <= 5 * 3600:
        fail("REQUEST_EXPIRED")
    for item in [request["executable"], request["policy"]]:
        if set(item) != {"source", "digest"} or not re.fullmatch(r"sha256:[a-f0-9]{64}", item["digest"]) or not item["source"].startswith(source_root() + "/temp/") or os.path.normpath(item["source"]) != item["source"]:
            fail("SOURCE_INVALID")
    data = read(request["policy"]["source"], 1000, 65536, request["policy"]["digest"])
    p = json.loads(data, object_pairs_hook=unique)
    if set(p) != {"schema", "ownerEnrollmentDigest", "ownerPrincipalId", "passwdDigest", "groupDigest", "author", "artifacts", "links"} or p["schema"] != "gr.owner-auth.host.v0" or not isinstance(p["ownerPrincipalId"], str) or not re.fullmatch(r"prn_[a-f0-9]{32}", p["ownerPrincipalId"]) or not isinstance(p["author"], dict) or set(p["author"]) != {"name", "email"} or any(not isinstance(v, str) or not v.strip() or any(c in v for c in "\r\n\0") for v in p["author"].values()):
        fail("POLICY_INVALID")
    if any(not isinstance(p[k], str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", p[k]) for k in ["ownerEnrollmentDigest", "passwdDigest", "groupDigest"]):
        fail("POLICY_INVALID")
    read("/etc/passwd", 0, 1048576, p["passwdDigest"], True)
    read("/etc/group", 0, 1048576, p["groupDigest"], True)
    e = json.loads(read(ENROLLMENT, 0, 65536, p["ownerEnrollmentDigest"], True), object_pairs_hook=unique)
    b = e["binding"]
    if e["schema"] != "rvs.secret-broker.owner-control-enrollment.v0" or e.get("authenticationEnabled") is not True or (e["ownerUid"], e["agentUid"], e["brokerUid"]) != (995, 999, 996) or b["principal"] != {"id": p["ownerPrincipalId"], "kind": "human"} or b["status"] != "active" or b["assurance"] != "verified" or b["boundByPrincipalId"] != p["ownerPrincipalId"] or b["actor"] != {"id": "os-user.uid-995", "kind": "human"} or b["provider"] != {"id": "local-os", "subject": "uid:995"}:
        fail("ENROLLMENT_INVALID")
    artifacts = p["artifacts"]
    boot = request["bootstrapArtifacts"]
    if not isinstance(boot, dict) or not 1 <= len(boot) <= 64 or os.path.realpath(sys.executable) not in boot or not 1 <= len(artifacts) <= 128 or len({a["path"] for a in artifacts}) != len(artifacts):
        fail("CLOSURE_INVALID")
    pinned = {a["path"]: a["digest"] for a in artifacts}
    if pinned.get(EXECUTABLE) != request["executable"]["digest"] or "/usr/bin/setpriv" not in pinned:
        fail("EXECUTABLE_NOT_PINNED")
    for name, digest in list(pinned.items()) + list(boot.items()):
        if not re.fullmatch(r"/usr/[A-Za-z0-9_./+-]+", name) or os.path.normpath(name) != name or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
            fail("ARTIFACT_INVALID")
        if name != EXECUTABLE:
            read(name, 0, 256 * 1024 ** 2, digest, True)
    if len(p["links"]) > 64 or len({a["path"] for a in p["links"]}) != len(p["links"]):
        fail("LINKS_INVALID")
    for link in p["links"]:
        name = link["path"]
        if not re.fullmatch(r"/(?:usr/[A-Za-z0-9_./+-]+|lib|lib64)", name) or os.path.normpath(name) != name:
            fail("LINK_PATH_INVALID")
        fd = directory(os.path.dirname(name))
        os.close(fd)
        s = os.lstat(name)
        if not stat.S_ISLNK(s.st_mode) or s.st_uid != 0 or os.readlink(name) != link["target"]:
            fail("LINK_CHANGED")
    return p, data


def require_transition():
    if _active_transition is None or _active_transition[0] != os.getpid():
        fail("OWNER_AUTH_TRANSITION_REQUIRED")
    _, lock, fd = _active_transition
    held, named = os.fstat(fd), os.lstat(lock)
    if not stat.S_ISDIR(named.st_mode) or stat.S_ISLNK(named.st_mode) or stat.S_IMODE(named.st_mode) != 0o700 or (held.st_dev, held.st_ino) != (named.st_dev, named.st_ino):
        fail("OWNER_AUTH_TRANSITION_CHANGED")


@contextmanager
def owner_transition(digest):
    # One durable lock for the fixed executable/policy, NOT one per request. Hold
    # it through exact-old checks, replacement, verification, child exec/wait and
    # authentication recording. A crash/failure never reclaims it by PID/age.
    global _active_transition
    if _active_transition is not None or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        fail("OWNER_AUTH_TRANSITION_REQUIRED")
    lock = CLAIM + "-transition.lock"
    parent = directory(os.path.dirname(lock), True)
    fd = None
    try:
        os.mkdir(os.path.basename(lock), 0o700, dir_fd=parent)
        os.fsync(parent)
        fd = directory(lock)
        os.fchmod(fd, 0o700)
        record(lock + "/owner.json", {"requestDigest": digest, "pid": os.getpid(), "outcome": "outcome-unknown"})
        _active_transition = (os.getpid(), lock, fd)
        # No finally-unlock: any failed or uncertain transition remains held.
        yield
        require_transition()
        os.unlink("owner.json", dir_fd=fd)
        os.fsync(fd)
        os.rmdir(os.path.basename(lock), dir_fd=parent)
        os.fsync(parent)
    finally:
        _active_transition = None
        if fd is not None:
            os.close(fd)
        os.close(parent)


def install(request, digest):
    require_transition()
    p, policy_bytes = validate(request)
    executable = read(request["executable"]["source"], 1000, 256 * 1024 ** 2, request["executable"]["digest"])
    if not executable.startswith(b"\x7fELF") or any(os.path.lexists(x) for x in (CLAIM, EXECUTABLE, POLICY, STATE)):
        fail("TARGET_EXISTS_OR_INVALID_NO_REPLAY")
    for name in (os.path.dirname(CLAIM), os.path.dirname(EXECUTABLE), os.path.dirname(POLICY), os.path.dirname(STATE)):
        fd = directory(name, True)
        os.close(fd)
    os.mkdir(CLAIM, 0o700)
    result = {"schema": "gr.owner-auth.admission-result.v0", "requestDigest": digest, "executableDigest": request["executable"]["digest"], "policyDigest": request["policy"]["digest"], "authorityGranted": False, "gitExecutionAdmitted": False, "campaignApproved": False, "sshdChanged": False, "privateKeysRead": False}
    record(CLAIM + "/reservation.json", dict(result, recordRole="reservation", outcome="outcome-unknown"))
    validate(request)
    write(EXECUTABLE, executable, 0o555)
    write(POLICY, policy_bytes, 0o644)
    os.mkdir(STATE, 0o700)
    fd = os.open(STATE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fchown(fd, 995, 985)
        os.fchmod(fd, 0o700)
        os.fsync(fd)
    finally:
        os.close(fd)
    for name in (os.path.dirname(CLAIM), os.path.dirname(STATE)):
        fd = directory(name)
        os.fsync(fd)
        os.close(fd)
    read(EXECUTABLE, 0, 256 * 1024 ** 2, request["executable"]["digest"], True)
    read(POLICY, 0, 65536, request["policy"]["digest"], True)
    validate(request)
    completed = dict(result, recordRole="completion", outcome="completed", completedAtUnix=time.time())
    record(CLAIM + "/completed.json", completed)
    return completed


def launch(request, digest, claim=None, command="authenticate"):
    require_transition()
    claim = CLAIM if claim is None else claim
    if command not in ("authenticate", "reauthenticate"):
        fail("AUTHENTICATION_COMMAND_INVALID")
    policy, _ = validate(request)
    completed = json.loads(read(claim + "/completed.json", 0, 16384, protected=True), object_pairs_hook=unique)
    if completed.get("requestDigest") != digest or completed.get("outcome") != "completed":
        fail("ADMISSION_REQUIRED")
    read(EXECUTABLE, 0, 256 * 1024 ** 2, request["executable"]["digest"], True)
    read(POLICY, 0, 65536, request["policy"]["digest"], True)
    if not all(os.isatty(fd) for fd in (0, 2)):
        fail("PERSONAL_OWNER_TERMINAL_REQUIRED")
    # The installed helper receives its own UID995-owned controlling terminal;
    # no chown of the operator's original TTY and no change to SSH ForceCommand.
    record(claim + "/authentication-reservation.json", {"requestDigest": digest, "outcome": "outcome-unknown"})
    child, master = pty.fork()
    if child == 0:
        try:
            os.fchown(0, 995, 985)
            os.fchmod(0, 0o600)
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
            os.execve("/usr/bin/setpriv", ["/usr/bin/setpriv", "--reuid=995", "--regid=985", "--clear-groups", "--no-new-privs", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", EXECUTABLE, command], {"PATH": "/usr/bin:/bin", "HOME": "/", "LC_ALL": "C"})
        except BaseException:
            os._exit(1)
    output, deadline, reaped = bytearray(), time.monotonic() + 60, False
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([master], [], [], remaining)[0]:
                fail("AUTHENTICATION_TIMEOUT_NO_RETRY")
            try:
                data = os.read(master, 4096)
            except OSError as e:
                if e.errno != 5:
                    raise
                break
            if not data:
                break
            output.extend(data)
            if len(output) > 65536:
                fail("AUTHENTICATION_OUTPUT_LIMIT")
        while True:
            pid, status = os.waitpid(child, os.WNOHANG)
            if pid == child:
                break
            if time.monotonic() >= deadline:
                fail("AUTHENTICATION_EXIT_UNCERTAIN")
            time.sleep(0.01)
        reaped = True
        if not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0:
            fail("AUTHENTICATION_HELD_NO_RETRY")
        result = json.loads(output, object_pairs_hook=unique)
        if result.get("schema") != "gr.owner-authentication.v0" or result.get("principalId") != policy["ownerPrincipalId"] or result.get("actorId") != "os-user.uid-995" or result.get("scopes") != ["identity.observe"] or result.get("audiences") != ["gr.owner-control"] or result.get("resources") != ["github:reliverse/reliverse"] or any(result.get(k) is not False for k in ("authorityGranted", "gitExecutionAdmitted", "campaignApproved")):
            fail("AUTHENTICATION_RESULT_INVALID")
        validate(request)
        require_transition()
        read(EXECUTABLE, 0, 256 * 1024 ** 2, request["executable"]["digest"], True)
        read(POLICY, 0, 65536, request["policy"]["digest"], True)
        record(claim + "/authentication-completed.json", {"requestDigest": digest, "outcome": "completed", "authentication": result})
        return result
    finally:
        os.close(master)
        if not reaped:
            try:
                os.kill(child, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(child, 0)


def update_helper(request, digest):
    require_transition()
    # A separate exact-old CAS admission, never replay of the completed initial
    # bootstrap. Auth store and prior reservations/completions remain untouched.
    p, policy_bytes = validate(request)
    old = request["expectedInstallation"]
    prior_claim = CLAIM if old["kind"] == "initial" else CLAIM + "-updates/" + old["requestDigest"][7:]
    prior = json.loads(read(prior_claim + "/completed.json", 0, 16384, protected=True), object_pairs_hook=unique)
    if any(prior.get(k) != old[k] for k in ("requestDigest", "executableDigest", "policyDigest")) or prior.get("outcome") != "completed":
        fail("PRIOR_ADMISSION_MISMATCH")
    previous_executable = read(EXECUTABLE, 0, 256 * 1024 ** 2, old["executableDigest"], True)
    previous_policy = read(POLICY, 0, 65536, old["policyDigest"], True)
    fd = directory(os.path.dirname(STATE))
    os.close(fd)
    state = os.lstat(STATE)
    if not stat.S_ISDIR(state.st_mode) or stat.S_ISLNK(state.st_mode) or (state.st_uid, state.st_gid, stat.S_IMODE(state.st_mode)) != (995, 985, 0o700):
        fail("AUTH_STORE_CHANGED")
    executable = read(request["executable"]["source"], 1000, 256 * 1024 ** 2, request["executable"]["digest"])
    if not executable.startswith(b"\x7fELF") or request["executable"]["digest"] == old["executableDigest"]:
        fail("UPDATE_EXECUTABLE_INVALID")
    claim = CLAIM + "-updates/" + digest[7:]
    fd = directory(os.path.dirname(claim), True)
    try:
        os.mkdir(os.path.basename(claim), 0o700, dir_fd=fd)
        os.fsync(fd)
    finally:
        os.close(fd)
    result = {"schema": "gr.owner-auth.admission-result.v0", "requestDigest": digest, "executableDigest": request["executable"]["digest"], "policyDigest": request["policy"]["digest"], "previousRequestDigest": old["requestDigest"], "authStorePreserved": True, "authorityGranted": False, "gitExecutionAdmitted": False, "campaignApproved": False, "sshdChanged": False, "privateKeysRead": False}
    record(claim + "/reservation.json", dict(result, recordRole="reservation", outcome="outcome-unknown"))
    write(claim + "/previous-executable", previous_executable, 0o400)
    write(claim + "/previous-policy.json", previous_policy, 0o400)
    staged_executable, staged_policy = EXECUTABLE + ".next-" + digest[7:], POLICY + ".next-" + digest[7:]
    write(staged_executable, executable, 0o555)
    write(staged_policy, policy_bytes, 0o644)
    validate(request)
    read(EXECUTABLE, 0, 256 * 1024 ** 2, old["executableDigest"], True)
    read(POLICY, 0, 65536, old["policyDigest"], True)
    # Any partial replace/readback remains held by reservation: no rollback/retry.
    os.replace(staged_executable, EXECUTABLE)
    os.replace(staged_policy, POLICY)
    for parent in (os.path.dirname(EXECUTABLE), os.path.dirname(POLICY)):
        fd = directory(parent)
        os.fsync(fd)
        os.close(fd)
    read(EXECUTABLE, 0, 256 * 1024 ** 2, request["executable"]["digest"], True)
    read(POLICY, 0, 65536, request["policy"]["digest"], True)
    validate(request)
    completed = dict(result, recordRole="completion", outcome="completed", completedAtUnix=time.time())
    record(claim + "/completed.json", completed)
    return completed, claim


def main(args):
    if len(args) != 3 or args[0] not in ("--validate", "admit-and-authenticate", "update-and-reauthenticate"):
        fail("ARGUMENTS_INVALID")
    operation, filename, digest = args
    if operation != "--validate" and (os.getuid() != 0 or os.geteuid() != 0):
        fail("PERSONAL_OWNER_ROOT_COMMAND_REQUIRED")
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        fail("DIGEST_INVALID")
    request = json.loads(read(filename, 1000, 16384, digest), object_pairs_hook=unique)
    validate(request)
    if operation != "--validate" and ((operation == "update-and-reauthenticate") != ("expectedInstallation" in request)):
        fail("ADMISSION_MODE_MISMATCH")
    if operation == "--validate":
        read(request["executable"]["source"], 1000, 256 * 1024 ** 2, request["executable"]["digest"])
        return {"schema": "gr.owner-auth.install-validation.v0", "requestDigest": digest, "nativeEffects": False}
    if any(k in os.environ for k in ("LD_PRELOAD", "LD_LIBRARY_PATH", "PYTHONPATH", "PYTHONHOME", "BUN_OPTIONS", "NODE_OPTIONS", "SSH_AUTH_SOCK")):
        fail("UNCLEAN_ENVIRONMENT")
    if not all(os.isatty(fd) for fd in (0, 2)):
        fail("PERSONAL_OWNER_TERMINAL_REQUIRED")
    space = os.statvfs("/var/lib/reliverse")
    if space.f_bavail * space.f_frsize < 256 * 1024 ** 2:
        fail("INSUFFICIENT_SPACE")
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    with owner_transition(digest):
        if operation == "update-and-reauthenticate":
            admission, claim = update_helper(request, digest)
            authentication = launch(request, digest, claim, "reauthenticate")
        else:
            admission = install(request, digest)
            authentication = launch(request, digest)
    return {"schema": "gr.owner-auth.bootstrap-result.v0", "outcome": "completed", "admission": admission, "authentication": authentication}


if __name__ == "__main__":
    try:
        print(json.dumps(main(sys.argv[1:])))
    except BaseException:
        print("GR_OWNER_AUTH_ADMISSION_HELD_NO_RETRY", file=sys.stderr)
        sys.exit(1)

"""Owner-invoked, checksum-bound SSH key preparation/authentication; no Git.

Trusts the root-admin OS Python/stdlib. Invoke only via reviewed Python -I -S
captured-source checksum entry with an empty environment. This is not admission
of a GR executor, GitHub write access, an authenticated Principal or a Gate.
"""
import base64
import grp
import hashlib
import json
import os
import pwd
import resource
import re
import stat
import subprocess
import sys
import tempfile
import time
from datetime import datetime

REPOSITORY = "reliverse/reliverse"
OWNER = "reliverse-owner-control"
UID, GID = 995, 985
BASE = "/var/lib/reliverse/gr"
DIRECTORY = BASE + "/credentials/github-reliverse-reliverse"
CLAIM = BASE + "/key-requests/github-reliverse-reliverse"
KEY = DIRECTORY + "/deploy-ed25519"
COMMENT = "reliverse-publication:reliverse/reliverse"
ENROLLMENT = "/etc/reliverse/secret-broker/owner-control.json"


def fail(code):
    raise RuntimeError(code)


def unique(pairs):
    value = {}
    for k, v in pairs:
        if k in value:
            fail("DUPLICATE_JSON_KEY")
        value[k] = v
    return value


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def directory(name, create=False):
    if not name.startswith("/") or os.path.normpath(name) != name:
        fail("DIRECTORY_PATH_INVALID")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in name.split("/")[1:]:
            created = False
            if create:
                try:
                    os.mkdir(part, 0o755, dir_fd=fd)
                    created = True
                    os.fsync(fd)
                except FileExistsError:
                    pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
            if created:
                # Parent traversal must not inherit the secret-file umask 077.
                os.fchmod(fd, 0o755)
                os.fsync(fd)
            s = os.fstat(fd)
            if s.st_uid != 0 or s.st_mode & 0o022:
                fail("ROOT_DIRECTORY_CUSTODY_INVALID")
        return os.dup(fd)
    finally:
        os.close(fd)


def read_regular(name, owner, limit, expected=None, protected_parents=False):
    if not name.startswith("/") or os.path.normpath(name) != name:
        fail("FILE_PATH_INVALID")
    # Hold each ancestor; source parents need not be root-owned, but may not link.
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parts = name.split("/")[1:]
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
            if protected_parents:
                s = os.fstat(fd)
                if s.st_uid != 0 or s.st_mode & 0o022:
                    fail("ROOT_DIRECTORY_CUSTODY_INVALID")
        f = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            before = os.fstat(f)
            if not stat.S_ISREG(before.st_mode) or before.st_uid != owner or before.st_nlink != 1 or before.st_size > limit or (protected_parents and before.st_mode & 0o022):
                fail("FILE_CUSTODY_INVALID")
            chunks, size = [], 0
            while True:
                b = os.read(f, min(1048576, limit + 1 - size))
                if not b:
                    break
                size += len(b)
                if size > limit:
                    fail("FILE_TOO_LARGE")
                chunks.append(b)
            data = b"".join(chunks)
            after = os.fstat(f)
            named = os.stat(parts[-1], dir_fd=fd, follow_symlinks=False)
            if (before.st_dev, before.st_ino, before.st_ctime_ns, before.st_size) != (after.st_dev, after.st_ino, after.st_ctime_ns, len(data)) or (named.st_dev, named.st_ino, named.st_ctime_ns) != (before.st_dev, before.st_ino, before.st_ctime_ns) or (expected is not None and sha(data) != expected):
                fail("FILE_CHANGED")
            return data
        finally:
            os.close(f)
    finally:
        os.close(fd)


def write_new(name, value):
    data = (json.dumps(value, indent=2) + "\n").encode()
    d = directory(os.path.dirname(name))
    try:
        f = os.open(os.path.basename(name), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=d)
        try:
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


def validate_request(request, operation):
    keys = {"schema", "repository", "requestedOwnerPrincipalId", "ownerEnrollmentDigest", "createdAt", "expiresAt", "passwdDigest", "groupDigest", "artifacts"}
    if set(request) != keys or request["schema"] != "gr.publication-key.request.v0" or request["repository"] != REPOSITORY or not isinstance(request["requestedOwnerPrincipalId"], str) or not re.fullmatch(r"prn_[a-f0-9]{32}", request["requestedOwnerPrincipalId"]) or not isinstance(request["ownerEnrollmentDigest"], str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", request["ownerEnrollmentDigest"]):
        fail("REQUEST_INVALID")
    if not all(isinstance(request[k], str) and request[k].endswith("Z") for k in ("createdAt", "expiresAt")):
        fail("REQUEST_TIME_INVALID")
    begin = datetime.fromisoformat(request["createdAt"].replace("Z", "+00:00")).timestamp()
    end = datetime.fromisoformat(request["expiresAt"].replace("Z", "+00:00")).timestamp()
    if end <= begin or end > begin + 5 * 3600 or (operation != "inspect" and not begin <= time.time() < end):
        fail("REQUEST_EXPIRED_OR_INVALID")
    if operation == "inspect":
        return
    enrollment = json.loads(read_regular(ENROLLMENT, 0, 65536, request["ownerEnrollmentDigest"], protected_parents=True), object_pairs_hook=unique)
    binding = enrollment["binding"]
    principal = request["requestedOwnerPrincipalId"]
    if enrollment["schema"] != "rvs.secret-broker.owner-control-enrollment.v0" or enrollment.get("authenticationEnabled") is not True or (enrollment["ownerUid"], enrollment["agentUid"], enrollment["brokerUid"]) != (UID, 999, 996) or binding["principal"] != {"id": principal, "kind": "human"} or binding["boundByPrincipalId"] != principal or binding["status"] != "active" or binding["assurance"] != "verified" or binding["actor"] != {"id": "os-user.uid-" + str(UID), "kind": "human"} or binding["provider"] != {"id": "local-os", "subject": "uid:" + str(UID)}:
        fail("OWNER_ENROLLMENT_INVALID")
    space = os.statvfs("/var/lib/reliverse")
    if space.f_bavail * space.f_frsize < 64 * 1024 ** 2:
        fail("INSUFFICIENT_DISK_HEADROOM")
    artifacts = request["artifacts"]
    if not isinstance(artifacts, dict) or not 3 <= len(artifacts) <= 64 or not all(p in artifacts for p in ("/usr/bin/ssh-keygen", "/usr/bin/setpriv", os.path.realpath(sys.executable))):
        fail("NATIVE_CLOSURE_INVALID")
    if not all(isinstance(d, str) and re.fullmatch(r"sha256:[a-f0-9]{64}", d) for d in [request["passwdDigest"], request["groupDigest"], *artifacts.values()]):
        fail("ARTIFACT_DIGEST_INVALID")
    for name, expected in artifacts.items():
        if not name.startswith("/usr/") or os.path.realpath(name) != name:
            fail("NATIVE_ARTIFACT_PATH_INVALID")
        read_regular(name, 0, 64 * 1024 ** 2, expected, protected_parents=True)
    read_regular("/etc/passwd", 0, 1024 ** 2, request["passwdDigest"], protected_parents=True)
    read_regular("/etc/group", 0, 1024 ** 2, request["groupDigest"], protected_parents=True)
    p = pwd.getpwnam(OWNER)
    if (p.pw_uid, p.pw_gid) != (UID, GID) or any(OWNER in g.gr_mem and g.gr_gid != GID for g in grp.getgrall()):
        fail("OWNER_ACCOUNT_DRIFT")
    for uid, gid in ((1000, 1000), (994, 984)):
        p = pwd.getpwuid(uid)
        if (p.pw_uid, p.pw_gid) != (uid, gid):
            fail("EXCLUDED_ACCOUNT_DRIFT")


def public_identity(data):
    tokens = data.decode("ascii").strip().split()
    if len(tokens) != 3 or tokens[0] != "ssh-ed25519" or tokens[2] != COMMENT:
        fail("PUBLIC_KEY_INVALID")
    wire = base64.b64decode(tokens[1], validate=True)
    if len(wire) != 51 or wire[:19] != b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20" or base64.b64encode(wire).decode() != tokens[1]:
        fail("PUBLIC_KEY_INVALID")
    return {"publicKey": " ".join(tokens), "fingerprint": "SHA256:" + base64.b64encode(hashlib.sha256(wire).digest()).decode().rstrip("=")}


def excluded_access_denied(uid, gid):
    child = os.fork()
    if child == 0:
        try:
            os.setgroups([])
            os.setgid(gid)
            os.setuid(uid)
            denied = not any(os.access(p, flag) for p in (DIRECTORY, KEY) for flag in (os.R_OK, os.W_OK, os.X_OK))
            os._exit(0 if denied else 1)
        except BaseException:
            os._exit(2)
    _, status = os.waitpid(child, 0)
    return os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0


def assert_owner_parent_traversal():
    for name in ("/", "/var", "/var/lib", "/var/lib/reliverse", BASE, os.path.dirname(DIRECTORY)):
        if not os.lstat(name).st_mode & 0o001:
            fail("OWNER_PARENT_TRAVERSAL_UNAVAILABLE")


def prepare(request, request_digest):
    if os.path.lexists(CLAIM) or os.path.lexists(DIRECTORY):
        fail("TARGET_EXISTS_NO_REPLAY")
    for parent in (os.path.dirname(CLAIM), os.path.dirname(DIRECTORY)):
        fd = directory(parent, create=True)
        os.close(fd)
    assert_owner_parent_traversal()
    os.mkdir(CLAIM, 0o700)
    claim = directory(CLAIM)
    os.fsync(claim)
    os.close(claim)
    result = {"schema": "gr.publication-key.result.v0", "requestDigest": request_digest, "repository": REPOSITORY, "credentialDirectory": DIRECTORY, "ownerUid": UID, "ownerGid": GID, "authenticatedPrincipal": False, "githubRegistered": False, "gitExecutionAdmitted": False, "campaignApproved": False}
    write_new(CLAIM + "/reservation.json", dict(result, recordRole="reservation", outcome="outcome-unknown"))
    # Root-owned parent makes the new private directory entry nonreplaceable by
    # owner UID. Owner/root compromise is outside ordinary producer isolation.
    os.mkdir(DIRECTORY, 0o700)
    private = directory(DIRECTORY)
    try:
        os.fchmod(private, 0o700)
        os.fchown(private, UID, GID)
        os.fsync(private)
    finally:
        os.close(private)
    for parent in (os.path.dirname(CLAIM), os.path.dirname(DIRECTORY)):
        fd = directory(parent)
        os.fsync(fd)
        os.close(fd)
    validate_request(request, "prepare")
    # Never capture/log tool output. No private key is read by this bootstrap.
    run = subprocess.run(["/usr/bin/setpriv", "--reuid=" + str(UID), "--regid=" + str(GID), "--clear-groups", "--no-new-privs", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", "/usr/bin/ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", COMMENT, "-f", KEY], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env={"PATH": "/usr/bin:/bin", "HOME": "/", "LC_ALL": "C"}, cwd="/", timeout=20, check=False)
    if run.returncode != 0:
        fail("KEYGEN_OUTCOME_UNKNOWN")
    s = os.lstat(DIRECTORY)
    if not stat.S_ISDIR(s.st_mode) or (s.st_uid, s.st_gid, stat.S_IMODE(s.st_mode)) != (UID, GID, 0o700):
        fail("PRIVATE_DIRECTORY_CUSTODY_INVALID")
    for name in (KEY, KEY + ".pub"):
        s = os.lstat(name)
        if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or (s.st_uid, s.st_gid, stat.S_IMODE(s.st_mode)) != (UID, GID, 0o600) or not 0 < s.st_size <= 4096:
            fail("KEY_METADATA_INVALID")
    identity = public_identity(read_regular(KEY + ".pub", UID, 4096))
    for uid, gid in ((1000, 1000), (994, 984)):
        if not excluded_access_denied(uid, gid):
            fail("PRIVATE_ACCESS_NOT_DENIED")
    validate_request(request, "prepare")
    # Flush native-generated key bytes without reading or rewriting them.
    f = os.open(KEY, os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        s = os.fstat(f)
        if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or (s.st_uid, s.st_gid, stat.S_IMODE(s.st_mode)) != (UID, GID, 0o600):
            fail("KEY_METADATA_CHANGED")
        os.fsync(f)
    finally:
        os.close(f)
    # Public bytes may be read; private bytes are never read by this bootstrap.
    f = os.open(KEY + ".pub", os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(f)
    finally:
        os.close(f)
    d = os.open(DIRECTORY, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(d)
    finally:
        os.close(d)
    completed = dict(result, **identity, recordRole="completion", outcome="completed", keyCreated=True, privateKeyContentsRead=False, producerAndReviewerAccessDenied=True, completedAtUnix=time.time())
    write_new(CLAIM + "/completed.json", completed)
    return completed


GITHUB_HOST_KEY_FINGERPRINT = "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"
KNOWN_HOSTS = DIRECTORY + "/known_hosts"


def validate_auth_request(request, operation):
    extra = {"generationRequestDigest", "keyFingerprint", "githubHostKey"}
    if not extra.issubset(request) or request.get("schema") != "gr.publication-key.authentication-request.v0" or not isinstance(request["generationRequestDigest"], str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", request["generationRequestDigest"]) or not isinstance(request["keyFingerprint"], str) or not re.fullmatch(r"SHA256:[A-Za-z0-9+/]{43}", request["keyFingerprint"]):
        fail("AUTHENTICATION_REQUEST_INVALID")
    if not isinstance(request["githubHostKey"], str) or len(request["githubHostKey"].split()) != 2 or "\n" in request["githubHostKey"] or "\r" in request["githubHostKey"]:
        fail("GITHUB_HOST_KEY_INVALID")
    host = public_identity((request["githubHostKey"] + " " + COMMENT).encode("ascii"))
    if host["fingerprint"] != GITHUB_HOST_KEY_FINGERPRINT:
        fail("GITHUB_HOST_KEY_UNTRUSTED")
    base = {k: v for k, v in request.items() if k not in extra}
    base["schema"] = "gr.publication-key.request.v0"
    validate_request(base, "inspect" if operation == "inspect-auth" else operation)
    if operation != "inspect-auth" and "/usr/bin/ssh" not in request["artifacts"]:
        fail("SSH_EXECUTABLE_NOT_PINNED")


def assert_auth_custody(request):
    completed = json.loads(read_regular(CLAIM + "/completed.json", 0, 16384, protected_parents=True), object_pairs_hook=unique)
    if completed.get("outcome") != "completed" or completed.get("recordRole") != "completion" or completed.get("requestDigest") != request["generationRequestDigest"] or completed.get("repository") != REPOSITORY or completed.get("fingerprint") != request["keyFingerprint"]:
        fail("KEY_GENERATION_BINDING_INVALID")
    d = directory(os.path.dirname(DIRECTORY))
    os.close(d)
    s = os.lstat(DIRECTORY)
    if not stat.S_ISDIR(s.st_mode) or (s.st_uid, s.st_gid, stat.S_IMODE(s.st_mode)) != (UID, GID, 0o700):
        fail("PRIVATE_DIRECTORY_CUSTODY_INVALID")
    s = os.lstat(KEY)
    if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or (s.st_uid, s.st_gid, stat.S_IMODE(s.st_mode)) != (UID, GID, 0o600) or not 0 < s.st_size <= 4096:
        fail("KEY_METADATA_INVALID")
    public = public_identity(read_regular(KEY + ".pub", UID, 4096))
    if public["fingerprint"] != request["keyFingerprint"] or public["publicKey"] != completed.get("publicKey"):
        fail("PUBLIC_KEY_CHANGED")
    for uid, gid in ((1000, 1000), (994, 984)):
        if not excluded_access_denied(uid, gid):
            fail("PRIVATE_ACCESS_NOT_DENIED")


def authentication_argv():
    return ["/usr/bin/setpriv", "--reuid=" + str(UID), "--regid=" + str(GID), "--clear-groups", "--no-new-privs", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", "/usr/bin/ssh", "-F", "/dev/null", "-T", "-p", "22", "-o", "BatchMode=yes", "-o", "PreferredAuthentications=publickey", "-o", "PasswordAuthentication=no", "-o", "KbdInteractiveAuthentication=no", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none", "-o", "CertificateFile=none", "-o", "AddKeysToAgent=no", "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes", "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "ProxyCommand=none", "-o", "ProxyJump=none", "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=" + KNOWN_HOSTS, "-o", "GlobalKnownHostsFile=/dev/null", "-o", "HostKeyAlgorithms=ssh-ed25519", "-o", "UpdateHostKeys=no", "-o", "VerifyHostKeyDNS=no", "-o", "CanonicalizeHostname=no", "-o", "ConnectTimeout=10", "-o", "ConnectionAttempts=1", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2", "-o", "LogLevel=ERROR", "-i", KEY, "git@github.com"]


def github_authentication_result(exit_code, data):
    expected = ("Hi " + REPOSITORY + "! You've successfully authenticated, but GitHub does not provide shell access.").encode()
    return exit_code == 1 and data.strip() == expected


def authenticate(request, request_digest, auth_claim):
    validate_auth_request(request, "authenticate")
    assert_auth_custody(request)
    if os.path.lexists(auth_claim):
        fail("AUTHENTICATION_ATTEMPT_EXISTS_NO_REPLAY")
    parent = directory(os.path.dirname(auth_claim), create=True)
    os.close(parent)
    os.mkdir(auth_claim, 0o700)
    parent = directory(os.path.dirname(auth_claim))
    os.fsync(parent)
    os.close(parent)
    result = {"schema": "gr.publication-key.authentication-result.v0", "requestDigest": request_digest, "generationRequestDigest": request["generationRequestDigest"], "repository": REPOSITORY, "keyFingerprint": request["keyFingerprint"], "hostKeyFingerprint": GITHUB_HOST_KEY_FINGERPRINT, "writePermission": "owner-reported-not-probed", "gitExecutionAdmitted": False, "campaignApproved": False}
    write_new(auth_claim + "/reservation.json", dict(result, recordRole="reservation", outcome="outcome-unknown"))
    known = ("github.com " + request["githubHostKey"] + "\n").encode("ascii")
    if os.path.lexists(KNOWN_HOSTS):
        read_regular(KNOWN_HOSTS, UID, 4096, sha(known))
    else:
        f = os.open(KNOWN_HOSTS, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            os.fchown(f, UID, GID)
            if os.write(f, known) != len(known):
                fail("KNOWN_HOSTS_SHORT_WRITE")
            os.fsync(f)
        finally:
            os.close(f)
        d = os.open(DIRECTORY, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(d)
        finally:
            os.close(d)
    s = os.lstat(KNOWN_HOSTS)
    if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or (s.st_uid, s.st_gid, stat.S_IMODE(s.st_mode)) != (UID, GID, 0o600):
        fail("KNOWN_HOSTS_CUSTODY_INVALID")
    validate_auth_request(request, "authenticate")
    assert_auth_custody(request)
    # Unnamed/unlinked scratch contains only server output, never private key bytes.
    # The child inherits a file-size cap; communicate cannot grow an unbounded pipe.
    resource.setrlimit(resource.RLIMIT_FSIZE, (65536, 65536))
    with tempfile.TemporaryFile(dir=auth_claim) as output:
        run = subprocess.run(authentication_argv(), stdin=subprocess.DEVNULL, stdout=output, stderr=output, env={"PATH": "/usr/bin:/bin", "HOME": "/", "LC_ALL": "C"}, cwd="/", timeout=25, check=False)
        output.seek(0)
        data = output.read(65537)
    if len(data) > 65536 or not github_authentication_result(run.returncode, data):
        fail("GITHUB_AUTHENTICATION_NOT_CONFIRMED_NO_RETRY")
    validate_auth_request(request, "authenticate")
    assert_auth_custody(request)
    read_regular(KNOWN_HOSTS, UID, 4096, sha(known))
    completed = dict(result, recordRole="completion", outcome="completed", repositoryAuthenticationVerified=True, knownHostsDigest=sha(known), privateKeyReadByBootstrap=False, completedAtUnix=time.time())
    write_new(auth_claim + "/completed.json", completed)
    return completed


def main(args):
    if len(args) != 3 or args[0] not in ("--validate", "prepare", "inspect", "--validate-auth", "authenticate", "inspect-auth"):
        fail("ARGUMENTS_INVALID")
    operation, filename, digest = args
    if operation not in ("--validate", "--validate-auth") and (os.getuid() != 0 or os.geteuid() != 0):
        fail("PERSONAL_OWNER_ROOT_COMMAND_REQUIRED")
    request = json.loads(read_regular(filename, 1000, 16384, digest), object_pairs_hook=unique)
    if operation in ("--validate-auth", "authenticate", "inspect-auth"):
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
            fail("REQUEST_DIGEST_INVALID")
        validate_auth_request(request, operation)
        auth_claim = BASE + "/auth-checks/github-reliverse-reliverse/" + digest[7:]
        if operation == "--validate-auth":
            return {"schema": "gr.publication-key.authentication-validation.v0", "requestDigest": digest, "nativeEffects": False, "privateCustodyAndGenerationChecked": False}
        if operation == "inspect-auth":
            try:
                result = json.loads(read_regular(auth_claim + "/completed.json", 0, 16384, protected_parents=True), object_pairs_hook=unique)
            except FileNotFoundError:
                return {"schema": "gr.publication-key.authentication-inspection.v0", "requestDigest": digest, "claimExists": os.path.lexists(auth_claim), "outcome": "outcome-unknown", "retryAllowed": False}
            if result.get("requestDigest") != digest or result.get("outcome") != "completed":
                fail("AUTHENTICATION_COMPLETION_BINDING_INVALID")
            return dict(result, historicalReceipt=True, currentCustodyVerified=False, retryAllowed=False)
        if any(k in os.environ for k in ("LD_PRELOAD", "LD_LIBRARY_PATH", "PYTHONPATH", "PYTHONHOME", "SSH_AUTH_SOCK")):
            fail("UNCLEAN_ENVIRONMENT")
        os.umask(0o077)
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        return authenticate(request, digest, auth_claim)
    validate_request(request, operation)
    if operation == "--validate":
        if os.path.lexists(CLAIM) or os.path.lexists(DIRECTORY):
            fail("TARGET_EXISTS_NO_REPLAY")
        return {"schema": "gr.publication-key.validation.v0", "requestDigest": digest, "repository": REPOSITORY, "nativeEffects": False}
    if operation == "inspect":
        try:
            result = json.loads(read_regular(CLAIM + "/completed.json", 0, 16384, protected_parents=True), object_pairs_hook=unique)
        except FileNotFoundError:
            return {"schema": "gr.publication-key.inspection.v0", "requestDigest": digest, "claimExists": os.path.lexists(CLAIM), "outcome": "outcome-unknown", "retryAllowed": False}
        if result.get("requestDigest") != digest or result.get("outcome") != "completed":
            fail("COMPLETION_BINDING_INVALID")
        return dict(result, historicalReceipt=True, currentCustodyVerified=False, retryAllowed=False)
    if any(k in os.environ for k in ("LD_PRELOAD", "LD_LIBRARY_PATH", "PYTHONPATH", "PYTHONHOME", "SSH_AUTH_SOCK")):
        fail("UNCLEAN_ENVIRONMENT")
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    return prepare(request, digest)


if __name__ == "__main__":
    try:
        print(json.dumps(main(sys.argv[1:])))
    except BaseException:
        # Native crypto/filesystem exceptions never expose secrets or trigger retry.
        print("GR_PUBLICATION_KEY_PREPARATION_HELD_NO_RETRY", file=sys.stderr)
        sys.exit(1)

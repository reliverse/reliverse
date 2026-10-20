"""Personal owner admission of preparation-only publication replica/launcher.

Captured checksum-bound OS Python/stdlib, fixed native target and approved source
libraries; no mutable TS, key contents, network, commit/push or signing execution.
"""
import base64
import hashlib
import json
import os
import pty
import re
import resource
import select
import signal
import stat
import sys
import time
from datetime import datetime
from contextlib import contextmanager

SOURCE_POLICY = "/etc/reliverse/gr/bootstrap-source.json"
AUTH_SOURCE = "packages/gr-action-runtime/src/owner-auth-bootstrap.py"
CORPUS_SOURCE = "packages/rvs/rvs-systemd-ubuntu/src/campaign-reviewer-account-bootstrap.py"
# Part of the personally checksum-approved bootstrap closure, never request authority.
TRUSTED_SOURCE_MODULES = {
    AUTH_SOURCE: "sha256:492602b4b1edef7ddbe1a9eea4c91eb9a093e6df6b0085b821c3e6cdbb7b9498",
    CORPUS_SOURCE: "sha256:9506630f6b468e91d8a556d4a9f580445bb4fc331f69718314ec22d09316b136",
}
EXECUTABLE = "/usr/lib/reliverse/gr/owner-launch"
POLICY = "/etc/reliverse/gr/owner-publication.json"
ROOT = "/var/lib/reliverse/gr/publication/reliverse-reliverse"
CLAIMS = "/var/lib/reliverse/gr/admissions/owner-publication"
READBACK = "/var/lib/reliverse/gr/publication-preparations"
LAUNCH_POLICY = "/etc/reliverse/gr/owner-launch.json"
SIGNING_POLICY = "/etc/reliverse/gr/reviewer-signing.json"
BRIDGE_POLICY = "/etc/reliverse/gr/native-review-bridge.json"
GATEHOUSE = "/var/lib/reliverse/gr/gatehouse"
NATIVE_REVIEW = "/var/lib/reliverse/gr/native-review"

_active_transition = None


def fail(code):
    raise RuntimeError(code)


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def capture(path, digest, limit=65536, owner=1000):
    if owner == 0:
        parent = os.path.dirname(path)
        while True:
            s = os.lstat(parent)
            if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o7022:
                fail("ROOT_PARENT_INVALID")
            if parent == "/":
                break
            parent = os.path.dirname(parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_uid != owner or s.st_nlink != 1 or s.st_size > limit or s.st_mode & (0o7022 if owner == 0 else 0o002):
            fail("SOURCE_INVALID")
        chunks = []
        remaining = limit + 1
        while remaining:
            b = os.read(fd, min(remaining, 65536))
            if not b:
                break
            remaining -= len(b)
            chunks.append(b)
        data = b"".join(chunks)
        after, named = os.fstat(fd), os.lstat(path)
        if len(data) != s.st_size or (digest is not None and sha(data) != digest) or (s.st_dev, s.st_ino, s.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_ctime_ns) or (s.st_dev, s.st_ino, s.st_ctime_ns) != (named.st_dev, named.st_ino, named.st_ctime_ns):
            fail("SOURCE_CHANGED")
        return data
    finally:
        os.close(fd)


def unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            fail("DUPLICATE_KEY")
        value[key] = item
    return value


def source_root():
    policy = json.loads(capture(SOURCE_POLICY, None, 4096, owner=0), object_pairs_hook=unique)
    if set(policy) != {"schema", "sourceRoot"} or policy["schema"] != "gr.bootstrap-source.v0":
        fail("SOURCE_POLICY_INVALID")
    root = policy["sourceRoot"]
    if not isinstance(root, str) or not root.startswith("/") or root == "/" or os.path.normpath(root) != root or any(c in root for c in "\r\n\0"):
        fail("SOURCE_POLICY_INVALID")
    return root


def libraries(modules):
    if not isinstance(modules, dict) or modules != TRUSTED_SOURCE_MODULES:
        fail("SOURCE_CLOSURE_INVALID")
    # Capture and verify the WHOLE independently pinned closure before any exec.
    root = source_root()
    captured = [(root + "/" + name, capture(root + "/" + name, digest)) for name, digest in TRUSTED_SOURCE_MODULES.items()]
    result = []
    for path, data in captured:
        ns = {"__name__": "gr_captured_admission_library", "__file__": path}
        exec(compile(data, path, "exec"), ns)
        result.append(ns)
    return result


def campaign_spec(policy):
    """Explicit admitted data; no campaign fallback or argv-selected scope."""
    campaign = policy.get("campaign")
    if not isinstance(campaign, dict) or not {"id", "paths", "commits"}.issubset(campaign) or set(campaign) - {"id", "paths", "commits", "publication"} or not isinstance(campaign["id"], str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", campaign["id"]):
        fail("CAMPAIGN_SPEC_INVALID")
    def valid_path(p):
        return isinstance(p, str) and bool(p) and not any(c in p for c in "\\\\\r\n\0") and all(part not in ["", ".", "..", ".git", ".private"] for part in p.split("/"))
    paths, commits = campaign["paths"], campaign["commits"]
    if not isinstance(paths, list) or not 1 <= len(paths) <= 128 or any(not valid_path(p) for p in paths) or len(set(paths)) != len(paths) or paths != sorted(paths) or not isinstance(commits, list) or not 1 <= len(commits) <= 32:
        fail("CAMPAIGN_SPEC_INVALID")
    ids = set()
    for spec in commits:
        if not isinstance(spec, dict) or not {"id", "title", "paths"}.issubset(spec) or set(spec) - {"id", "title", "paths", "rationale"} or not isinstance(spec["id"], str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", spec["id"]) or spec["id"] in ids or not isinstance(spec["title"], str) or not spec["title"].strip() or spec["title"] != spec["title"].strip() or any(c in spec["title"] for c in "\r\n\0") or not isinstance(spec["paths"], list) or not spec["paths"] or any(not valid_path(p) or not any(p == scope or p.startswith(scope + "/") for scope in paths) for p in spec["paths"]):
            fail("CAMPAIGN_SPEC_INVALID")
        if spec["paths"] != sorted(set(spec["paths"])):
            fail("CAMPAIGN_SPEC_INVALID")
        ids.add(spec["id"])
    publication = campaign.get("publication")
    if publication is not None and (not isinstance(publication, dict) or set(publication) != {"mode", "installability", "exceptionRef"} or publication["mode"] != "source-only" or publication["installability"] != "not-claimed" or not isinstance(publication["exceptionRef"], str) or not publication["exceptionRef"].strip()):
        fail("CAMPAIGN_SPEC_INVALID")
    return campaign


def validate_request(request, historical=False):
    required = {"schema", "createdAt", "expiresAt", "sourceModules", "executable", "policy", "corpus", "base", "gitConfig", "bootstrapArtifacts"}
    if not required.issubset(request) or set(request) - required - {"expectedInstallation", "heldPreparation", "expectedExpiredExecution", "expectedUnusedExecution", "expectedCompletedExecution"} or request["schema"] != "gr.owner-publication.install-request.v0":
        fail("REQUEST_INVALID")
    begin, end = [datetime.fromisoformat(request[k].replace("Z", "+00:00")).timestamp() for k in ["createdAt", "expiresAt"]]
    if (not historical and not begin <= time.time() < end) or not 0 < end - begin <= 5 * 3600:
        fail("REQUEST_EXPIRED")
    if request["sourceModules"] != TRUSTED_SOURCE_MODULES:
        fail("SOURCE_CLOSURE_INVALID")
    if "expectedInstallation" in request:
        old = request["expectedInstallation"]
        if not isinstance(old, dict) or set(old) != {"requestDigest", "executableDigest", "policyDigest", "preparedDigest"} or any(not isinstance(d, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", d) for d in old.values()):
            fail("SUCCESSOR_EXPECTATION_INVALID")
    if "expectedExpiredExecution" in request:
        old = request["expectedExpiredExecution"]
        fields = {"launchPolicyDigest", "signingPolicyDigest", "bridgePolicyDigest", "gateDigest", "nativeCompletionDigest", "nativeSealDigest"}
        if historical or "expectedInstallation" not in request or "heldPreparation" in request or not isinstance(old, dict) or set(old) != fields or any(not isinstance(d, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", d) for d in old.values()):
            fail("EXPIRED_EXECUTION_EXPECTATION_INVALID")
    if "expectedUnusedExecution" in request:
        fields = {"launchPolicyDigest", "signingPolicyDigest", "bridgePolicyDigest", "gateDigest", "nativeCompletionDigest", "nativeSealDigest", "gateInventoryDigest", "reason"}
        old = request["expectedUnusedExecution"]
        if historical or "expectedInstallation" not in request or "heldPreparation" in request or "expectedExpiredExecution" in request or not isinstance(old, dict) or set(old) != fields or not isinstance(old["reason"], str) or not old["reason"].strip() or len(old["reason"]) > 1024 or any(not isinstance(d, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", d) for key, d in old.items() if key != "reason"):
            fail("UNUSED_EXECUTION_EXPECTATION_INVALID")
    if "expectedCompletedExecution" in request:
        old = request["expectedCompletedExecution"]
        fields = {"launchPolicyDigest", "signingPolicyDigest", "bridgePolicyDigest", "gates", "native", "steps"}
        if historical or "expectedInstallation" not in request or any(k in request for k in ["heldPreparation", "expectedExpiredExecution", "expectedUnusedExecution"]) or not isinstance(old, dict) or set(old) != fields:
            fail("COMPLETED_EXECUTION_EXPECTATION_INVALID")
        if any(not isinstance(old[k], str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", old[k]) for k in fields - {"gates", "native", "steps"}):
            fail("COMPLETED_EXECUTION_EXPECTATION_INVALID")
        steps = old["steps"]
        if not isinstance(steps, list) or not 1 <= len(steps) <= 32:
            fail("COMPLETED_EXECUTION_EXPECTATION_INVALID")
        for step in steps:
            if not isinstance(step, dict) or set(step) != {"gateId", "commitId", "beforeCommit", "afterCommit", "resultDigest"} or not re.fullmatch(r"gate_[a-f0-9]{32}", step.get("gateId", "")) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", step.get("commitId", "")) or any(not re.fullmatch(r"[a-f0-9]{40}", step.get(k, "")) for k in ["beforeCommit", "afterCommit"]) or not re.fullmatch(r"sha256:[a-f0-9]{64}", step.get("resultDigest", "")):
                fail("COMPLETED_EXECUTION_EXPECTATION_INVALID")
        gate_ids = {step["gateId"] for step in steps}
        if len(gate_ids) != len(steps) or len({step["commitId"] for step in steps}) != len(steps):
            fail("COMPLETED_EXECUTION_EXPECTATION_INVALID")
        for key in ["gates", "native"]:
            if not isinstance(old[key], dict) or set(old[key]) != gate_ids:
                fail("COMPLETED_EXECUTION_EXPECTATION_INVALID")
            for inventory in old[key].values():
                if not isinstance(inventory, dict) or not 1 <= len(inventory) <= 32 or any(not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)?\.json", name) or not isinstance(h, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", h) for name, h in inventory.items()):
                    fail("COMPLETED_EXECUTION_EXPECTATION_INVALID")
    if "heldPreparation" in request:
        held = request["heldPreparation"]
        if historical or "expectedInstallation" not in request or not isinstance(held, dict) or set(held) != {"request", "reservationDigest", "delegationDigest", "lockDevice", "lockInode"}:
            fail("HELD_EXPECTATION_INVALID")
        if not isinstance(held["request"], dict) or set(held["request"]) != {"source", "digest"} or any(not isinstance(d, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", d) for d in [held["request"]["digest"], held["reservationDigest"], held["delegationDigest"]]):
            fail("HELD_EXPECTATION_INVALID")
        if any(type(held[k]) is not int or held[k] < 0 for k in ["lockDevice", "lockInode"]):
            fail("HELD_EXPECTATION_INVALID")
        if not isinstance(held["request"]["source"], str) or not held["request"]["source"].startswith(source_root() + "/temp/") or os.path.normpath(held["request"]["source"]) != held["request"]["source"]:
            fail("HELD_EXPECTATION_INVALID")


def prepare(request, auth, corpus, historical=False):
    validate_request(request, historical=historical)
    data = {}
    for key, limit in [("executable", 256 * 1024 ** 2), ("policy", 65536), ("corpus", 24 * 1024 ** 2), ("base", 96 * 1024 ** 2), ("gitConfig", 65536)]:
        item = request[key]
        if set(item) != {"source", "digest"} or not item["source"].startswith(source_root() + "/temp/") or os.path.normpath(item["source"]) != item["source"] or not re.fullmatch(r"sha256:[a-f0-9]{64}", item["digest"]):
            fail("INPUT_INVALID")
        data[key] = auth["read"](item["source"], 1000, limit, item["digest"])
    if not data["executable"].startswith(b"\x7fELF"):
        fail("EXECUTABLE_INVALID")
    policy = json.loads(data["policy"], object_pairs_hook=auth["unique"])
    if not isinstance(policy.get("expectedCandidateTree"), str) or not re.fullmatch(r"[a-f0-9]{40}", policy["expectedCandidateTree"]):
        fail("CANDIDATE_INVALID")
    c = policy["custody"]
    if policy["schema"] != "gr.owner-publication.host.v0" or policy["createdAt"] != request["createdAt"] or policy["expiresAt"] != request["expiresAt"] or c["root"] != (ROOT + "-" + policy["expectedCandidateTree"] if "expectedInstallation" in request else ROOT) or c["launcherExecutable"] != EXECUTABLE or (c["ownerUid"], c["ownerGid"], c["producerUid"], c["reviewerUid"]) != (995, 985, 1000, 994) or c["remoteUrl"] != "git@github.com:reliverse/reliverse.git" or c["gitConfigDigest"] != sha(data["gitConfig"]):
        fail("POLICY_INVALID")
    if policy.get("retireUnusedExecution") != request.get("expectedUnusedExecution") or ("retireUnusedExecution" in policy) != ("expectedUnusedExecution" in request):
        fail("UNUSED_EXECUTION_POLICY_BINDING_INVALID")
    campaign = campaign_spec(policy)
    prefix = policy.get("retainedPrefix")
    if (prefix is not None) != ("expectedCompletedExecution" in request):
        fail("COMPLETED_PREFIX_POLICY_BINDING_INVALID")
    if prefix is not None:
        if not isinstance(prefix, dict) or set(prefix) != {"commitId", "commit", "tree", "title", "contentBase64"} or prefix["commitId"] != campaign["commits"][0]["id"] or prefix["title"] != campaign["commits"][0]["title"] or any(not isinstance(prefix[k], str) or not re.fullmatch(r"[a-f0-9]{40}", prefix[k]) for k in ["commit", "tree"]) or not isinstance(prefix["contentBase64"], str) or len(prefix["contentBase64"]) > 87384:
            fail("COMPLETED_PREFIX_INVALID")
        commit = base64.b64decode(prefix["contentBase64"], validate=True)
        if base64.b64encode(commit).decode() != prefix["contentBase64"] or hashlib.sha1(b"commit " + str(len(commit)).encode() + b"\0" + commit).hexdigest() != prefix["commit"]:
            fail("COMPLETED_PREFIX_BYTES_INVALID")
    pinned = {a["path"]: a["digest"] for a in c["artifacts"]}
    tools = request["bootstrapArtifacts"]
    if len(pinned) != len(c["artifacts"]) or not 1 <= len(pinned) <= 128 or pinned.get(EXECUTABLE) != request["executable"]["digest"] or not all(k in pinned for k in [c["gitExecutable"], c["sshExecutable"]]) or not isinstance(tools, dict) or not 1 <= len(tools) <= 64 or os.path.realpath(sys.executable) not in tools or "/usr/bin/setpriv" not in tools:
        fail("CLOSURE_INVALID")
    for path, digest in list(pinned.items()) + list(tools.items()):
        if not re.fullmatch(r"/usr/[A-Za-z0-9_./+-]+", path) or os.path.normpath(path) != path or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
            fail("ARTIFACT_INVALID")
        if path != EXECUTABLE:
            auth["read"](path, 0, 256 * 1024 ** 2, digest, True)
    links = policy["links"]
    if not isinstance(links, list) or len(links) > 64 or len({l["path"] for l in links}) != len(links):
        fail("LINKS_INVALID")
    for link in links:
        name = link["path"]
        if set(link) != {"path", "target"} or not re.fullmatch(r"/(?:usr/[A-Za-z0-9_./+-]+|lib|lib64)", name) or os.path.normpath(name) != name:
            fail("LINK_PATH_INVALID")
        fd = auth["directory"](os.path.dirname(name))
        os.close(fd)
        s = os.lstat(name)
        if not stat.S_ISLNK(s.st_mode) or s.st_uid != 0 or os.readlink(name) != link["target"]:
            fail("LINK_CHANGED")
    auth["read"]("/etc/reliverse/gr/owner-auth.json", 0, 65536, policy["authPolicyDigest"], True)
    packet, entries, manifest_digest = corpus["prepare_corpus_packet"](data["corpus"])
    manifest = packet["manifest"]
    proof_bytes = next((b for name, b, mode in entries if name == "tree-proof.json"), None)
    if proof_bytes is None:
        fail("SOURCE_TREE_PROOF_REQUIRED")
    proof_digest = sha(proof_bytes)
    if policy["sourceManifestDigest"] != manifest_digest or policy["sourceTreeProofDigest"] != proof_digest:
        fail("SOURCE_EVIDENCE_BINDING_INVALID")
    if manifest["scope"] != campaign["paths"] or manifest["candidateTree"] != policy["expectedCandidateTree"] or "treeProof" not in packet:
        fail("SOURCE_SCOPE_OR_TREE_INVALID")
    names = {f["path"] for f in manifest["files"]}
    if not {"package.json", "bun.lock"}.issubset(names):
        fail("ROOT_MANIFEST_AND_LOCK_REQUIRED")
    root_manifest = json.loads(base64.b64decode(packet["contents"]["package.json"], validate=True), object_pairs_hook=unique)
    if not isinstance(root_manifest, dict):
        fail("ROOT_MANIFEST_INVALID")
    base = json.loads(data["base"], object_pairs_hook=auth["unique"])
    if set(base) != {"schema", "baseCommit", "baseTree", "digest", "bytes", "contentBase64"} or base["schema"] != "gr.campaign-public-base.v0" or base["baseCommit"] != policy["baseCommit"] or base["baseTree"] != policy["baseTree"] or base["digest"] != policy["baseBundleDigest"]:
        fail("BASE_BINDING_INVALID")
    base_bytes = base64.b64decode(base["contentBase64"], validate=True)
    if not 0 < len(base_bytes) <= 64 * 1024 ** 2 or len(base_bytes) != base["bytes"] or sha(base_bytes) != base["digest"]:
        fail("BASE_BYTES_INVALID")
    return policy, data, entries, base_bytes


def process_start(pid):
    with open("/proc/" + str(pid) + "/stat", "rb") as f:
        return f.read(4096).rsplit(b") ", 1)[1].split()[19].decode("ascii")


def native_prepare(auth):
    if _active_transition is None or _active_transition[0] != os.getpid():
        fail("PUBLICATION_TRANSITION_REQUIRED")
    policy_bytes = auth["read"](POLICY, 0, 65536, protected=True)
    policy = json.loads(policy_bytes, object_pairs_hook=unique)
    ready_read, ready_write = os.pipe()
    child, master = pty.fork()
    if child == 0:
        try:
            os.close(ready_write)
            if os.read(ready_read, 1) != b"1":
                os._exit(1)
            os.close(ready_read)
            os.fchown(0, 995, 985)
            os.fchmod(0, 0o600)
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
            os.execve("/usr/bin/setpriv", ["/usr/bin/setpriv", "--reuid=995", "--regid=985", "--clear-groups", "--no-new-privs", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", EXECUTABLE, "prepare-source"], {"PATH": "/usr/bin:/bin", "HOME": "/", "LC_ALL": "C"})
        except BaseException:
            os._exit(1)
    os.close(ready_read)
    output, deadline, reaped = bytearray(), time.monotonic() + 180, False
    try:
        held = os.fstat(_active_transition[1])
        with open("/proc/sys/kernel/random/boot_id", "r") as f:
            boot_id = f.read(64).strip()
        auth["write"](CLAIMS + "/.transition/child.json", (json.dumps({
            "schema": "gr.owner-publication.child.v0", "operation": "prepare-source",
            "policyDigest": sha(policy_bytes), "root": policy["custody"]["root"],
            "candidateTree": policy["expectedCandidateTree"], "bootId": boot_id,
            "childPid": child, "childStart": process_start(child),
            "parentPid": os.getpid(), "parentStart": process_start(os.getpid()),
            "lockDevice": held.st_dev, "lockInode": held.st_ino,
        }) + "\n").encode(), 0o444)
        os.write(ready_write, b"1")
        os.close(ready_write)
        ready_write = -1
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([master], [], [], remaining)[0]:
                fail("NATIVE_PREPARATION_TIMEOUT_NO_RETRY")
            try:
                b = os.read(master, 65536)
            except OSError as e:
                if e.errno != 5:
                    raise
                break
            if not b:
                break
            output.extend(b)
            if len(output) > 4 * 1024 ** 2:
                fail("NATIVE_PREPARATION_OUTPUT_LIMIT")
        while True:
            pid, status = os.waitpid(child, os.WNOHANG)
            if pid == child:
                reaped = True
                break
            if time.monotonic() >= deadline:
                fail("NATIVE_PREPARATION_EXIT_UNCERTAIN")
            time.sleep(0.01)
        if not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0:
            fail("NATIVE_PREPARATION_HELD_NO_RETRY")
        return json.loads(output, object_pairs_hook=auth["unique"])
    finally:
        if ready_write != -1:
            os.close(ready_write)
        os.close(master)
        if not reaped:
            try:
                os.kill(child, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(child, 0)


def previous_installation(request, auth, backup=None):
    if os.path.lexists(LAUNCH_POLICY) and not any(k in request for k in ["expectedExpiredExecution", "expectedUnusedExecution", "expectedCompletedExecution"]):
        fail("PUBLICATION_EXECUTION_ALREADY_ADMITTED")
    expected = request["expectedInstallation"]
    directory = READBACK + "/" + expected["requestDigest"][7:]
    receipt = json.loads(auth["read"](directory + "/completed.json", 0, 65536, protected=True), object_pairs_hook=unique)
    if receipt.get("schema") != "gr.owner-publication.install-result.v0" or receipt.get("outcome") != "completed" or any(receipt.get(k) != v for k, v in expected.items()) or any(receipt.get(k) is not False for k in ["commitPerformed", "pushPerformed", "publicationExecutionAdmitted", "signingGranted", "campaignApproved"]):
        fail("PREVIOUS_PREPARATION_UNVERIFIED")
    prepared = json.loads(auth["read"](directory + "/prepared.json", 0, 2 * 1024 ** 2, expected["preparedDigest"], True), object_pairs_hook=unique)
    if prepared["plan"]["repository"]["root"] != receipt["root"] or prepared["plan"]["campaignFingerprint"] != receipt["campaignFingerprint"] or prepared["plan"]["frozen"]["candidateTree"]["oid"] != receipt["candidateTree"]:
        fail("PREVIOUS_PREPARATION_UNVERIFIED")
    executable = auth["read"](backup + "/previous-executable" if backup else EXECUTABLE, 0, 256 * 1024 ** 2, expected["executableDigest"], True)
    policy = auth["read"](backup + "/previous-policy.json" if backup else POLICY, 0, 65536, expected["policyDigest"], True)
    if json.loads(policy, object_pairs_hook=unique)["custody"]["root"] != receipt["root"]:
        fail("PREVIOUS_PREPARATION_UNVERIFIED")
    if "expectedCompletedExecution" in request:
        completed_execution(request, auth, receipt)
    elif any(k in request for k in ["expectedExpiredExecution", "expectedUnusedExecution"]):
        expired_execution(request, auth, receipt)
    return executable, policy


def completed_execution(request, auth, previous):
    """Observe completed history; never revoke, replay, renew or rewrite it."""
    expected = request["expectedCompletedExecution"]
    snapshots = {}
    for name, path, field in [("launch", LAUNCH_POLICY, "launchPolicyDigest"), ("signing", SIGNING_POLICY, "signingPolicyDigest"), ("bridge", BRIDGE_POLICY, "bridgePolicyDigest")]:
        snapshots[name + "-policy.json"] = auth["read"](path, 0, 2 * 1024 ** 2, expected[field], True)
    signing = json.loads(snapshots["signing-policy.json"], object_pairs_hook=unique)
    launch = json.loads(snapshots["launch-policy.json"], object_pairs_hook=unique)
    bridge = json.loads(snapshots["bridge-policy.json"], object_pairs_hook=unique)
    fingerprint = lambda v: sha(json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode())
    if launch["custody"]["root"] != previous["root"] or launch["signingPolicyDigest"] != fingerprint(signing) or launch["bridgePolicyDigest"] != sha(snapshots["bridge-policy.json"]) or bridge["signing"] != signing or bridge["signingPolicyFileDigest"] != sha(snapshots["signing-policy.json"]):
        fail("COMPLETED_POLICY_BINDING_INVALID")
    plan = signing["bindings"]["plan"]
    policy = json.loads(auth["read"](request["policy"]["source"], 1000, 65536, request["policy"]["digest"]), object_pairs_hook=unique)
    campaign = campaign_spec(policy)
    prefix = policy["retainedPrefix"]
    steps = expected["steps"]
    last = steps[-1]
    if plan["campaignId"] != campaign["id"] or plan["base"]["commit"]["oid"] != previous["baseCommit"] or policy["baseCommit"] != previous["baseCommit"] or plan["repository"]["root"] != previous["root"] or plan["campaignFingerprint"] != previous["campaignFingerprint"] or plan["frozen"]["candidateTree"]["oid"] != previous["candidateTree"] or signing["bindings"]["action"] != {"kind": "commit", "commitId": last["commitId"], "expectedBeforeCommit": last["beforeCommit"]}:
        fail("COMPLETED_PREDECESSOR_BINDING_INVALID")
    if len(steps) > len(plan["scope"]["commits"]) or prefix["commitId"] != steps[0]["commitId"] or prefix["commit"] != steps[0]["afterCommit"] or prefix["tree"] != plan["frozen"]["steps"][0]["afterTree"] or prefix["title"] != plan["scope"]["commits"][0]["title"]:
        fail("COMPLETED_PREFIX_BINDING_INVALID")
    previous_commit = previous["baseCommit"]
    for index, step in enumerate(steps):
        if step["beforeCommit"] != previous_commit or step["commitId"] != plan["scope"]["commits"][index]["id"] or step["commitId"] != plan["frozen"]["steps"][index]["commitId"]:
            fail("COMPLETED_STEP_ORDER_INVALID")
        previous_commit = step["afterCommit"]
        gate_id, result_digest = step["gateId"], step["resultDigest"]
        parts = [previous["campaignFingerprint"], "gates", gate_id]
        files = {}
        with expired_owner_directory(auth, GATEHOUSE, parts) as fd:
            names = set(os.listdir(fd))
            fixed = {"gate.json", "intent.json", "execution.json", "lease.json", "consumption.json", "approval.json"}
            if not fixed.issubset(names) or names - fixed - {"endorsements", "decisions", "revocations"}:
                fail("COMPLETED_GATE_NAMESPACE_UNCERTAIN")
            for name in fixed:
                files[name] = expired_owner_read(fd, name)
            for sub in ["endorsements", "decisions", "revocations"]:
                if sub not in names:
                    continue
                with expired_owner_directory(auth, GATEHOUSE, parts + [sub]) as child:
                    entries = sorted(os.listdir(child))
                    if len(entries) > 64 or any(not re.fullmatch(r"[A-Za-z0-9_.-]+\.json", e) for e in entries):
                        fail("COMPLETED_GATE_NAMESPACE_UNCERTAIN")
                    for name in entries:
                        files[sub + "/" + name] = expired_owner_read(child, name)
        if {k: sha(v) for k, v in files.items()} != expected["gates"][gate_id]:
            fail("COMPLETED_GATE_INVENTORY_CHANGED")
        values = {k: json.loads(v, object_pairs_hook=unique) for k, v in files.items()}
        gate, intent, execution, lease, consumed = [values[k + ".json"] for k in ["gate", "intent", "execution", "lease", "consumption"]]
        endorsements = [v for k, v in values.items() if k.startswith("endorsements/")]
        decisions = [v for k, v in values.items() if k.startswith("decisions/")]
        if gate["id"] != gate_id or gate["status"] != "completed" or gate["intentDigest"] != intent["digest"] or any(k.startswith("revocations/") for k in files) or len(endorsements) != 2 or len(decisions) != 2:
            fail("PREDECESSOR_NOT_COMPLETED")
        for e in endorsements:
            if values.get("endorsements/" + e["id"] + ".json") != e or not any(d["endorsementId"] == e["id"] and d["accepted"] is True and values.get("decisions/" + e["id"] + ".json") == d for d in decisions):
                fail("COMPLETED_DECISION_BINDING_INVALID")
        if lease["status"] != "consumed" or execution["outcome"] != "completed" or execution.get("uncertainty") or execution["gateId"] != gate_id or execution["intentDigest"] != intent["digest"] or execution["resultDigest"] != result_digest or execution["leaseId"] != lease["id"] or execution["consumptionId"] != consumed["id"] or execution["attemptId"] != consumed["attemptId"]:
            fail("COMPLETED_EXECUTION_BINDING_INVALID")
        params = intent["target"]["parameters"]
        if params["action"] != {"kind": "commit", "commitId": step["commitId"], "expectedBeforeCommit": step["beforeCommit"]} or params["campaignFingerprint"] != plan["campaignFingerprint"] or params["root"] != previous["root"] or params["candidateTree"]["oid"] != previous["candidateTree"]:
            fail("COMPLETED_INTENT_BINDING_INVALID")
        if gate_id == last["gateId"] and signing["intent"] != intent:
            fail("COMPLETED_INTENT_CHANGED")
        journal = NATIVE_REVIEW + "/" + gate_id
        fd = auth["directory"](journal)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_ctime_ns, s.st_mtime_ns)
        before = identity(os.fstat(fd))
        try:
            if sorted(os.listdir(fd)) != ["completed.json", "reservation.json", "sealed.json"]:
                fail("COMPLETED_REVIEW_UNCERTAIN")
            native = {name: auth["read"](journal + "/" + name, 0, 65536, protected=True) for name in ["completed.json", "reservation.json", "sealed.json"]}
            if identity(os.fstat(fd)) != before or identity(os.lstat(journal)) != before or sorted(os.listdir(fd)) != sorted(native):
                fail("COMPLETED_REVIEW_UNCERTAIN")
        finally:
            os.close(fd)
        if {k: sha(v) for k, v in native.items()} != expected["native"][gate_id]:
            fail("COMPLETED_REVIEW_CHANGED")
        done, reserved, seal = [json.loads(native[k + ".json"], object_pairs_hook=unique) for k in ["completed", "reservation", "sealed"]]
        submission = [{k: v for k, v in e.items() if k != "verification"} for e in endorsements if e["principalId"] == signing["bindings"]["review"]["reviewerPrincipalId"]]
        if len(submission) != 1 or done["outcome"] != "completed" or done["gateId"] != gate_id or done["intentDigest"] != intent["digest"] or done["endorsementDigest"] != fingerprint(submission[0]) or (done["reviewer"]["uid"], done["reviewer"]["gid"]) != (994, 984) or seal["completionDigest"] != fingerprint(done) or seal["nonce"] != reserved["nonce"] or seal["nonce"] != done["nonce"]:
            fail("COMPLETED_REVIEW_SEAL_INVALID")
        if gate_id == last["gateId"] and done["signingPolicyDigest"] != fingerprint(signing):
            fail("COMPLETED_REVIEW_POLICY_CHANGED")
        snapshots.update({gate_id + "-" + k.replace("/", "__"): v for k, v in files.items()})
        snapshots.update({gate_id + "-native-" + k: v for k, v in native.items()})
    root = previous["root"]
    if root not in [ROOT, ROOT + "-" + previous["candidateTree"]]:
        fail("COMPLETED_PREDECESSOR_ROOT_INVALID")
    with expired_owner_directory(auth, os.path.dirname(ROOT), [os.path.basename(root), ".git"]) as fd:
        if expired_owner_read(fd, "HEAD") != b"ref: refs/heads/main\n":
            fail("COMPLETED_PREDECESSOR_HEAD_CHANGED")
    with expired_owner_directory(auth, os.path.dirname(ROOT), [os.path.basename(root), ".git", "refs", "heads"]) as fd:
        if os.listdir(fd) != ["main"] or expired_owner_read(fd, "main") != (last["afterCommit"] + "\n").encode():
            fail("COMPLETED_PREDECESSOR_HEAD_CHANGED")
    return snapshots


def expired_execution(request, auth, previous, retired=None):
    unused = "expectedUnusedExecution" in request
    expected = request["expectedUnusedExecution" if unused else "expectedExpiredExecution"]
    snapshots = {}
    policies = []
    for name, path, field in [("launch", LAUNCH_POLICY, "launchPolicyDigest"), ("signing", SIGNING_POLICY, "signingPolicyDigest"), ("bridge", BRIDGE_POLICY, "bridgePolicyDigest")]:
        raw = auth["read"](path, 0, 2 * 1024 ** 2, expected[field], True)
        snapshots[name + "-policy.json"] = raw
        policies.append(json.loads(raw, object_pairs_hook=unique))
    launch, signing, bridge = policies
    intent, plan = signing["intent"], signing["bindings"]["plan"]
    fingerprint = lambda value: sha(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode())
    gate_id = "gate_" + fingerprint(intent["id"])[7:39]
    if not re.fullmatch(r"gate_[a-f0-9]{32}", gate_id) or not re.fullmatch(r"[a-f0-9]{64}", previous["campaignFingerprint"]):
        fail("EXPIRED_EXECUTION_BINDING_INVALID")
    if launch["schema"] != "gr.owner-launch.host.v0" or signing["schema"] != "gr.campaign-reviewer-signing-policy.v0" or bridge["schema"] != "gr.native-review.host.v0" or bridge["signing"] != signing or bridge["signingPolicyFileDigest"] != expected["signingPolicyDigest"] or launch["signingPolicyDigest"] != fingerprint(signing) or launch["bridgePolicyDigest"] != expected["bridgePolicyDigest"]:
        fail("EXPIRED_EXECUTION_BINDING_INVALID")
    for end in ([] if unused else [launch["expiresAt"], bridge["expiresAt"], intent["expiresAt"]]):
        if datetime.fromisoformat(end.replace("Z", "+00:00")).timestamp() >= time.time():
            fail("PUBLICATION_EXECUTION_NOT_EXPIRED")
    action = {"kind": "commit", "commitId": plan["scope"]["commits"][0]["id"], "expectedBeforeCommit": previous["baseCommit"]}
    params = intent["target"]["parameters"]
    if plan["repository"]["root"] != previous["root"] or launch["custody"]["root"] != previous["root"] or plan["campaignFingerprint"] != previous["campaignFingerprint"] or plan["frozen"]["candidateTree"]["oid"] != previous["candidateTree"] or plan["base"]["commit"]["oid"] != previous["baseCommit"] or signing["bindings"]["action"] != action or params["action"] != action or params["campaignFingerprint"] != previous["campaignFingerprint"] or params["root"] != previous["root"] or params["candidateTree"]["oid"] != previous["candidateTree"]:
        fail("EXPIRED_EXECUTION_BINDING_INVALID")
    journal = NATIVE_REVIEW + "/" + gate_id
    fd = auth["directory"](journal)
    identity = lambda s: (s.st_dev, s.st_ino, s.st_ctime_ns, s.st_mtime_ns)
    journal_identity = identity(os.fstat(fd))
    try:
        if sorted(os.listdir(fd)) != ["completed.json", "reservation.json", "sealed.json"]:
            fail("EXPIRED_REVIEW_UNCERTAIN_NO_RETRY")
        for name, field in [("completed", "nativeCompletionDigest"), ("sealed", "nativeSealDigest"), ("reservation", None)]:
            snapshots["native-" + name + ".json"] = auth["read"](journal + "/" + name + ".json", 0, 65536, expected[field] if field else None, True)
        if sorted(os.listdir(fd)) != ["completed.json", "reservation.json", "sealed.json"] or identity(os.fstat(fd)) != journal_identity or identity(os.lstat(journal)) != journal_identity:
            fail("EXPIRED_REVIEW_UNCERTAIN_NO_RETRY")
    finally:
        os.close(fd)
    completed, sealed, reserved = [json.loads(snapshots["native-" + k + ".json"], object_pairs_hook=unique) for k in ["completed", "sealed", "reservation"]]
    if completed["schema"] != "gr.native-review-attempt.v0" or completed["outcome"] != "completed" or completed["gateId"] != gate_id or completed["intentDigest"] != intent["digest"] or completed["signingPolicyDigest"] != fingerprint(signing) or sealed["schema"] != "gr.native-review-seal.v0" or sealed["completionDigest"] != fingerprint(completed) or sealed["nonce"] != completed["nonce"] or reserved["nonce"] != completed["nonce"] or reserved["gateId"] != gate_id or reserved["intentDigest"] != intent["digest"]:
        fail("EXPIRED_REVIEW_UNCERTAIN_NO_RETRY")
    # No mutation/reclamation of the old Gate. Descriptor and nanosecond fences
    # make this a point-in-time observation, not a lock for future writers.
    with expired_owner_directory(auth, GATEHOUSE, [previous["campaignFingerprint"], "gates", gate_id]) as fd:
        if unused:
            snapshots.update(unused_gate_snapshot(fd, expected, intent, gate_id, signing, fingerprint, retired))
        else:
            if sorted(os.listdir(fd)) != ["gate.json", "intent.json"]:
                fail("EXPIRED_GATE_EFFECTS_OR_LOCK_NO_RETRY")
            gate_bytes = expired_owner_read(fd, "gate.json", expected["gateDigest"])
            gate = json.loads(gate_bytes, object_pairs_hook=unique)
            old_intent = json.loads(expired_owner_read(fd, "intent.json"), object_pairs_hook=unique)
            if old_intent != intent or gate["schemaVersion"] != "gatehouse.gate.v0" or gate["id"] != gate_id or gate["intentDigest"] != intent["digest"] or gate["expiresAt"] != intent["expiresAt"] or gate["status"] != "pending" or gate["endorsementIds"] != []:
                fail("EXPIRED_GATE_EFFECTS_OR_LOCK_NO_RETRY")
            snapshots["gate.json"] = gate_bytes
            if sorted(os.listdir(fd)) != ["gate.json", "intent.json"]:
                fail("EXPIRED_GATE_EFFECTS_OR_LOCK_NO_RETRY")
    root = previous["root"]
    if root not in [ROOT, ROOT + "-" + previous["candidateTree"]]:
        fail("EXPIRED_EXECUTION_BINDING_INVALID")
    with expired_owner_directory(auth, os.path.dirname(ROOT), [os.path.basename(root), ".git"]) as fd:
        if expired_owner_read(fd, "HEAD") != b"ref: refs/heads/main\n":
            fail("EXPIRED_REPOSITORY_EFFECTS_NO_RETRY")
    with expired_owner_directory(auth, os.path.dirname(ROOT), [os.path.basename(root), ".git", "refs", "heads"]) as fd:
        if os.listdir(fd) != ["main"] or expired_owner_read(fd, "main") != (previous["baseCommit"] + "\n").encode():
            fail("EXPIRED_REPOSITORY_EFFECTS_NO_RETRY")
    return snapshots


@contextmanager
def expired_owner_directory(auth, parent, parts):
    fds = [auth["directory"](parent)]
    observed = []
    identity = lambda s: (s.st_dev, s.st_ino, s.st_ctime_ns, s.st_mtime_ns)
    try:
        for part in parts:
            fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fds[-1])
            fds.append(fd)
            s = os.fstat(fd)
            if (s.st_uid, s.st_gid) != STAGED_OWNER or s.st_mode & 0o7022:
                fail("EXPIRED_OWNER_DIRECTORY_INVALID")
            observed.append(identity(s))
        yield fds[-1]
        for i, part in enumerate(parts):
            if identity(os.fstat(fds[i + 1])) != observed[i] or identity(os.stat(part, dir_fd=fds[i], follow_symlinks=False)) != observed[i]:
                fail("EXPIRED_OWNER_DIRECTORY_CHANGED")
    finally:
        for fd in reversed(fds):
            os.close(fd)


def expired_owner_read(directory, name, digest=None):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    try:
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or (s.st_uid, s.st_gid) != STAGED_OWNER or stat.S_IMODE(s.st_mode) != 0o600 or s.st_nlink != 1 or s.st_size > 65536:
            fail("EXPIRED_OWNER_FILE_INVALID")
        data = os.read(fd, 65537)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_ctime_ns, s.st_mtime_ns, s.st_size)
        if len(data) != s.st_size or identity(s) != identity(os.fstat(fd)) or identity(s) != identity(os.stat(name, dir_fd=directory, follow_symlinks=False)) or (digest is not None and sha(data) != digest):
            fail("EXPIRED_OWNER_FILE_CHANGED")
        return data
    finally:
        os.close(fd)


def unused_gate_snapshot(fd, expected, intent, gate_id, signing, fingerprint, retired):
    names = sorted(os.listdir(fd))
    if set(names) - {"gate.json", "intent.json", "approval.json", "endorsements", "decisions", "revocations"}:
        fail("UNUSED_GATE_EFFECTS_OR_LOCK_NO_RETRY")
    files = {}
    for name in names:
        if name in ["endorsements", "decisions", "revocations"]:
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            try:
                s = os.fstat(child)
                if (s.st_uid, s.st_gid) != STAGED_OWNER or stat.S_IMODE(s.st_mode) != 0o700:
                    fail("UNUSED_GATE_DIRECTORY_INVALID")
                before = (s.st_dev, s.st_ino, s.st_ctime_ns, s.st_mtime_ns)
                entries = sorted(os.listdir(child))
                if len(entries) > 2 or any(not re.fullmatch(r"[A-Za-z0-9_.-]+\.json", f) for f in entries):
                    fail("UNUSED_GATE_INVENTORY_INVALID")
                for f in entries:
                    files[name + "/" + f] = expired_owner_read(child, f)
                after = os.fstat(child)
                named = os.stat(name, dir_fd=fd, follow_symlinks=False)
                identity = lambda s: (s.st_dev, s.st_ino, s.st_ctime_ns, s.st_mtime_ns)
                if identity(after) != before or identity(named) != before or sorted(os.listdir(child)) != entries:
                    fail("UNUSED_GATE_CHANGED_NO_RETRY")
            finally:
                os.close(child)
        else:
            files[name] = expired_owner_read(fd, name)
    if sorted(os.listdir(fd)) != names or not {"gate.json", "intent.json", "approval.json"}.issubset(files):
        fail("UNUSED_GATE_INVENTORY_INVALID")
    gate = json.loads(files["gate.json"], object_pairs_hook=unique)
    if json.loads(files["intent.json"], object_pairs_hook=unique) != intent or gate["id"] != gate_id or gate["intentDigest"] != intent["digest"] or gate["schemaVersion"] != "gatehouse.gate.v0" or gate["expiresAt"] != intent["expiresAt"]:
        fail("UNUSED_GATE_BINDING_INVALID")
    result = {"gate-" + name.replace("/", "__"): data for name, data in files.items()}
    if retired is None:
        if sha(files["gate.json"]) != expected["gateDigest"] or fingerprint({name: sha(data) for name, data in files.items()}) != expected["gateInventoryDigest"] or gate["status"] != "quorum-satisfied" or len(gate["endorsementIds"]) != 2 or any(name.startswith("revocations/") for name in files):
            fail("UNUSED_GATE_EXPECTATION_INVALID")
    else:
        revocations = [name for name in files if name.startswith("revocations/")]
        if len(revocations) != 1 or gate["status"] != "revoked":
            fail("UNUSED_RETIREMENT_UNVERIFIED_NO_RETRY")
        revocation = json.loads(files[revocations[0]], object_pairs_hook=unique)
        old_gate = json.loads(retired["gate-gate.json"], object_pairs_hook=unique)
        expected_gate = {**old_gate, "status": "revoked", "updatedAt": revocation["createdAt"], "revocationId": revocation["id"]}
        if gate != expected_gate or revocations[0] != "revocations/" + revocation["id"] + ".json" or set(revocation) != {"schemaVersion", "id", "gateId", "actor", "reason", "createdAt"} or revocation["schemaVersion"] != "gatehouse.revocation.v0" or revocation["gateId"] != gate_id or revocation["actor"] != {"id": signing["bindings"]["review"]["ownerPrincipalId"], "kind": "human"} or revocation["reason"] != expected["reason"]:
            fail("UNUSED_RETIREMENT_UNVERIFIED_NO_RETRY")
        unchanged = {name: data for name, data in result.items() if name != "gate-gate.json" and not name.startswith("gate-revocations__")}
        old_unchanged = {name: data for name, data in retired.items() if name.startswith("gate-") and name != "gate-gate.json"}
        if unchanged != old_unchanged:
            fail("UNUSED_RETIREMENT_HISTORY_CHANGED_NO_RETRY")
    return result


STAGED_OWNER = (995, 985)


def verify_unprepared_replica(root, entries, config, base):
    expected = {".git/HEAD": (b"ref: refs/heads/main\n", 0o600), ".git/config": (config, 0o600), ".git/gr-publication-base.bundle": (base, 0o600)}
    directories = {"", ".git", ".git/objects", ".git/objects/info", ".git/objects/pack", ".git/refs", ".git/refs/heads", ".git/info"}
    for name, content, mode in entries:
        if name == "corpus/review-corpus.json":
            expected[".git/gr-publication-source.json"] = (content, 0o600)
        elif name == "tree-proof.json":
            expected[".git/gr-publication-proof.json"] = (content, 0o600)
        elif name.startswith("corpus/"):
            expected[name[7:]] = (content, 0o700 if mode & 0o111 else 0o600)
    for name in expected:
        parent = os.path.dirname(name)
        while parent:
            directories.add(parent)
            parent = os.path.dirname(parent)

    def visit(fd, relative):
        s = os.fstat(fd)
        if not stat.S_ISDIR(s.st_mode) or (s.st_uid, s.st_gid) != STAGED_OWNER or stat.S_IMODE(s.st_mode) != 0o700:
            fail("HELD_REPLICA_METADATA_INVALID")
        names = {p[len(relative) + (1 if relative else 0):].split("/", 1)[0] for p in set(expected) | directories if p != relative and (not relative or p.startswith(relative + "/"))}
        names.discard("")
        if set(os.listdir(fd)) != names:
            fail("HELD_REPLICA_NOT_PRISTINE")
        for name in sorted(names):
            path = relative + "/" + name if relative else name
            child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | (os.O_DIRECTORY if path in directories else 0), dir_fd=fd)
            try:
                if path in directories:
                    visit(child, path)
                else:
                    before = os.fstat(child)
                    data, mode = expected[path]
                    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or (before.st_uid, before.st_gid) != STAGED_OWNER or stat.S_IMODE(before.st_mode) != mode or before.st_size != len(data):
                        fail("HELD_REPLICA_METADATA_INVALID")
                    with os.fdopen(os.dup(child), "rb") as f:
                        actual = f.read(len(data) + 1)
                    if actual != data:
                        fail("HELD_REPLICA_BYTES_CHANGED")
                    after, named = os.fstat(child), os.stat(name, dir_fd=fd, follow_symlinks=False)
                    if (before.st_dev, before.st_ino, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_ctime_ns) or (before.st_dev, before.st_ino, before.st_ctime_ns) != (named.st_dev, named.st_ino, named.st_ctime_ns):
                        fail("HELD_REPLICA_CHANGED")
            finally:
                os.close(child)
        after = os.fstat(fd)
        if (s.st_dev, s.st_ino, s.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_ctime_ns):
            fail("HELD_REPLICA_CHANGED")

    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        visit(fd, "")
        named, held = os.lstat(root), os.fstat(fd)
        if (named.st_dev, named.st_ino) != (held.st_dev, held.st_ino):
            fail("HELD_REPLICA_CHANGED")
    finally:
        os.close(fd)


def held_preparation(request, auth, corpus):
    expectation = request["heldPreparation"]
    failed_digest = expectation["request"]["digest"]
    failed = json.loads(auth["read"](expectation["request"]["source"], 1000, 16384, failed_digest), object_pairs_hook=unique)
    old_policy, old_data, entries, base = prepare(failed, auth, corpus, historical=True)
    if "heldPreparation" in failed or failed.get("expectedInstallation") != request["expectedInstallation"]:
        fail("HELD_ANCESTOR_MISMATCH")
    policy = json.loads(auth["read"](request["policy"]["source"], 1000, 65536, request["policy"]["digest"]), object_pairs_hook=unique)
    if policy["expectedCandidateTree"] == old_policy["expectedCandidateTree"] or policy["ownerAuth"]["sessionId"] == old_policy["ownerAuth"]["sessionId"] or datetime.fromisoformat(request["createdAt"].replace("Z", "+00:00")).timestamp() <= datetime.fromisoformat(failed["createdAt"].replace("Z", "+00:00")).timestamp():
        fail("FRESH_HELD_SUCCESSOR_REQUIRED")
    claim = CLAIMS + "/" + failed_digest[7:]
    lock = CLAIMS + "/.transition"
    fd = auth["directory"](claim)
    os.close(fd)
    if set(os.listdir(claim)) - {"reservation.json", "previous-executable", "previous-policy.json", "reconciliation"} or os.path.lexists(READBACK + "/" + failed_digest[7:]):
        fail("HELD_COMPLETION_OR_EXTRA_STATE")
    reservation = json.loads(auth["read"](claim + "/reservation.json", 0, 16384, expectation["reservationDigest"], True), object_pairs_hook=unique)
    if reservation != {"requestDigest": failed_digest, "outcome": "outcome-unknown"}:
        fail("HELD_RESERVATION_MISMATCH")
    previous_installation(failed, auth, backup=claim)
    current = (auth["read"](EXECUTABLE, 0, 256 * 1024 ** 2, failed["executable"]["digest"], True), auth["read"](POLICY, 0, 65536, failed["policy"]["digest"], True))
    s = os.lstat(lock)
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or stat.S_IMODE(s.st_mode) != 0o700 or (s.st_dev, s.st_ino) != (expectation["lockDevice"], expectation["lockInode"]) or os.listdir(lock) != ["child.json"]:
        fail("HELD_LOCK_MISMATCH")
    child = json.loads(auth["read"](lock + "/child.json", 0, 4096, expectation["delegationDigest"], True), object_pairs_hook=unique)
    if any(child.get(k) != v for k, v in {"schema": "gr.owner-publication.child.v0", "operation": "prepare-source", "policyDigest": failed["policy"]["digest"], "root": old_policy["custody"]["root"], "candidateTree": old_policy["expectedCandidateTree"], "lockDevice": s.st_dev, "lockInode": s.st_ino}.items()):
        fail("HELD_DELEGATION_MISMATCH")
    with open("/proc/sys/kernel/random/boot_id", "r") as f:
        if child["bootId"] != f.read(64).strip():
            fail("HELD_BOOT_CHANGED")
    # Explicit owner reconciliation only, never age/PID-based automatic reclaim.
    for key in ["parentPid", "childPid"]:
        pid = child[key]
        if type(pid) is not int or pid <= 1:
            fail("HELD_PROCESS_INVALID")
        try:
            fd = os.pidfd_open(pid)
        except ProcessLookupError:
            continue
        else:
            os.close(fd)
            fail("HELD_PROCESS_STILL_PRESENT")
    verify_unprepared_replica(old_policy["custody"]["root"], entries, old_data["gitConfig"], base)
    return current, claim


def assert_reconciled_installation(request, auth):
    pinned = request["heldPreparation"]["request"]
    failed = json.loads(auth["read"](pinned["source"], 1000, 16384, pinned["digest"]), object_pairs_hook=unique)
    auth["read"](EXECUTABLE, 0, 256 * 1024 ** 2, failed["executable"]["digest"], True)
    auth["read"](POLICY, 0, 65536, failed["policy"]["digest"], True)


def install_from_held(request, digest, auth, corpus):
    if _active_transition is not None:
        fail("PUBLICATION_TRANSITION_REQUIRED")
    prepare(request, auth, corpus)
    current, claim = held_preparation(request, auth, corpus)
    recovery = claim + "/reconciliation"
    # Create-only ownership serializes explicit reconcilers while the old global
    # fence continues to block ordinary writers. Any partial transition stays held.
    os.mkdir(recovery, 0o700)
    fd = auth["directory"](claim)
    os.fsync(fd)
    os.close(fd)
    auth["record"](recovery + "/reservation.json", {"schema": "gr.owner-publication.held-successor.v0", "requestDigest": digest, "failedRequestDigest": request["heldPreparation"]["request"]["digest"], "outcome": "outcome-unknown"})
    held_preparation(request, auth, corpus)
    lock = CLAIMS + "/.transition"
    previous = recovery + "/previous-transition"
    os.mkdir(previous, 0o700)
    s = os.lstat(lock)
    auth["record"](previous + "/lock.json", {"device": s.st_dev, "inode": s.st_ino, "uid": s.st_uid, "gid": s.st_gid, "mode": stat.S_IMODE(s.st_mode), "delegationDigest": request["heldPreparation"]["delegationDigest"]})
    # Keep the global fence named throughout. Preserve the original child bytes
    # and old fence metadata, not an archive-to-mkdir gap another writer can win.
    os.rename(lock + "/child.json", previous + "/child.json")
    for parent in [lock, previous, recovery]:
        fd = auth["directory"](parent)
        os.fsync(fd)
        os.close(fd)
    identity = (request["heldPreparation"]["lockDevice"], request["heldPreparation"]["lockInode"])
    with publication_transition(auth, retained_identity=identity):
        value = install_locked(request, digest, auth, corpus, reconciled=current)
        auth["record"](recovery + "/completed.json", {"schema": "gr.owner-publication.held-successor.v0", "requestDigest": digest, "failedRequestDigest": request["heldPreparation"]["request"]["digest"], "classification": "pre-gr-preparation", "preparedDigest": value["preparedDigest"], "outcome": "completed"})
    return value


@contextmanager
def publication_transition(auth, retained_identity=None):
    global _active_transition
    parent = auth["directory"](CLAIMS, True)
    lock = CLAIMS + "/.transition"
    try:
        if retained_identity is None:
            try:
                os.mkdir(".transition", 0o755, dir_fd=parent)
            except FileExistsError:
                fail("PUBLICATION_TRANSITION_HELD_NO_RETRY")
        held = os.open(".transition", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        if retained_identity is not None:
            s = os.fstat(held)
            if (s.st_dev, s.st_ino) != retained_identity or s.st_uid != 0 or stat.S_IMODE(s.st_mode) != 0o700 or os.listdir(held):
                os.close(held)
                fail("HELD_LOCK_MISMATCH")
        # The native child must traverse this public delegation directory even
        # under the required private umask; it must never gain write permission.
        os.fchmod(held, 0o755)
        os.fsync(held)
        identity = os.fstat(held)
        os.fsync(parent)
        _active_transition = (os.getpid(), held)
        try:
            yield
        except BaseException:
            raise
        else:
            named = os.lstat(lock)
            if (named.st_dev, named.st_ino) != (identity.st_dev, identity.st_ino):
                fail("PUBLICATION_TRANSITION_CHANGED")
            # Only non-secret child identity is readable; authority is the exact
            # root-created PID/start/boot/policy binding, not possession of bytes.
            if "child.json" in os.listdir(held):
                os.unlink("child.json", dir_fd=held)
            os.rmdir(".transition", dir_fd=parent)
            os.fsync(parent)
        finally:
            _active_transition = None
            os.close(held)
    finally:
        os.close(parent)


def install(request, digest, auth, corpus):
    with publication_transition(auth):
        return install_locked(request, digest, auth, corpus)


def install_locked(request, digest, auth, corpus, reconciled=None):
    if _active_transition is None or _active_transition[0] != os.getpid():
        fail("PUBLICATION_TRANSITION_REQUIRED")
    held, named = os.fstat(_active_transition[1]), os.lstat(CLAIMS + "/.transition")
    if (held.st_dev, held.st_ino) != (named.st_dev, named.st_ino):
        fail("PUBLICATION_TRANSITION_CHANGED")
    policy, data, entries, base_bytes = prepare(request, auth, corpus)
    target_root = policy["custody"]["root"]
    successor = "expectedInstallation" in request
    if ("heldPreparation" in request) != (reconciled is not None):
        fail("HELD_SUCCESSOR_MODE_REQUIRED")
    previous = reconciled if reconciled is not None else (previous_installation(request, auth) if successor else None)
    if reconciled is not None:
        assert_reconciled_installation(request, auth)
    if os.path.lexists(target_root) or (not successor and any(os.path.lexists(p) for p in [EXECUTABLE, POLICY])):
        fail("EXISTING_TARGET_NO_REPLAY")
    for parent in [CLAIMS, READBACK, os.path.dirname(ROOT), os.path.dirname(EXECUTABLE), os.path.dirname(POLICY)]:
        fd = auth["directory"](parent, True)
        os.close(fd)
    claim, public = CLAIMS + "/" + digest[7:], READBACK + "/" + digest[7:]
    os.mkdir(claim, 0o700)
    fd = auth["directory"](CLAIMS)
    os.fsync(fd)
    os.close(fd)
    auth["record"](claim + "/reservation.json", {"requestDigest": digest, "outcome": "outcome-unknown"})
    if previous:
        auth["write"](claim + "/previous-executable", previous[0], 0o400)
        auth["write"](claim + "/previous-policy.json", previous[1], 0o400)
    completed_history = None
    if "expectedCompletedExecution" in request:
        predecessor = json.loads(auth["read"](READBACK + "/" + request["expectedInstallation"]["requestDigest"][7:] + "/completed.json", 0, 65536, protected=True), object_pairs_hook=unique)
        completed_history = completed_execution(request, auth, predecessor)
        for name, content in completed_history.items():
            auth["write"](claim + "/completed-predecessor-" + name, content, 0o400)
    expired = None
    if any(k in request for k in ["expectedExpiredExecution", "expectedUnusedExecution"]):
        predecessor = json.loads(auth["read"](READBACK + "/" + request["expectedInstallation"]["requestDigest"][7:] + "/completed.json", 0, 65536, protected=True), object_pairs_hook=unique)
        expired = expired_execution(request, auth, predecessor)
        for name, content in expired.items():
            auth["write"](claim + "/previous-execution-" + name, content, 0o400)
    # A successor gets a NEW replica. Completed/failed replicas are never adopted.
    os.mkdir(target_root, 0o700)
    fd = auth["directory"](os.path.dirname(target_root))
    os.fsync(fd)
    os.close(fd)
    for part in [".git", ".git/objects", ".git/objects/info", ".git/objects/pack", ".git/refs", ".git/refs/heads", ".git/info"]:
        os.mkdir(target_root + "/" + part, 0o700)
    auth["write"](target_root + "/.git/HEAD", b"ref: refs/heads/main\n", 0o600)
    auth["write"](target_root + "/.git/config", data["gitConfig"], 0o600)
    auth["write"](target_root + "/.git/gr-publication-base.bundle", base_bytes, 0o600)
    for name, content, mode in entries:
        if name == "corpus/review-corpus.json":
            auth["write"](target_root + "/.git/gr-publication-source.json", content, 0o600)
            continue
        if name == "tree-proof.json":
            auth["write"](target_root + "/.git/gr-publication-proof.json", content, 0o600)
            continue
        if not name.startswith("corpus/"):
            continue
        target = target_root + "/" + name[len("corpus/"):]
        fd = auth["directory"](os.path.dirname(target), True)
        os.close(fd)
        auth["write"](target, content, 0o700 if mode & 0o111 else 0o600)
    if successor:
        if reconciled is not None:
            assert_reconciled_installation(request, auth)
        else:
            previous_installation(request, auth)
        for target, content, mode in [(EXECUTABLE, data["executable"], 0o555), (POLICY, data["policy"], 0o644)]:
            pending = target + ".pending-" + digest[7:]
            auth["write"](pending, content, mode)
            os.replace(pending, target)
            d = auth["directory"](os.path.dirname(target))
            os.fsync(d)
            os.close(d)
    else:
        auth["write"](EXECUTABLE, data["executable"], 0o555)
        auth["write"](POLICY, data["policy"], 0o644)
    # No untrusted writer before handoff; same-UID consumers must themselves be
    # admitted, as required by existing native custody. Never follow a symlink.
    def handoff(path):
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for name in os.listdir(fd):
                s = os.stat(name, dir_fd=fd, follow_symlinks=False)
                if stat.S_ISDIR(s.st_mode):
                    handoff(path + "/" + name)
                elif not stat.S_ISREG(s.st_mode) or s.st_nlink != 1:
                    fail("STAGED_ENTRY_INVALID")
                os.chown(name, 995, 985, dir_fd=fd, follow_symlinks=False)
            os.fchown(fd, 995, 985)
            os.fchmod(fd, 0o700)
            os.fsync(fd)
        finally:
            os.close(fd)
    handoff(target_root)
    auth["read"](EXECUTABLE, 0, 256 * 1024 ** 2, request["executable"]["digest"], True)
    auth["read"](POLICY, 0, 65536, request["policy"]["digest"], True)
    result = native_prepare(auth)
    auth["read"](EXECUTABLE, 0, 256 * 1024 ** 2, request["executable"]["digest"], True)
    auth["read"](POLICY, 0, 65536, request["policy"]["digest"], True)
    named = os.lstat(CLAIMS + "/.transition")
    if (held.st_dev, held.st_ino) != (named.st_dev, named.st_ino):
        fail("PUBLICATION_TRANSITION_CHANGED")
    if result.get("schema") != "gr.campaign-publication-preparation.v0" or result.get("outcome") != "completed" or any(result.get(k) is not False for k in ["authorityGranted", "commitPerformed", "pushPerformed"]):
        fail("PREPARATION_RESULT_INVALID")
    plan, manifest = result["plan"], result["manifest"]
    if plan["repository"]["root"] != target_root or plan["campaignId"] != policy["campaign"]["id"] or plan["scope"]["paths"] != policy["campaign"]["paths"] or plan["scope"]["commits"] != policy["campaign"]["commits"] or plan["policy"].get("publication") != policy["campaign"].get("publication") or plan["base"]["commit"]["oid"] != policy["baseCommit"] or plan["frozen"]["candidateTree"]["oid"] != policy["expectedCandidateTree"] or manifest["campaignFingerprint"] != plan["campaignFingerprint"] or manifest["candidateTree"] != policy["expectedCandidateTree"]:
        fail("PREPARATION_BINDING_INVALID")
    corpus["verify_tree_proof"](result["treeProof"], manifest)
    if completed_history is not None:
        if result.get("retainedPrefix") != policy["retainedPrefix"] or completed_execution(request, auth, predecessor) != completed_history:
            fail("COMPLETED_PREDECESSOR_CHANGED_NO_RETRY")
    retired = None
    if expired is not None:
        if "expectedUnusedExecution" in request:
            retired = expired_execution(request, auth, predecessor, retired=expired)
            if any(retired.get(name) != data for name, data in expired.items() if not name.startswith("gate-")):
                fail("UNUSED_EXECUTION_CHANGED_NO_RETRY")
            retirement = result.get("retirement")
            if not isinstance(retirement, dict) or retirement.get("schema") != "gr.campaign-unused-retirement.v0" or retirement.get("outcome") != "completed" or any(retirement.get(k) is not False for k in ["authorityGranted", "commitPerformed", "pushPerformed"]) or retirement.get("revocation") != json.loads(next(data for name, data in retired.items() if name.startswith("gate-revocations__")), object_pairs_hook=unique):
                fail("UNUSED_RETIREMENT_RESULT_INVALID")
            for name, content in retired.items():
                auth["write"](claim + "/retired-execution-" + name, content, 0o400)
        elif expired_execution(request, auth, predecessor) != expired:
            fail("EXPIRED_EXECUTION_CHANGED_NO_RETRY")
    prepared = (json.dumps(result, indent=2) + "\n").encode()
    os.mkdir(public, 0o700)
    auth["write"](public + "/prepared.json", prepared, 0o444)
    receipt = {"schema": "gr.owner-publication.install-result.v0", "requestDigest": digest, "executableDigest": request["executable"]["digest"], "policyDigest": request["policy"]["digest"], "root": target_root, "prepared": public + "/prepared.json", "preparedDigest": sha(prepared), "campaignFingerprint": plan["campaignFingerprint"], "candidateTree": manifest["candidateTree"], "baseCommit": policy["baseCommit"], "authSession": policy["ownerAuth"]["sessionId"], "preparationGitExecuted": True, "commitPerformed": False, "pushPerformed": False, "publicationExecutionAdmitted": False, "signingGranted": False, "campaignApproved": False, "outcome": "completed", "completedAtUnix": time.time()}
    if expired is not None:
        receipt["previousUnusedExecution" if "expectedUnusedExecution" in request else "previousExpiredExecution"] = request.get("expectedUnusedExecution", request.get("expectedExpiredExecution"))
        if retired is not None:
            receipt["retirement"] = result["retirement"]
        receipt["previousExecutionPreserved"] = True
    if completed_history is not None:
        receipt["previousCompletedExecution"] = request["expectedCompletedExecution"]
        receipt["retainedPrefix"] = result["retainedPrefix"]
        receipt["previousExecutionPreserved"] = True
    if successor:
        receipt["previousRequestDigest"] = request["heldPreparation"]["request"]["digest"] if reconciled is not None else request["expectedInstallation"]["requestDigest"]
    auth["record"](claim + "/completed.json", receipt)
    auth["write"](public + "/completed.json", (json.dumps(receipt) + "\n").encode(), 0o444)
    fd = auth["directory"](public)
    os.fchmod(fd, 0o555)
    os.fsync(fd)
    os.close(fd)
    for parent in [CLAIMS, READBACK, os.path.dirname(ROOT), os.path.dirname(EXECUTABLE), os.path.dirname(POLICY)]:
        fd = auth["directory"](parent)
        os.fsync(fd)
        os.close(fd)
    return receipt


def main(args):
    if len(args) != 3 or args[0] not in ["--validate", "admit-and-prepare", "admit-successor-and-prepare", "admit-held-successor-and-prepare", "admit-expired-execution-successor-and-prepare", "admit-unused-execution-successor-and-prepare", "admit-completed-execution-successor-and-prepare"] or not re.fullmatch(r"sha256:[a-f0-9]{64}", args[2]):
        fail("ARGUMENTS_INVALID")
    mode, file, digest = args
    if mode != "--validate" and (os.getuid() != 0 or os.geteuid() != 0):
        fail("PERSONAL_OWNER_ROOT_REQUIRED")
    if mode != "--validate" and (not all(os.isatty(fd) for fd in [0, 2]) or any(k in os.environ for k in ["BUN_OPTIONS", "NODE_OPTIONS", "LD_PRELOAD", "LD_LIBRARY_PATH", "PYTHONPATH", "PYTHONHOME", "SSH_AUTH_SOCK"])):
        fail("PERSONAL_OWNER_CLEAN_TERMINAL_REQUIRED")
    raw = capture(file, digest, 16384)
    request = json.loads(raw, object_pairs_hook=unique)
    validate_request(request)
    if mode != "--validate" and (("expectedInstallation" in request) != (mode in ["admit-successor-and-prepare", "admit-held-successor-and-prepare", "admit-expired-execution-successor-and-prepare", "admit-unused-execution-successor-and-prepare", "admit-completed-execution-successor-and-prepare"]) or ("heldPreparation" in request) != (mode == "admit-held-successor-and-prepare") or ("expectedExpiredExecution" in request) != (mode == "admit-expired-execution-successor-and-prepare") or ("expectedUnusedExecution" in request) != (mode == "admit-unused-execution-successor-and-prepare") or ("expectedCompletedExecution" in request) != (mode == "admit-completed-execution-successor-and-prepare")):
        fail("SUCCESSOR_MODE_REQUIRED")
    auth, corpus = libraries(request["sourceModules"])
    prepare(request, auth, corpus)
    if "heldPreparation" in request:
        held_preparation(request, auth, corpus)
    elif "expectedInstallation" in request:
        previous_installation(request, auth)
    if mode == "--validate":
        return {"schema": "gr.owner-publication.install-validation.v0", "requestDigest": digest, "nativeEffects": False}
    space = os.statvfs("/var/lib/reliverse")
    if space.f_bavail * space.f_frsize < 256 * 1024 ** 2:
        fail("INSUFFICIENT_SPACE")
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    return install_from_held(request, digest, auth, corpus) if "heldPreparation" in request else install(request, digest, auth, corpus)


if __name__ == "__main__":
    try:
        print(json.dumps(main(sys.argv[1:])))
    except BaseException:
        print("GR_OWNER_PUBLICATION_PREPARATION_HELD_NO_RETRY", file=sys.stderr)
        sys.exit(1)

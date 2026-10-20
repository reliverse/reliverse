import {
  GR_REVIEW_MAX_LIFETIME_MS,
  GR_REVIEW_BRIDGE_EXECUTABLE,
  GR_REVIEW_BRIDGE_POLICY,
  GR_REVIEW_BRIDGE_RUNTIME,
  GR_REVIEW_BRIDGE_APPARMOR,
  assertGrNativeReviewHostPath,
} from "./native-review-bridge";

/** Installation/start are separate owner actions. No enablement target, restart,
 * TCP listener or provider/Git credential load. Policies remain bounded to two hours. */
export function renderGrNativeReviewService(host: { readonly producerHome: string }) {
  const producerHome = assertGrNativeReviewHostPath(host.producerHome);
  const service = `[Unit]
Description=Bounded exact-Gate GR native review inspection
Requires=reliverse-gr-native-review-reviewer.socket reliverse-gr-native-review-owner.socket
StartLimitIntervalSec=3600
StartLimitBurst=1
ConditionPathExists=${GR_REVIEW_BRIDGE_POLICY}

[Service]
Type=simple
User=root
Group=root
SupplementaryGroups=
ExecStart=${GR_REVIEW_BRIDGE_EXECUTABLE} start
WorkingDirectory=/
Restart=no
RuntimeMaxSec=${GR_REVIEW_MAX_LIFETIME_MS / 1000}
TimeoutStopSec=5
KillMode=control-group
Sockets=reliverse-gr-native-review-reviewer.socket reliverse-gr-native-review-owner.socket
RuntimeDirectory=reliverse-gr-native-review
RuntimeDirectoryMode=0755
NoNewPrivileges=yes
AppArmorProfile=${GR_REVIEW_BRIDGE_APPARMOR}
CapabilityBoundingSet=CAP_SYS_PTRACE CAP_DAC_READ_SEARCH
AmbientCapabilities=
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=yes
PrivateDevices=yes
PrivateNetwork=yes
ProtectProc=invisible
ProcSubset=pid
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
RestrictNamespaces=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictAddressFamilies=AF_UNIX
SystemCallArchitectures=native
SystemCallFilter=~@mount @reboot @swap @raw-io @module ptrace process_vm_readv process_vm_writev
ReadWritePaths=/var/lib/reliverse/gr/native-review
InaccessiblePaths=-/root -${producerHome}/.ssh -${producerHome}/dev -${producerHome}/Downloads -/var/lib/reliverse/gr/credentials -/var/lib/reliverse/gr/auth
LimitCORE=0
UMask=0077
TasksMax=32
MemoryMax=512M
CPUQuota=50%
UnsetEnvironment=BUN_OPTIONS NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH SSH_AUTH_SOCK CREDENTIALS_DIRECTORY HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
`;
  const socket = (role: "owner" | "reviewer") => `[Unit]
Description=Exact-Gate GR ${role} metadata socket
PartOf=reliverse-gr-native-review.service
StopWhenUnneeded=yes

[Socket]
ListenStream=${GR_REVIEW_BRIDGE_RUNTIME}/${role}.sock
SocketUser=${role === "reviewer" ? "reliverse-zed-b" : "reliverse-owner-control"}
SocketMode=0600
DirectoryMode=0755
FileDescriptorName=${role}
Service=reliverse-gr-native-review.service
RemoveOnStop=yes
`;
  // AppArmor mediates file-content access separately from getattr/lstat. Deny
  // all reviewer credential contents (including renamed files in that subtree),
  // while retaining directory traversal and metadata inspection. No optional
  // profile prefix: unsupported/unloaded policy must fail service startup.
  const appArmor = `profile ${GR_REVIEW_BRIDGE_APPARMOR} flags=(attach_disconnected,mediate_deleted) {
  file,
  network unix,
  capability sys_ptrace,
  capability dac_read_search,
  ptrace (read) peer=unconfined,
  signal,
  deny /var/lib/reliverse/actors/**/campaign-reviewer-credential/private/?** rwmklx,
  deny /proc/**/mem rw,
}
`;
  return { service, reviewerSocket: socket("reviewer"), ownerSocket: socket("owner"), appArmor };
}

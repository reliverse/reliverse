import { expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink } from "node:fs/promises";
import { createServer, createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createGatehouseActionIntent,
  createGatehouseEndorsementSubmission,
  fingerprintGatehouseValue,
} from "@reliverse/gatehouse-protocol";
import { createGatehouseRuntime } from "@reliverse/gatehouse-runtime";
import type { createGrNativeReviewBridge, GrNativeReviewPeer } from "@reliverse/gr-action-runtime";

import {
  GR_REVIEW_MAX_LIFETIME_MS,
  startGrNativeReviewBridge,
  createGrNativeReviewConnectionHandler,
  assertGrNativeReviewAppArmor,
  assertGrNativeReviewHostPath,
  assertGrNativeReviewPrincipal,
  assertGrNativeReviewOwnerGateLock,
  inspectGrNativeUnlockedGate,
  inspectGrNativeCourierGate,
} from "./native-review-bridge";
import { connectGrNativeReview } from "./native-review-client";
import { renderGrNativeReviewService } from "./native-review-service";
import { runGrNativeReviewerSigning } from "./reviewer-signing-main";

async function unlockedGateFixture(run: (directory: string) => Promise<void>) {
  const home = await mkdtemp(path.join(tmpdir(), "gr-native-unlocked-gate-"));
  const directory = path.join(home, "gate");
  await mkdir(directory);
  try {
    await run(directory);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("unlocked native inspection returns a stable read without acquiring a lock", async () => {
  await unlockedGateFixture(async (directory) => {
    expect(await inspectGrNativeUnlockedGate(directory, async () => null)).toBeNull();
  });
});

test("reviewer/current reject an initially held lock before reading Gate data", async () => {
  await unlockedGateFixture(async (directory) => {
    await mkdir(path.join(directory, ".lock"));
    let read = false;
    await expect(
      inspectGrNativeUnlockedGate(directory, async () => {
        read = true;
        return null;
      }),
    ).rejects.toThrow();
    expect(read).toBe(false);
  });
});

test("reviewer/current reject a lock appearing after the initial unlocked check", async () => {
  await unlockedGateFixture(async (directory) => {
    await expect(
      inspectGrNativeUnlockedGate(directory, async () => {
        await mkdir(path.join(directory, ".lock"));
        return null;
      }),
    ).rejects.toThrow();
  });
});

test("unlocked native inspection rejects a transient writer through directory metadata", async () => {
  await unlockedGateFixture(async (directory) => {
    await expect(
      inspectGrNativeUnlockedGate(directory, async () => {
        await Bun.sleep(20);
        const lock = path.join(directory, ".lock");
        await mkdir(lock);
        await rm(lock, { recursive: true });
        return null;
      }),
    ).rejects.toThrow();
  });
});

test("unlocked native inspection rejects a replaced Gate directory", async () => {
  await unlockedGateFixture(async (directory) => {
    await expect(
      inspectGrNativeUnlockedGate(directory, async () => {
        await rename(directory, directory + ".old");
        await mkdir(directory);
        return null;
      }),
    ).rejects.toThrow();
  });
});

test("dangling lock symlinks and inspection failures never count as unlocked success", async () => {
  await unlockedGateFixture(async (directory) => {
    await symlink(path.join(directory, "missing"), path.join(directory, ".lock"));
    await expect(inspectGrNativeUnlockedGate(directory, async () => null)).rejects.toThrow();
  });
  await unlockedGateFixture(async (directory) => {
    await expect(
      inspectGrNativeUnlockedGate(directory, async () => {
        throw Object.assign(new Error("fixture read failure"), { code: "EACCES" });
      }),
    ).rejects.toThrow("fixture read failure");
  });
});

test("unlocked owner courier routes retain the complete optimistic read fence", async () => {
  const owner: GrNativeReviewPeer = {
    uid: 995,
    gid: 985,
    pid: process.pid,
    instance: `${process.pid}:5678`,
    executableDigest: `sha256:${"a".repeat(64)}`,
  };
  for (const race of [
    "none",
    "appearing-lock",
    "transient-lock",
    "directory-replacement",
    "read-error",
  ] as const) {
    await unlockedGateFixture(async (directory) => {
      const read = inspectGrNativeCourierGate(directory, owner, async (heldOwnerLock) => {
        expect(heldOwnerLock).toBe(false);
        if (race === "appearing-lock") await mkdir(path.join(directory, ".lock"));
        if (race === "transient-lock") {
          await Bun.sleep(20);
          await mkdir(path.join(directory, ".lock"));
          await rm(path.join(directory, ".lock"), { recursive: true });
        }
        if (race === "directory-replacement") {
          await rename(directory, directory + ".old");
          await mkdir(directory);
        }
        if (race === "read-error") throw Object.assign(Error("fixture denied"), { code: "EACCES" });
        return null;
      });
      if (race === "none") expect(await read).toBeNull();
      else await expect(read).rejects.toThrow();
    });
  }
});

test("owner routing never treats a present foreign, stale, or symlink lock as absent", async () => {
  const now = new Date("2026-10-19T23:00:00Z");
  const owner: GrNativeReviewPeer = {
    uid: 995,
    gid: 985,
    pid: process.pid,
    instance: `${process.pid}:5678`,
    executableDigest: `sha256:${"a".repeat(64)}`,
  };
  for (const kind of ["foreign", "stale", "symlink"] as const) {
    await unlockedGateFixture(async (directory) => {
      const lock = path.join(directory, ".lock");
      if (kind === "symlink") await symlink(path.join(directory, "missing"), lock);
      else await mkdir(lock);
      let checked = false;
      await expect(
        inspectGrNativeCourierGate(directory, owner, async (heldOwnerLock) => {
          checked = true;
          expect(heldOwnerLock).toBe(true);
          const stat = await lstat(lock);
          if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("invalid lock directory");
          assertGrNativeReviewOwnerGateLock(
            {
              id: "gatehouse_lock_11111111-1111-4111-8111-111111111111",
              pid: kind === "foreign" ? owner.pid + 1 : owner.pid,
              acquiredAt: new Date(now.getTime() - (kind === "stale" ? 30_000 : 0)).toISOString(),
              expiresAt: new Date(now.getTime() + (kind === "stale" ? 0 : 30_000)).toISOString(),
            },
            owner,
            now,
          );
          return null;
        }),
      ).rejects.toThrow();
      expect(checked).toBe(true);
    });
  }
});

test("courier verification admits only the current kernel owner's live canonical lock", () => {
  const now = new Date("2026-10-19T23:00:00Z");
  const owner: GrNativeReviewPeer = {
    uid: 995,
    gid: 985,
    pid: 1234,
    instance: "1234:5678",
    executableDigest: `sha256:${"a".repeat(64)}`,
  };
  const lock = {
    id: "gatehouse_lock_11111111-1111-4111-8111-111111111111",
    pid: owner.pid,
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
  };
  expect(() => assertGrNativeReviewOwnerGateLock(lock, owner, now)).not.toThrow();
  for (const peer of [
    undefined,
    { ...owner, uid: 994 as const, gid: 984 as const },
    { ...owner, pid: 9876 },
    { ...owner, instance: "9876:5678" },
  ])
    expect(() => assertGrNativeReviewOwnerGateLock(lock, peer, now)).toThrow();
  for (const changed of [
    { ...lock, pid: 9876 },
    { ...lock, id: "foreign" },
    { ...lock, expiresAt: now.toISOString() },
    { ...lock, expiresAt: new Date(now.getTime() + 60_000).toISOString() },
    { ...lock, acquiredAt: new Date(now.getTime() + 1).toISOString() },
    { ...lock, extra: true },
  ])
    expect(() => assertGrNativeReviewOwnerGateLock(changed, owner, now)).toThrow();
});

test("real Gatehouse submission holds its own lock while invoking the bridge verifier", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gr-native-gate-lock-"));
  const now = new Date("2026-10-19T23:00:00Z");
  const owner: GrNativeReviewPeer = {
    uid: 995,
    gid: 985,
    pid: process.pid,
    instance: `${process.pid}:5678`,
    executableDigest: `sha256:${"a".repeat(64)}`,
  };
  let checked = false;
  const runtime = createGatehouseRuntime({
    home,
    now: () => now,
    endorsementVerifier: {
      id: "fixture-native-owner-lock",
      verify: async ({ endorsement, gate }) => {
        const lock = JSON.parse(
          await readFile(path.join(home, "gates", gate.id, ".lock", "lock.json"), "utf8"),
        );
        assertGrNativeReviewOwnerGateLock(lock, owner, now);
        await expect(
          inspectGrNativeUnlockedGate(path.join(home, "gates", gate.id), async () => null),
        ).rejects.toThrow();
        expect(() => assertGrNativeReviewOwnerGateLock(lock, undefined, now)).toThrow();
        checked = true;
        return {
          ...endorsement,
          verification: {
            verifierId: "fixture-native-owner-lock",
            verifiedAt: now.toISOString(),
            evidenceDigest: fingerprintGatehouseValue("fixture-evidence"),
          },
        };
      },
    },
  });
  try {
    const human = { id: "principal.owner", kind: "human" as const };
    const intent = createGatehouseActionIntent({
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 120_000).toISOString(),
      action: { authorityImpact: "none", effectClass: "git.commit", kind: "gr.campaign.commit" },
      requester: human,
      actor: { id: "service.gr", kind: "service" },
      accountableSystem: { id: "service.gr", kind: "service" },
      target: { id: "repository.fixture", kind: "repository", parameters: { tree: "fixture" } },
      preconditions: { tree: "fixture" },
      requestedCapability: {
        capability: "gr.campaign.commit",
        executorClass: "gr.campaign.v0",
        maxAttempts: 1,
        scope: { tree: "fixture" },
      },
      policy: {
        id: "policy.fixture",
        digest: fingerprintGatehouseValue("fixture-policy"),
        authority: {
          kind: "all-of",
          independence: "distinct-perspectives",
          principalIds: [human.id],
        },
      },
      presentation: {
        title: "Fixture commit",
        summary: "Fixture only",
        consequences: ["No Git execution"],
      },
      reversibility: "reversible",
      risk: "high",
    });
    const gate = (await runtime.submitIntent(intent)).gate;
    await runtime.submitEndorsement(
      createGatehouseEndorsementSubmission({
        gateId: gate.id,
        intentDigest: intent.digest,
        principalId: human.id,
        credentialId: "credential.fixture",
        decision: "approve",
        issuedAt: now.toISOString(),
        expiresAt: intent.expiresAt,
        assurance: {
          profile: "fixture",
          evidenceDigest: fingerprintGatehouseValue("fixture-evidence"),
          deviceBound: false,
          userPresence: false,
          userVerification: false,
        },
        proof: { profile: "fixture", signature: () => "fixture-signature" },
      }),
    );
    expect(checked).toBe(true);
    expect((await runtime.inspectGate(gate.id))?.effectiveStatus).toBe("quorum-satisfied");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("native bridge accepts canonical UF principalKind, not an invented kind projection", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  for (const kind of ["human", "agent"] as const) {
    const expected = { id: `prn_${"1".repeat(32)}`, kind, digest };
    const value = {
      schema: "reliverse.principal.v0",
      id: expected.id,
      principalKind: kind,
      status: "active",
    };
    expect(() => assertGrNativeReviewPrincipal({ digest, value }, expected)).not.toThrow();
    for (const patch of [
      { principalKind: undefined, kind },
      { principalKind: kind === "human" ? "agent" : "human", kind },
      { status: "revoked" },
      { schema: "other" },
      { id: `prn_${"2".repeat(32)}` },
    ]) {
      expect(() =>
        assertGrNativeReviewPrincipal({ digest, value: { ...value, ...patch } }, expected),
      ).toThrow();
    }
    expect(() =>
      assertGrNativeReviewPrincipal({ digest: `sha256:${"b".repeat(64)}`, value }, expected),
    ).toThrow();
  }
});

const peer: GrNativeReviewPeer = {
  uid: 994,
  gid: 984,
  pid: 1234,
  instance: "1234:5678",
  executableDigest: `sha256:${"a".repeat(64)}`,
};
async function wire(
  run: (f: {
    connect: () => Promise<Socket>;
    calls: () => number;
    holds: () => number;
    seals: () => number;
  }) => Promise<void>,
  uid: 994 | 995 = 994,
  failPostPeer = false,
  failPublication = false,
) {
  const root = await mkdtemp(path.join(tmpdir(), "gr-native-wire-")),
    file = path.join(root, "socket");
  let calls = 0,
    holds = 0,
    seals = 0;
  const clients: Socket[] = [];
  const bridge = {
    connection: () =>
      Object.assign(
        async (r: { operation: string }) => {
          calls++;
          return { operation: r.operation };
        },
        {
          assertPublishable: () => {
            if (failPublication) throw Error("fixture concurrent hold after peer check");
          },
          hold: async () => {
            holds++;
          },
          seal: async () => {
            seals++;
          },
        },
      ),
  } as unknown as ReturnType<typeof createGrNativeReviewBridge>;
  const server = createServer(
    { allowHalfOpen: true },
    createGrNativeReviewConnectionHandler(
      bridge,
      async (_socket, observe) => {
        const result = await observe({ ...peer, uid, gid: uid === 994 ? 984 : 985 });
        if (failPostPeer) throw Error("fixture held-peer post-check failed");
        return result;
      },
      994,
    ),
  );
  await new Promise<void>((resolve, reject) => server.listen(file, resolve).once("error", reject));
  try {
    await run({
      connect: async () => {
        const c = createConnection(file);
        clients.push(c);
        c.on("error", () => {});
        await new Promise<void>((resolve, reject) =>
          c.once("connect", resolve).once("error", reject),
        );
        return c;
      },
      calls: () => calls,
      holds: () => holds,
      seals: () => seals,
    });
  } finally {
    for (const c of clients) c.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}
const readFrame = (socket: Socket) =>
  new Promise<string>((resolve, reject) => {
    let bytes = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Error("fixture timeout"));
    }, 2000);
    const data = (chunk: Buffer) => {
      bytes += chunk.toString();
      if (bytes.includes("\n")) {
        clearTimeout(timer);
        socket.off("data", data);
        resolve(bytes);
      }
    };
    socket.on("data", data);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve(bytes);
    });
  });
test("Unix protocol keeps the root-peer observation channel open after finish until client closes", () =>
  wire(async (f) => {
    const c = await f.connect();
    let read = readFrame(c);
    c.write('{"operation":"inspect"}\n');
    expect(JSON.parse(await read).result.operation).toBe("inspect");
    const endorsement = createGatehouseEndorsementSubmission({
      gateId: `gate_${"a".repeat(32)}`,
      intentDigest: `sha256:${"b".repeat(64)}`,
      principalId: `prn_${"c".repeat(32)}`,
      credentialId: "fixture",
      decision: "approve",
      issuedAt: "2026-10-18T20:00:00Z",
      expiresAt: "2026-10-18T21:00:00Z",
      assurance: {
        profile: "fixture",
        evidenceDigest: `sha256:${"d".repeat(64)}`,
        deviceBound: false,
        userPresence: false,
        userVerification: false,
      },
      proof: { profile: "fixture", signature: () => "fixture" },
    });
    read = readFrame(c);
    c.write(
      JSON.stringify({
        operation: "finish",
        nonce: "native_review_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        endorsement,
      }) + "\n",
    );
    expect(JSON.parse(await read).result.operation).toBe("finish");
    expect(c.destroyed).toBe(false);
    expect(f.calls()).toBe(2);
    expect(f.holds()).toBe(0);
    expect(f.seals()).toBe(1);
  }));
test("held-peer post-check failure never seals a finish response", () =>
  wire(
    async (f) => {
      const c = await f.connect(),
        read = readFrame(c);
      const endorsement = createGatehouseEndorsementSubmission({
        gateId: `gate_${"a".repeat(32)}`,
        intentDigest: `sha256:${"b".repeat(64)}`,
        principalId: `prn_${"c".repeat(32)}`,
        credentialId: "fixture",
        decision: "approve",
        issuedAt: "2026-10-18T20:00:00Z",
        expiresAt: "2026-10-18T21:00:00Z",
        assurance: {
          profile: "fixture",
          evidenceDigest: `sha256:${"d".repeat(64)}`,
          deviceBound: false,
          userPresence: false,
          userVerification: false,
        },
        proof: { profile: "fixture", signature: () => "fixture" },
      });
      c.write(
        JSON.stringify({
          operation: "finish",
          nonce: "native_review_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          endorsement,
        }) + "\n",
      );
      expect(await read).toContain('"ok":false');
      expect(f.calls()).toBe(1);
      expect(f.seals()).toBe(0);
      expect(f.holds()).toBeGreaterThan(0);
    },
    994,
    true,
  ));

test("publication invalidated during held-peer post-check never sends a success frame", () =>
  wire(
    async (f) => {
      const c = await f.connect(),
        read = readFrame(c);
      c.write('{"operation":"inspect"}\n');
      expect(await read).toContain('"ok":false');
      expect(f.calls()).toBe(1);
    },
    994,
    false,
    true,
  ));

test("caller identities, arbitrary paths and multiple frames cannot reach bridge core", () =>
  wire(async (f) => {
    for (const raw of [
      '{"operation":"inspect","pid":1234}\n',
      '{"operation":"inspect","path":"/etc/shadow"}\n',
      '{"operation":"inspect"}\n{"operation":"current"}\n',
    ]) {
      const c = await f.connect(),
        read = readFrame(c);
      c.write(raw);
      await read;
    }
    expect(f.calls()).toBe(0);
  }));
test("socket role cannot be replaced by claimed/kernel foreign UID", () =>
  wire(async (f) => {
    const c = await f.connect(),
      read = readFrame(c);
    c.write('{"operation":"inspect"}\n');
    const response = await read;
    expect(response).toContain('"ok":false');
    expect(f.calls()).toBe(0);
  }, 995));
test("source/producer cannot start privileged observer, connect as a native role or invoke signing", async () => {
  expect(await startGrNativeReviewBridge(["--identity"])).toMatchObject({
    signing: false,
    authorityGranted: false,
  });
  expect(await runGrNativeReviewerSigning(["--identity"])).toMatchObject({
    credentialCreation: false,
  });
  await expect(startGrNativeReviewBridge(["start"])).rejects.toThrow("NOT_ADMITTED");
  await expect(connectGrNativeReview("reviewer")).rejects.toThrow("CHANNEL_REFUSED");
  await expect(connectGrNativeReview("owner")).rejects.toThrow("CHANNEL_REFUSED");
  await expect(runGrNativeReviewerSigning(["approve"])).rejects.toThrow("NOT_ADMITTED");
});
test("native observer requires the exact enforcing AppArmor label without fallback", () => {
  assertGrNativeReviewAppArmor("reliverse-gr-native-review (enforce)\n");
  for (const label of [
    "",
    "unconfined",
    "reliverse-gr-native-review (complain)",
    "other (enforce)",
    "reliverse-gr-native-review//child (enforce)",
  ])
    expect(() => assertGrNativeReviewAppArmor(label)).toThrow("NOT_ADMITTED");
});

test("host-local native paths are explicit policy values, never environment or systemd injection", () => {
  expect(assertGrNativeReviewHostPath("/srv/identities/principals")).toBe(
    "/srv/identities/principals",
  );
  for (const value of [
    "/",
    "relative",
    "/srv/../etc",
    "/srv//actors",
    "/srv/operator\nExecStart=/bin/sh",
    "/home/%u",
    "/home/$USER",
    "/srv/*",
    "/srv/a b",
    "-/srv/actor",
  ]) {
    expect(() => assertGrNativeReviewHostPath(value)).toThrow("NOT_ADMITTED");
    expect(() => renderGrNativeReviewService({ producerHome: value })).toThrow("NOT_ADMITTED");
  }
});

test("service projection has bounded lifetime/read-sensitive capabilities and no enable/restart/TCP/Git route", () => {
  const { service, reviewerSocket, ownerSocket, appArmor } = renderGrNativeReviewService({
    producerHome: "/srv/actors/producer",
  });
  expect(service).toContain(
    "-/srv/actors/producer/.ssh -/srv/actors/producer/dev -/srv/actors/producer/Downloads",
  );
  for (const line of [
    "Restart=no",
    "RuntimeMaxSec=7200",
    "KillMode=control-group",
    "NoNewPrivileges=yes",
    "AppArmorProfile=reliverse-gr-native-review",
    "CapabilityBoundingSet=CAP_SYS_PTRACE CAP_DAC_READ_SEARCH",
    "RestrictAddressFamilies=AF_UNIX",
    "PrivateNetwork=yes",
    "ProtectSystem=strict",
    "MemoryMax=512M",
    "ReadWritePaths=/var/lib/reliverse/gr/native-review",
  ])
    expect(service).toContain(line);
  expect(GR_REVIEW_MAX_LIFETIME_MS).toBe(7_200_000);
  expect(service).toContain(`RuntimeMaxSec=${GR_REVIEW_MAX_LIFETIME_MS / 1000}\n`);
  expect(service).not.toContain("AppArmorProfile=-");
  expect(appArmor).toContain("profile reliverse-gr-native-review");
  expect(appArmor).toContain("private/?** rwmklx");
  expect(appArmor).not.toContain("flags=(complain");
  expect(service).not.toContain("[Install]");
  expect(service).not.toContain("LoadCredential");
  expect(service).not.toContain("ExecStart=/usr/bin/git");
  expect(reviewerSocket).toContain("SocketUser=reliverse-zed-b");
  expect(ownerSocket).toContain("SocketUser=reliverse-owner-control");
  for (const socket of [reviewerSocket, ownerSocket]) {
    expect(socket).toContain("SocketMode=0600");
    expect(socket).toContain("PartOf=reliverse-gr-native-review.service");
    expect(socket).toContain("StopWhenUnneeded=yes");
    expect(socket).toContain("RemoveOnStop=yes");
    expect(socket).not.toContain("[Install]");
  }
});

import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runGrGit } from "./git";

test("Git stdout and stderr preserve UTF-8 characters split across process chunks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gr-git-utf8-"));
  try {
    const file = path.join(root, "git");
    await writeFile(
      file,
      "#!" +
        process.execPath +
        "\n" +
        "const out=Buffer.from('└── closure або recovery\\n');const err=Buffer.from('помилка\\n');\n" +
        "for(let i=0;i<Math.max(out.length,err.length);i++){if(i<out.length)process.stdout.write(out.subarray(i,i+1));if(i<err.length)process.stderr.write(err.subarray(i,i+1));await Bun.sleep(3);}\n",
    );
    await chmod(file, 0o755);
    const result = await runGrGit(root, ["fixture"], {
      env: { PATH: root + path.delimiter + process.env.PATH },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("└── closure або recovery\n");
    expect(result.stderr).toBe("помилка\n");
    expect(result.stdout).not.toContain("�");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

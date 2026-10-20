import { runGrOwnerLaunch } from "./owner-launch";

try {
  console.log(JSON.stringify(await runGrOwnerLaunch(process.argv.slice(2))));
} catch {
  console.error("GR_OWNER_LAUNCH_HELD_NO_RETRY");
  process.exitCode = 1;
}

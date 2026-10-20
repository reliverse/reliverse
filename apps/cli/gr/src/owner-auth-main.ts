import { runGrOwnerAuthentication } from "./owner-auth";

try {
  console.log(JSON.stringify(await runGrOwnerAuthentication(process.argv.slice(2))));
} catch {
  console.error("GR_OWNER_AUTHENTICATION_HELD_NO_RETRY");
  process.exitCode = 1;
}

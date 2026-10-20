import { startGrNativeReviewBridge } from "./native-review-bridge";

try {
  const result = await startGrNativeReviewBridge(process.argv.slice(2));
  if (result && "schema" in result) console.log(JSON.stringify(result));
} catch {
  console.error("GR_NATIVE_REVIEW_STARTUP_REFUSED");
  process.exitCode = 1;
}

/**
 * Remotion CLI entry point. Resolved by `npx remotion render` and by the
 * spike runner at scripts/remotion-spike.ts via bundle({entryPoint: ...}).
 */
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);

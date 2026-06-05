/**
 * Remotion build config. Read by the CLI and by @remotion/bundler.
 *
 * Kept minimal for the spike — we'll tune codec + concurrency in Phase 3
 * (operational hardening) per ADR-001.
 */
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
// Match the root project's render-agent: 2/3 scale lets Chrome render at
// 720x1280 instead of full 1080x1920 → ~2x faster, near-identical output.
Config.setScale(1);
Config.setConcurrency(1);
// Output codec — h264 is the universal MP4 codec used downstream by FFmpeg.
Config.setCodec("h264");
// Quality — CRF 23 matches what video-merge.ts:587 currently uses for
// the drawtext re-encode pass. The Remotion output will then be muxed
// with audio (no re-encode of the video stream) via FFmpeg copy.
Config.setCrf(23);
// pixel format compatible with web players + downstream FFmpeg mux
Config.setPixelFormat("yuv420p");

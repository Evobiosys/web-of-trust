// @ts-check
// Browser entry: styles + boot + skin + open onboarding (the golden path start).

import "./styles.css";
import { bootApp } from "./app.js";
import { onb } from "./screens/onboarding.js";
import { getRuntimeConfig } from "./runtime_config.js";
import { applySkin } from "./skin.js";
import { getProfile } from "@resource-web/app-profiles";

const runtimeConfig = getRuntimeConfig();
const appCtx = bootApp({ mode: runtimeConfig.mode, agentUrl: runtimeConfig.agentUrl });
applySkin(getProfile(runtimeConfig.appId));
// Live mode boots its REST/WS connection immediately; fixture's start() is a
// no-op, so this is safe in both modes. (Onboarding also calls seed(), which
// live aliases to start() — start() is idempotent.)
appCtx.api.start();
onb("welcome");

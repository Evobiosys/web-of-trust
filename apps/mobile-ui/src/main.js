// @ts-check
// Browser entry: styles + boot + skin + open onboarding (the golden path start).

import "./styles.css";
import { bootApp } from "./app.js";
import { onb } from "./screens/onboarding.js";
import { getRuntimeConfig } from "./runtime_config.js";
import { applySkin } from "./skin.js";
import { getProfile } from "@resource-web/app-profiles";

const runtimeConfig = getRuntimeConfig();
bootApp({ mode: "fixture", agentUrl: runtimeConfig.agentUrl });
applySkin(getProfile(runtimeConfig.appId));
onb("welcome");

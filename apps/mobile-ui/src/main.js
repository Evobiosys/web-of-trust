// @ts-check
// Browser entry: styles + boot + open onboarding (the golden path start).

import "./styles.css";
import { bootApp } from "./app.js";
import { onb } from "./screens/onboarding.js";

bootApp({ mode: "fixture" });
onb("welcome");

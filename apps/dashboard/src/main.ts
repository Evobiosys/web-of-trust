import { isStepLabelMessage, parseConfig } from "./config";
import "./style.css";

const config = parseConfig(window.location.search);

const annaFrame = document.querySelector<HTMLIFrameElement>("#anna-frame");
const benFrame = document.querySelector<HTMLIFrameElement>("#ben-frame");
const stepLabel = document.querySelector<HTMLElement>("[data-testid='step-label']");

if (annaFrame) annaFrame.src = config.annaUrl;
if (benFrame) benFrame.src = config.benUrl;
if (stepLabel) stepLabel.textContent = config.step || "resource-web — dashboard";

window.addEventListener("message", (event: MessageEvent) => {
  if (isStepLabelMessage(event.data) && stepLabel) {
    stepLabel.textContent = event.data.text;
  }
});

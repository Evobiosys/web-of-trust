// @ts-check
// Presentational avatar gradients, keyed by person id. Shared by every screen
// that draws a person — not fixture/domain data, purely styling.

/** @type {Record<string, string>} */
export const AVA_GRADS = {
  maria: "linear-gradient(135deg,#FF715B,#9A37F0)",
  lucia: "linear-gradient(135deg,#12A8E3,#4FD7A0)",
  rafa: "linear-gradient(135deg,#9A37F0,#12A8E3)",
  tomas: "linear-gradient(135deg,#4FD7A0,#12A8E3)",
  bruno: "linear-gradient(135deg,#FF715B,#F2B25B)",
  sofia: "linear-gradient(135deg,#9A37F0,#FF715B)",
  nico: "linear-gradient(135deg,#0B5E80,#4FD7A0)",
};

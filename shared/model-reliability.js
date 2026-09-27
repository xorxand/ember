// Evidence applies to exact downloaded weights, never to model size or name alone.
const evidence = {
  "65ec06548149b04c096a120e4a6da9d4017ea809c91734ea5631e89f96ddc57b": {
    status: "unreliable",
    detail:
      "Repeatedly answered file-writing requests without executing tools in Ember. You can still select it, but check the execution summary.",
  },
  "2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd": {
    status: "verified",
    detail:
      "Passed basic tool-use checks in Ember, including a live file-read check on September 27, 2026. This does not guarantee success on every task.",
  },
};
const labels = {
  verified: "Agent verified",
  unreliable: "Tool use unreliable",
  chat: "Chat only",
  untested: "Untested",
};
export function modelReliability(model) {
  const known = model?.digest && evidence[model.digest.replace(/^sha256:/, "")];
  const result =
    known ||
    (Array.isArray(model?.capabilities) &&
    model.capabilities.length &&
    !model.capabilities.includes("tools")
      ? {
          status: "chat",
          detail:
            "This model does not advertise tool support. Choose a tool-capable model for project work.",
        }
      : {
          status: "untested",
          detail:
            "Tool-use reliability has not been verified for this model version. Tool support alone does not guarantee reliable execution.",
        });
  return { ...result, label: labels[result.status] };
}
export function sortAgentModels(models) {
  const order = { verified: 0, untested: 1, unreliable: 2, chat: 3 };
  return [...models].sort(
    (a, b) =>
      order[modelReliability(a).status] - order[modelReliability(b).status],
  );
}

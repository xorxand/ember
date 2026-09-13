export const approvalModes = {
  ask: "Ask every time",
  risky: "Ask for risky or unknown",
  always: "Always run",
};
export function normalizeApprovalPolicy(value, { inherit = false } = {}) {
  if (value === null && inherit) return null;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.hasOwn(approvalModes, value.mode)
  )
    throw new Error("Choose a valid approval policy.");
  const commands = value.trustedCommands ?? [];
  if (
    !Array.isArray(commands) ||
    commands.length > 40 ||
    commands.some(
      (c) =>
        typeof c !== "string" ||
        !c.trim() ||
        c.length > 8000 ||
        /[\r\n\0]/.test(c),
    )
  )
    throw new Error(
      "Enter up to 40 exact trusted commands, one per line (maximum 8,000 characters each).",
    );
  return {
    mode: value.mode,
    trustedCommands: [...new Set(commands.map((c) => c.trim()))],
  };
}
export function effectiveApprovalPolicy(task, project) {
  try {
    return normalizeApprovalPolicy(
      task?.approvalPolicy ?? project?.approvalPolicy ?? { mode: "ask" },
    );
  } catch {
    return { mode: "ask", trustedCommands: [] };
  }
}
// Only a documented set of ordinary text/source edits is permitted automatically.
// Configuration, executable, symlinked, and unrecognized files require review.
export function ordinaryProjectWrite(change) {
  if (
    change.content?.startsWith("#!") ||
    change.before?.startsWith("#!") ||
    (change.before?.trim() && change.content?.trim() === "")
  )
    return false;
  const file = change.path.replaceAll("\\", "/").toLowerCase();
  const parts = file.split("/");
  const base = parts.at(-1);
  if (
    change.requiresReview ||
    file.startsWith("/") ||
    parts.some(
      (p) =>
        p.startsWith(".") ||
        [
          "scripts",
          "bin",
          "hooks",
          "deploy",
          "deployment",
          "config",
          "configs",
        ].includes(p),
    )
  )
    return false;
  if (
    /^(makefile|dockerfile|jenkinsfile|procfile|setup\.py|conftest\.py|build\.rs)$/.test(
      base,
    ) ||
    /(?:^|[.\-_])(?:config|conf|rc)(?:[.\-_]|$)/.test(base)
  )
    return false;
  return /\.(?:txt|md|mdx|rst|go|rs|c|h|cc|cpp|hpp|java|kt|swift|js|jsx|ts|tsx|py|rb|html|css|scss|sass|less|vue|svelte)$/.test(
    base,
  );
}
export function approvalDecision(policy, kind, details) {
  if (policy.mode === "always")
    return { automatic: true, reason: "Always run is enabled for this task." };
  if (policy.mode === "risky") {
    if (kind === "write" && ordinaryProjectWrite(details))
      return {
        automatic: true,
        reason:
          "Ordinary project source/text edit allowed by the approval policy.",
      };
    if (
      kind === "command" &&
      policy.trustedCommands.includes(details.command.trim())
    )
      return {
        automatic: true,
        reason: "Exact command explicitly trusted by the approval policy.",
      };
    return {
      automatic: false,
      reason:
        kind === "write"
          ? "This file is executable, configuration, a script, symlinked, or an unrecognized type. Review required."
          : "This exact command is not trusted. Review required.",
    };
  }
  return {
    automatic: false,
    reason: "Ask every time is enabled for this task.",
  };
}

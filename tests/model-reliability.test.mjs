import test from "node:test";
import assert from "node:assert/strict";
import {
  modelReliability,
  sortAgentModels,
} from "../shared/model-reliability.js";
const verified = {
  name: "alias",
  digest: "2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd",
  capabilities: ["tools"],
};
const unreliable = {
  digest: "65ec06548149b04c096a120e4a6da9d4017ea809c91734ea5631e89f96ddc57b",
};
test("reliability follows exact weights, survives aliases and resets after updates", () => {
  assert.equal(modelReliability(verified).status, "verified");
  assert.equal(modelReliability(unreliable).status, "unreliable");
  assert.equal(
    modelReliability({ ...verified, digest: "new-version" }).status,
    "untested",
  );
  assert.equal(modelReliability({ name: "qwen2.5:1.5b" }).status, "untested");
  assert.equal(
    modelReliability({ ...verified, digest: `sha256:${verified.digest}` })
      .status,
    "verified",
  );
});
test("capability absence is unknown, explicit lack of tools is chat only; ranking preserves input", () => {
  const chat = { capabilities: ["completion"] },
    unknown = {};
  assert.equal(modelReliability(chat).status, "chat");
  assert.equal(modelReliability(unknown).status, "untested");
  assert.equal(modelReliability({ capabilities: [] }).status, "untested");
  const models = [chat, unreliable, unknown, verified];
  assert.deepEqual(sortAgentModels(models), [
    verified,
    unknown,
    unreliable,
    chat,
  ]);
  assert.equal(models[0], chat);
});

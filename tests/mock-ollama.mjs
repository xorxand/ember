import http from "node:http";
export async function mockOllama() {
  const models = [
    {
      name: "test-model:latest",
      size: 1_000_000_000,
      digest: "abc",
      modified_at: new Date().toISOString(),
      capabilities: ["completion", "tools"],
      details: { parameter_size: "1B", quantization_level: "Q4_K_M" },
    },
  ];
  const received = [];
  let pulls = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    received.push({ route: req.url, body });
    const json = (value) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
    };
    if (req.url === "/api/tags") return json({ models });
    if (req.url === "/api/version") return json({ version: "test.1" });
    if (req.url === "/api/ps") return json({ models: [] });
    if (req.url === "/api/show")
      return json({
        capabilities: ["completion", "tools"],
        details: models[0].details,
        license: "Test license",
      });
    if (req.url === "/api/delete") {
      const i = models.findIndex((m) => m.name === body.model);
      if (i >= 0) models.splice(i, 1);
      return json({});
    }
    if (req.url === "/api/generate") return json({ done: true });
    const emit = (value) => res.write(JSON.stringify(value) + "\n");
    res.setHeader("Content-Type", "application/x-ndjson");
    if (req.url === "/api/pull") {
      pulls++;
      if (body.model === "fail:latest") {
        emit({ error: "deliberate pull failure" });
        return res.end();
      }
      emit({ status: "pulling manifest" });
      let completed = 0;
      const interval = setInterval(() => {
        completed += 25;
        emit({
          status: "pulling layer",
          digest: "layer",
          total: 100,
          completed,
        });
        if (completed >= 100) {
          if (!models.some((m) => m.name === body.model))
            models.push({ ...models[0], name: body.model });
          emit({ status: "success" });
          res.end();
          clearInterval(interval);
        }
      }, 45);
      res.on("close", () => clearInterval(interval));
      return;
    }
    if (req.url === "/api/chat") {
      const user =
        body.messages.findLast(
          (m) =>
            m.role === "user" &&
            !m.content.startsWith("Ember execution check (automatic):"),
        )?.content || "";
      const last = body.messages.at(-1);
      if (
        body.tools &&
        user.includes("prose-recovery") &&
        !body.messages.some((m) => m.role === "tool") &&
        !body.messages[0].content.includes("Execution check:")
      ) {
        emit({
          message: {
            role: "assistant",
            content: "Here is the code. You can save it yourself.",
          },
          done: true,
        });
        return res.end();
      }
      if (
        body.tools &&
        user.includes("compile-recovery") &&
        body.messages.some(
          (m) => m.role === "tool" && m.tool_name === "write_file",
        ) &&
        !body.messages.some(
          (m) => m.role === "tool" && m.tool_name === "run_command",
        )
      ) {
        emit({
          message: body.messages[0].content.includes("Execution check:")
            ? {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    function: {
                      name: "run_command",
                      arguments: { command: "printf build-verified" },
                    },
                  },
                ],
              }
            : { role: "assistant", content: "Now you can compile it." },
          done: true,
        });
        return res.end();
      }
      if (
        body.tools &&
        !body.messages.some((m) => m.role === "tool") &&
        /write|command|escape/.test(user)
      ) {
        const name = user.includes("command") ? "run_command" : "write_file";
        const args =
          name === "run_command"
            ? {
                command: user.includes("slow-command")
                  ? "sleep 10"
                  : "printf agent-command-ok",
              }
            : {
                path: user.includes("escape") ? "../escape.txt" : "hello.txt",
                content: "Hello from the agent.\n",
              };
        emit({
          message: {
            role: "assistant",
            content: "I’ll propose the change.",
            tool_calls: [{ function: { name, arguments: args } }],
          },
          done: true,
        });
        res.end();
        return;
      }
      const content =
        last.role === "tool"
          ? `Tool result: ${last.content}`
          : `Hello from ${body.model}. Your local workspace is ready.`;
      const chunks = content.match(/.{1,8}/gs);
      let i = 0;
      const interval = setInterval(
        () => {
          emit({
            message: { role: "assistant", content: chunks[i++] || "" },
            done: false,
          });
          if (i >= chunks.length) {
            emit({
              message: { role: "assistant", content: "" },
              done: true,
              eval_count: 12,
              eval_duration: 1000000000,
              total_duration: 1200000000,
            });
            clearInterval(interval);
            res.end();
          }
        },
        user.includes("slow") ? 180 : 12,
      );
      res.on("close", () => clearInterval(interval));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    received,
    models,
    get pulls() {
      return pulls;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
export async function until(predicate, timeout = 7000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout)
      throw new Error("Timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 20));
  }
}

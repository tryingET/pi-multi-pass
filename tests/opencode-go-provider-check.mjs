import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = mkdtempSync(join(tmpdir(), "pi-multi-pass-opencode-go-"));

try {
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({
		"opencode-go": { type: "api_key", key: "test-base" },
		"opencode-go-2": { type: "api_key", key: "test-second" },
	}));

	const result = spawnSync(
		"pi",
		[
			"--mode",
			"rpc",
			"--offline",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-context-files",
			"--extension",
			join(root, "extensions", "multi-sub.ts"),
		],
		{
			cwd: root,
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: agentDir,
				MULTI_SUB: "opencode-go:2",
			},
			input: '{"id":"models","type":"get_available_models"}\n',
			encoding: "utf8",
			timeout: 15_000,
		},
	);

	assert.equal(result.error, undefined, result.error?.message);
	assert.equal(result.status, 0, result.stderr);
	assert.doesNotMatch(result.stdout, /"type":"extension_error"/, result.stdout);

	const response = result.stdout
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line))
		.find((event) => event.id === "models");
	assert.equal(response?.success, true, result.stdout);

	const models = response.data.models;
	const base = models.filter((model) => model.provider === "opencode-go");
	const second = models.filter((model) => model.provider === "opencode-go-2");
	assert.ok(base.length > 0, "missing built-in opencode-go models");
	assert.equal(second.length, base.length, "opencode-go-2 should mirror every built-in model");
	// OpenCode Go serves its models over three APIs at two base URLs
	// (/zen/go for Anthropic Messages, /zen/go/v1 for the OpenAI APIs); an
	// account's model must keep the built-in model's own endpoint and API.
	assert.ok(new Set(base.map((model) => model.baseUrl)).size > 1, "expected built-in models at more than one base URL");
	for (const model of base) {
		const clone = second.find((entry) => entry.id === model.id);
		assert.ok(clone, `opencode-go-2 lacks ${model.id}`);
		assert.equal(clone.baseUrl, model.baseUrl, `${model.id} baseUrl`);
		assert.equal(clone.api, model.api, `${model.id} api`);
	}

	console.log("OpenCode Go provider check passed");
} finally {
	rmSync(agentDir, { recursive: true, force: true });
}

# OKFgen

OKFgen generates portable [Open Knowledge Format (OKF) v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundles from your documentation, schemas, source code, and URLs. It uses [LangChain](https://js.langchain.com/) so you can choose a hosted open-source model, a local Ollama model, or a proprietary provider without changing the generation pipeline.

The npm package and installed command are both **`okfgen`**.

## What It Does

1. Collects source material from files, directories, or HTTP(S) URLs.
2. Detects an existing OKF v0.1 bundle at the output path and includes it as update context.
3. Sends a structured generation or improvement prompt to the selected LangChain chat model.
4. Parses the model response into a validated bundle plan.
5. Renders Markdown concepts with YAML frontmatter deterministically.
6. Creates progressive-disclosure `index.md` files and maintains an optional `log.md` history.
7. Validates the finished bundle against the OKF v0.1 conformance rules.
8. Optionally opens a searchable document explorer with an interactive relationship graph.

The model never writes files directly. This keeps frontmatter, paths, reserved filenames, and output boundaries under CLI control.

## Install

```bash
npm install -g okfgen
```

Node.js 20 or newer is required. For local development:

```bash
git clone https://github.com/Arindam200/OKFgen.git
cd OKFgen
npm install
npm run build
npm link
```

## Interactive Mode

Run `okfgen` with a terminal attached to open the interactive command center:

```bash
okfgen
```

The large OKFgen wordmark is shown only on the first interactive run. After that, startup stays compact. Every action in the persistent shell uses a slash command:

- `/generate [request]` starts the guided generation flow
- `/update [request]` refreshes the last generated bundle with its remembered sources
- `/view [directory]` opens a bundle explorer
- `/validate [directory]` validates a bundle
- `/providers` lists model providers and credential variables
- `/provider [name]` changes the provider for the current session
- `/model [id]` changes the model for the current session
- `/api-key` securely enters or replaces the current provider credential
- `/status` shows effective configuration and where each value came from
- `/config save` persists provider/model defaults; `/config reset` clears them
- `/commands` (or `/help`) shows syntax, examples, and hints
- `/exit` closes the shell

Quoted arguments work as expected, for example `/generate "Document our payments API" --source ./docs`. You can still run `okfgen generate` directly for the original one-shot guided flow. It lets you select a provider, choose a model, paste a missing API key into a masked prompt, add sources, choose an output directory, and review a final configuration panel before generation. If the output directory already contains an OKF v0.1 bundle, the panel switches to update mode and reports how many existing concepts will be improved.

API keys entered during a run stay in memory unless you explicitly choose to save them.

### Configuration and credentials

OKFgen resolves settings in this order: command flags, exported terminal environment, `~/.okfgen/.env`, then interactive prompts and provider defaults. If exactly one supported provider credential is exported, the interactive CLI selects that provider automatically. `/status` reports the effective provider, model, credential status, and source without displaying secrets.

```bash
export OPENROUTER_API_KEY="..."
export OKFGEN_PROVIDER="openrouter"
export OKFGEN_MODEL="openai/gpt-oss-120b"
okfgen
```

When a key is entered through a masked prompt or `/api-key`, OKFgen asks whether to save it. Saving is opt-in. The `~/.okfgen` directory is protected with mode `0700` and its `.env` file with `0600` on supported platforms. Exported terminal variables always override saved values.

Managed settings are `OKFGEN_PROVIDER`, `OKFGEN_MODEL`, `OKFGEN_BASE_URL`, and `OKFGEN_RETRY_ATTEMPTS`. Provider requests default to three retries; the retry setting accepts values from `0` through `10`.

## Providers

| Provider | Default model | Environment variable | Notes |
| --- | --- | --- | --- |
| Nebius Token Factory | Selected from the live catalog | `NEBIUS_API_KEY` | Hosted open-source models through an OpenAI-compatible endpoint |
| OpenRouter | `openai/gpt-oss-120b` | `OPENROUTER_API_KEY` | Open and proprietary models through one router |
| Ollama | `qwen3:8b` | None | Local models; Ollama must be running |
| OpenAI | `gpt-5.4-mini` | `OPENAI_API_KEY` | OpenAI API models |
| Anthropic | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` | Claude API models |

Set a provider key before an automated run:

```bash
export NEBIUS_API_KEY="..."
```

`--api-key` is available for one-off runs, but environment variables are safer because shell history and CI logs can expose command arguments.

For Nebius, the interactive flow validates the API key by loading the current Token Factory model catalog. The searchable selector shows readable names such as `GPT OSS 120B (OpenAI)` while retaining the exact model ID as a hint. Non-interactive Nebius runs require `--model`, so the CLI never silently picks a model.

## Command Reference

### Initialize a project

Create a reusable project configuration:

```bash
okfgen init
```

This writes `okfgen.config.yml`. Generation automatically discovers that file in the current directory or a parent directory:

```yaml
provider: ollama
model: qwen3:8b
sources:
  - ./docs
output: ./okfgen-bundle
log: true
```

Paths are resolved relative to the configuration file. Command flags override environment or saved settings, which override project configuration. Use `--config <file>` to select another file and `okfgen init --force` to replace an existing one.

### Generate a bundle

```bash
okfgen generate "Document our payments API" \
  --provider nebius \
  --model meta-llama/Llama-3.3-70B-Instruct \
  --source ./docs ./openapi.yaml \
  --output ./payments-okfgen
```

Options:

- `-p, --provider`: `nebius`, `openrouter`, `ollama`, `openai`, or `anthropic`
- `-m, --model`: provider model ID
- `--api-key`: one-off provider key
- `-s, --source`: one or more files, directories, or HTTP(S) URLs
- `--config`: explicit `okfgen.config.yml` path
- `-o, --output`: output directory, default `./okfgen-bundle`
- `--base-url`: override an OpenAI-compatible or Ollama endpoint
- `--force`: allow writing into a non-empty directory that is not an existing OKF bundle
- `--no-log`: skip `log.md`

Without a TTY, `generate` prints a compact JSON summary, making it suitable for CI.
Use `--print` to force this one-shot behavior even when a terminal is attached.

A scheduled GitHub Actions template is available at [`examples/okfgen-update.yml`](./examples/okfgen-update.yml). Copy it into `.github/workflows/`, adjust the source and output paths, and add the selected provider credential as a repository secret.

### Update an existing bundle

Run the same generation command with an existing OKF v0.1 bundle as the output directory:

```bash
okfgen generate "Refresh this knowledge from the latest source material" \
  --source ./docs \
  --output ./payments-okfgen
```

OKFgen automatically supplies the current bundle to the model as context and asks for a complete improved plan. It updates retained concepts, adds new concepts, removes stale OKF Markdown files, rebuilds indexes, and appends a dated summary to the existing `log.md`. Unrelated non-Markdown files are left untouched. `--force` is not required for recognized OKF bundles.

### Validate a bundle

```bash
okfgen validate ./payments-okfgen
okfgen validate ./payments-okfgen --json
```

Validation checks frontmatter, required `type` fields, reserved files, index/log structure, and reports broken internal links as warnings.

### Lint bundle quality

Run editorial and graph-quality checks in addition to OKF conformance validation:

```bash
okfgen lint ./payments-okfgen
okfgen lint ./payments-okfgen --strict
okfgen lint ./payments-okfgen --json
```

Linting detects duplicate concept titles, orphan concepts, thin content, skipped heading levels, missing provenance, broken Markdown links, and broken heading anchors. Warnings are informational by default; `--strict` treats them as failures for CI.

### Explore a bundle

```bash
okfgen view ./payments-okfgen
```

The explorer runs locally and provides two connected views:

- **Document** renders sanitized Markdown with searchable concept navigation.
- **Graph** visualizes every concept as a node and every internal Markdown link as a directed edge. Selecting a node opens its document.
- **Theme** defaults to a clean light interface and includes a persistent dark mode toggle.

Use `--port` and `--host` to control the local server, or `--no-open` to start it without launching a browser:

```bash
okfgen view ./payments-okfgen --port 4400 --no-open
```

To open the explorer immediately after generation:

```bash
okfgen generate "Document this repository" --source . --view
```

### List providers

```bash
okfgen providers
```

## Generated Bundle

An output directory looks like this:

```text
payments-okfgen/
├── index.md
├── log.md
├── api/
│   ├── index.md
│   └── authentication.md
└── schemas/
    ├── index.md
    └── payments.md
```

Every concept document contains OKF frontmatter with a non-empty `type`, followed by ordinary Markdown. The root index declares `okf_version: "0.1"`; nested indexes contain linked directory listings. The log keeps the original creation entry and subsequent update entries with counts for improved, added, and removed concepts.

## TypeScript API

```ts
import { generateBundle } from "okfgen";

const result = await generateBundle({
  provider: "nebius",
  model: "meta-llama/Llama-3.3-70B-Instruct",
  apiKey: process.env.NEBIUS_API_KEY,
  request: "Document the catalog represented by these files",
  sources: ["./catalog"],
  outputDirectory: "./catalog-okfgen",
});

console.log(result.mode, result.validation.valid, result.files);
```

The exported API also includes `createChatModel`, `renderBundle`, `validateBundle`, provider metadata, and the Zod schemas.

## Coding Agents

The published package includes [SKILL.md](./SKILL.md), which gives Codex, Claude Code, Cursor, and other coding agents a safe workflow for generating, validating, and visualizing OKF bundles. Agents can read that file directly from the repository or installed package.

## Safety and Limits

- Source input is capped at 1 MB per run.
- Hidden directories, `.git`, dependencies, and build output are skipped during directory ingestion.
- Remote sources use a 15-second timeout and are size-checked after download.
- Concept paths are constrained to remain inside the output directory.
- Automatic updates only activate when the destination root declares `okf_version: "0.1"`; other non-empty directories remain protected unless `--force` is explicit.
- Update cleanup only removes stale OKF Markdown documents and indexes. Other files are preserved.
- API keys are persisted only after explicit confirmation, in the private `~/.okfgen/.env` file; exported terminal values take precedence.
- Model output is parsed and validated before any files are written.

## Development

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Before publishing, confirm the package name is available and run:

```bash
npm login
npm publish --access public
```

## License

MIT. See [LICENSE](./LICENSE).

Built with love by [Arindam](https://github.com/Arindam200).

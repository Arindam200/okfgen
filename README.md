# okf-cli

`okf-cli` generates portable [Open Knowledge Format (OKF) v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundles from your documentation, schemas, source code, and URLs. It uses [LangChain](https://js.langchain.com/) so you can choose a hosted open-source model, a local Ollama model, or a proprietary provider without changing the generation pipeline.

The installed command is **`okf`**.

## What It Does

1. Collects source material from files, directories, or HTTP(S) URLs.
2. Sends a structured generation prompt to the selected LangChain chat model.
3. Parses the model response into a validated bundle plan.
4. Renders Markdown concepts with YAML frontmatter deterministically.
5. Creates progressive-disclosure `index.md` files and an optional `log.md`.
6. Validates the finished bundle against the OKF v0.1 conformance rules.
7. Optionally opens a searchable document explorer with an interactive relationship graph.

The model never writes files directly. This keeps frontmatter, paths, reserved filenames, and output boundaries under CLI control.

## Install

```bash
npm install -g okf-cli
```

Node.js 20 or newer is required. For local development:

```bash
git clone https://github.com/Arindam200/okf-cli.git
cd okf-cli
npm install
npm run build
npm link
```

## Interactive Mode

Run `okf` or `okf generate` with a terminal attached:

```bash
okf
```

The guided flow lets you select a provider, choose a model, paste a missing API key into a masked prompt, add sources, choose an output directory, and review a final configuration panel before generation.

API keys are held in memory only and are never saved by `okf-cli`.

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

### Generate a bundle

```bash
okf generate "Document our payments API" \
  --provider nebius \
  --model meta-llama/Llama-3.3-70B-Instruct \
  --source ./docs ./openapi.yaml \
  --output ./payments-okf
```

Options:

- `-p, --provider`: `nebius`, `openrouter`, `ollama`, `openai`, or `anthropic`
- `-m, --model`: provider model ID
- `--api-key`: one-off provider key
- `-s, --source`: one or more files, directories, or HTTP(S) URLs
- `-o, --output`: output directory, default `./okf-bundle`
- `--base-url`: override an OpenAI-compatible or Ollama endpoint
- `--force`: allow writing into a non-empty output directory
- `--no-log`: skip `log.md`

Without a TTY, `generate` prints a compact JSON summary, making it suitable for CI.

### Validate a bundle

```bash
okf validate ./payments-okf
okf validate ./payments-okf --json
```

Validation checks frontmatter, required `type` fields, reserved files, index/log structure, and reports broken internal links as warnings.

### Explore a bundle

```bash
okf view ./payments-okf
```

The explorer runs locally and provides two connected views:

- **Document** renders sanitized Markdown with searchable concept navigation.
- **Graph** visualizes every concept as a node and every internal Markdown link as a directed edge. Selecting a node opens its document.
- **Theme** defaults to a clean light interface and includes a persistent dark mode toggle.

Use `--port` and `--host` to control the local server, or `--no-open` to start it without launching a browser:

```bash
okf view ./payments-okf --port 4400 --no-open
```

To open the explorer immediately after generation:

```bash
okf generate "Document this repository" --source . --view
```

### List providers

```bash
okf providers
```

## Generated Bundle

An output directory looks like this:

```text
payments-okf/
├── index.md
├── log.md
├── api/
│   ├── index.md
│   └── authentication.md
└── schemas/
    ├── index.md
    └── payments.md
```

Every concept document contains OKF frontmatter with a non-empty `type`, followed by ordinary Markdown. The root index declares `okf_version: "0.1"`; nested indexes contain linked directory listings.

## TypeScript API

```ts
import { generateBundle } from "okf-cli";

const result = await generateBundle({
  provider: "nebius",
  model: "meta-llama/Llama-3.3-70B-Instruct",
  apiKey: process.env.NEBIUS_API_KEY,
  request: "Document the catalog represented by these files",
  sources: ["./catalog"],
  outputDirectory: "./catalog-okf",
});

console.log(result.validation.valid, result.files);
```

The exported API also includes `createChatModel`, `renderBundle`, `validateBundle`, provider metadata, and the Zod schemas.

## Coding Agents

The published package includes [SKILL.md](./SKILL.md), which gives Codex, Claude Code, Cursor, and other coding agents a safe workflow for generating, validating, and visualizing OKF bundles. Agents can read that file directly from the repository or installed package.

## Safety and Limits

- Source input is capped at 1 MB per run.
- Hidden directories, `.git`, dependencies, and build output are skipped during directory ingestion.
- Remote sources use a 15-second timeout and are size-checked after download.
- Concept paths are constrained to remain inside the output directory.
- API keys are not persisted.
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

Apache-2.0. See [LICENSE](./LICENSE).

Built with love by [Arindam](https://github.com/Arindam200).

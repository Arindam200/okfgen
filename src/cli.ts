import * as p from "@clack/prompts";
import boxen from "boxen";
import pc from "picocolors";
import { Command, Option } from "commander";
import path from "node:path";
import { generateBundle } from "./generate.js";
import { fetchNebiusModels, formatModelLabel, providerNames, providers, resolveApiKey, type ProviderName } from "./providers.js";
import { validateBundle } from "./validate.js";
import { startViewer } from "./viewer.js";

interface GenerateFlags {
  provider?: string;
  model?: string;
  apiKey?: string;
  output: string;
  source?: string[];
  baseUrl?: string;
  force?: boolean;
  log: boolean;
  view?: boolean;
  viewPort: string;
}

const program = new Command()
  .name("okfgen")
  .description("Generate and validate Open Knowledge Format bundles with your preferred LLM")
  .version("0.1.0")
  .showHelpAfterError()
  .configureHelp({ sortOptions: true, sortSubcommands: true });

program
  .command("generate", { isDefault: true })
  .description("Generate an OKF v0.1 knowledge bundle")
  .argument("[request]", "what knowledge the bundle should capture")
  .addOption(new Option("-p, --provider <provider>", "LLM provider").choices([...providerNames]))
  .option("-m, --model <model>", "provider model ID")
  .option("--api-key <key>", "provider API key (prefer the provider environment variable in automation)")
  .option("-o, --output <directory>", "bundle output directory", "./okfgen-bundle")
  .option("-s, --source <source...>", "source files, directories, or URLs")
  .option("--base-url <url>", "override the provider base URL")
  .option("--force", "write into a non-empty output directory")
  .option("--no-log", "do not generate log.md")
  .option("--view", "open the generated bundle in the visual explorer")
  .option("--view-port <port>", "visual explorer port", "4173")
  .action(async (request: string | undefined, flags: GenerateFlags) => {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (interactive) {
      console.log(boxen(`${pc.bold(pc.cyan("OKFgen"))}\n${pc.dim("Generate portable Open Knowledge Format bundles")}\n\n${pc.dim("Built with love by Arindam · github.com/Arindam200")}`, {
        borderStyle: "round",
        borderColor: "cyan",
        padding: 1,
        margin: { top: 1, bottom: 1 },
      }));
      p.log.info(`${pc.dim("Interactive mode")}  ${pc.green("ready")}`);
    }

    const provider = flags.provider
      ? parseProvider(flags.provider)
      : await promptProvider(interactive);
    let apiKey = resolveApiKey(provider, flags.apiKey);
    if (providers[provider].requiresKey && !apiKey) {
      if (!interactive) {
        throw new Error(`Set ${providers[provider].envKey} before running non-interactively.`);
      }
      apiKey = unwrap(await p.password({
        message: `Paste your ${providers[provider].label} API key`,
        mask: "*",
        validate: (value) => String(value ?? "").trim() ? undefined : "An API key is required",
      }));
    }

    let model = flags.model;
    if (!model) {
      if (interactive) model = await promptModel(provider, apiKey, flags.baseUrl);
      else if (provider === "nebius") throw new Error("Choose a Nebius model with --model when running non-interactively.");
      else model = requireDefaultModel(provider);
    }

    const generationRequest = request ?? (interactive
      ? unwrap(await p.text({
          message: "What knowledge should this bundle capture?",
          placeholder: "Document our payments API from the supplied OpenAPI file",
          validate: (value) => String(value ?? "").trim() ? undefined : "Describe the bundle you want to create",
        }))
      : undefined);
    if (!generationRequest) throw new Error("Provide a generation request as an argument.");

    let sources = flags.source ?? [];
    if (interactive && sources.length === 0) {
      const sourceInput = unwrap(await p.text({
        message: "Source material (optional)",
        placeholder: "docs/, schema.sql, https://example.com/reference",
      }));
      sources = sourceInput.trim() ? sourceInput.split(",").map((value) => value.trim()).filter(Boolean) : [];
    }

    const outputDirectory = interactive
      ? unwrap(await p.text({
          message: "Where should the bundle be written?",
          placeholder: flags.output,
          defaultValue: flags.output,
          validate: (value) => String(value ?? "").trim() ? undefined : "An output directory is required",
        }))
      : flags.output;
    const includeLog = interactive
      ? unwrap(await p.confirm({ message: "Create a generation log.md?", initialValue: flags.log }))
      : flags.log;
    const shouldView = flags.view ?? (interactive
      ? unwrap(await p.confirm({ message: "Open the visual explorer after generation?", initialValue: true }))
      : false);

    if (interactive) {
      console.log(boxen([
        `${pc.bold("Provider")}  ${providers[provider].label}`,
        `${pc.bold("Model")}     ${model}`,
        `${pc.bold("Sources")}   ${sources.length ? sources.join(", ") : pc.dim("none")}`,
        `${pc.bold("Output")}    ${path.resolve(outputDirectory)}`,
      ].join("\n"), { borderStyle: "single", borderColor: "gray", padding: 1, margin: { bottom: 1 } }));
    }

    const spin = interactive ? p.spinner() : undefined;
    spin?.start("Generating knowledge bundle");
    try {
      const result = await generateBundle({
        request: generationRequest,
        provider,
        model,
        apiKey,
        baseUrl: flags.baseUrl,
        outputDirectory,
        sources,
        force: flags.force,
        includeLog,
      });
      spin?.stop(`Generated ${result.plan.concepts.length} concepts`);
      const viewer = shouldView
        ? await startViewer({ directory: outputDirectory, port: parsePort(flags.viewPort), openBrowser: true })
        : undefined;
      const warnings = result.validation.issues.filter((issue) => issue.severity === "warning");
      if (interactive) {
        p.note(
          [
            `Provider  ${providers[provider].label}`,
            `Model     ${model}`,
            `Files     ${result.files.length}`,
            `Warnings  ${warnings.length}`,
            `Output    ${path.resolve(outputDirectory)}`,
            ...(viewer ? [`Viewer    ${viewer.url}`] : []),
          ].join("\n"),
          "Bundle ready",
        );
        p.outro(viewer ? `Explorer running at ${viewer.url} · press Ctrl+C to stop` : "OKF v0.1 validation passed");
      } else {
        process.stdout.write(`${JSON.stringify({
          output: path.resolve(flags.output),
          concepts: result.plan.concepts.length,
          files: result.files.length,
          warnings: warnings.length,
        })}\n`);
      }
    } catch (error) {
      spin?.stop("Generation failed");
      throw error;
    }
  });

program
  .command("view")
  .description("Browse an OKF bundle with a document reader and relationship graph")
  .argument("[directory]", "bundle directory", ".")
  .option("--host <host>", "server host", "127.0.0.1")
  .option("--port <port>", "server port", "4173")
  .option("--no-open", "do not open the browser automatically")
  .action(async (directory: string, flags: { host: string; port: string; open: boolean }) => {
    const result = await validateBundle(directory);
    if (!result.valid) throw new Error(`Cannot view an invalid OKF bundle. Run okfgen validate ${directory} for details.`);
    const viewer = await startViewer({
      directory,
      host: flags.host,
      port: parsePort(flags.port),
      openBrowser: flags.open,
    });
    p.log.success(`OKFgen Explorer is running at ${viewer.url}`);
    p.log.info("Press Ctrl+C to stop the server");
  });

program
  .command("validate")
  .description("Validate an existing OKF bundle")
  .argument("[directory]", "bundle directory", ".")
  .option("--json", "print machine-readable JSON")
  .action(async (directory: string, flags: { json?: boolean }) => {
    const result = await validateBundle(directory);
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      for (const issue of result.issues) {
        const label = issue.severity === "error" ? "error" : "warn ";
        process.stdout.write(`${label}  ${issue.file}: ${issue.message}\n`);
      }
      process.stdout.write(`${result.valid ? "valid" : "invalid"}  ${result.filesChecked} Markdown files checked\n`);
    }
    if (!result.valid) process.exitCode = 1;
  });

program
  .command("providers")
  .description("List supported model providers and credential variables")
  .action(() => {
    for (const name of providerNames) {
      const provider = providers[name];
      process.stdout.write(`${name.padEnd(12)} ${provider.label.padEnd(23)} ${provider.envKey ?? "no key required"}\n`);
    }
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  p.log.error(message);
  process.exitCode = 1;
});

async function promptProvider(interactive: boolean): Promise<ProviderName> {
  if (!interactive) throw new Error("Choose a provider with --provider.");
  return unwrap(await p.select({
    message: "Choose an LLM provider",
    options: providerNames.map((name) => ({
      value: name,
      label: providers[name].label,
      hint: providers[name].hint,
    })),
  }));
}

async function promptModel(provider: ProviderName, apiKey?: string, baseUrl?: string): Promise<string> {
  if (provider === "nebius") {
    if (!apiKey) throw new Error("A Nebius API key is required before loading models.");
    const spin = p.spinner();
    spin.start("Loading models from Nebius Token Factory");
    try {
      const models = await fetchNebiusModels(apiKey, baseUrl);
      spin.stop(`Found ${models.length} available models`);
      const selected = unwrap(await p.autocomplete({
        message: "Choose a Nebius model",
        placeholder: "Type to filter models",
        maxItems: 8,
        options: [
          ...models.map((model) => ({ value: model, label: formatModelLabel(model), hint: model })),
          { value: "__custom__", label: "Enter a custom model ID", hint: "Use an ID not shown above" },
        ],
      }));
      if (selected !== "__custom__") return selected;
    } catch (error) {
      spin.stop("Could not load Nebius models");
      throw error;
    }
    return promptCustomModel();
  }

  const defaultModel = requireDefaultModel(provider);
  const presets = providers[provider].models ?? [defaultModel];
  const selected = unwrap(await p.select({
    message: "Choose a model",
    options: [
      ...presets.map((model) => ({ value: model, label: model, hint: model === defaultModel ? "recommended" : undefined })),
      { value: "__custom__", label: "Enter a custom model ID", hint: "for hosted or local models" },
    ],
  }));
  if (selected !== "__custom__") return selected;
  return promptCustomModel(defaultModel);
}

async function promptCustomModel(placeholder?: string): Promise<string> {
  return unwrap(await p.text({
    message: "Model ID",
    placeholder,
    validate: (value) => String(value ?? "").trim() ? undefined : "A model ID is required",
  }));
}

function parseProvider(value: string): ProviderName {
  if (!providerNames.includes(value as ProviderName)) throw new Error(`Unsupported provider: ${value}`);
  return value as ProviderName;
}

function requireDefaultModel(provider: ProviderName): string {
  const model = providers[provider].defaultModel;
  if (!model) throw new Error(`Choose a ${providers[provider].label} model explicitly.`);
  return model;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`Invalid port: ${value}`);
  return port;
}

function unwrap<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }
  return value as T;
}

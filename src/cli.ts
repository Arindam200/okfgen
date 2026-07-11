import * as p from "@clack/prompts";
import boxen from "boxen";
import pc from "picocolors";
import { Command, CommanderError, Option } from "commander";
import path from "node:path";
import { inspectExistingBundle } from "./existing-bundle.js";
import { generateBundle } from "./generate.js";
import {
  loadOkfgenEnv,
  OKFGEN_BASE_URL_ENV_KEY,
  OKFGEN_MODEL_ENV_KEY,
  resolveConfigValue,
  resolveProvider,
  resolveRetryAttempts,
  saveOkfgenEnv,
} from "./config.js";
import { friendlyError, PromptCancelledError, registerDiagnosticSecret, unwrapPrompt as unwrap } from "./diagnostics.js";
import { isInteractiveShellActive, rememberGeneration, showFirstRunWordmark, startInteractiveShell } from "./interactive.js";
import { fetchNebiusModels, formatModelLabel, providerNames, providers, resolveApiKey, type ProviderName } from "./providers.js";
import { validateBundle } from "./validate.js";
import { VERSION } from "./version.js";
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
  print?: boolean;
}

const program = new Command()
  .name("okfgen")
  .description("Generate and validate Open Knowledge Format bundles with your preferred LLM")
  .version(VERSION)
  .exitOverride()
  .showHelpAfterError()
  .configureHelp({ sortOptions: true, sortSubcommands: true });

program
  .command("generate", { isDefault: true })
  .alias("update")
  .description("Generate an OKF v0.1 knowledge bundle")
  .argument("[request]", "what knowledge the bundle should capture")
  .addOption(new Option("-p, --provider <provider>", "LLM provider").choices([...providerNames]))
  .option("-m, --model <model>", "provider model ID")
  .option("--api-key <key>", "provider API key (prefer the provider environment variable in automation)")
  .option("-o, --output <directory>", "bundle output directory", "./okfgen-bundle")
  .option("-s, --source <source...>", "source files, directories, or URLs")
  .option("--base-url <url>", "override the provider base URL")
  .option("--force", "write into a non-empty directory that is not an existing OKF bundle")
  .option("--no-log", "do not generate log.md")
  .option("--view", "open the generated bundle in the visual explorer")
  .option("--view-port <port>", "visual explorer port", "4173")
  .option("--print", "run once and print the machine-readable result")
  .action(async (request: string | undefined, flags: GenerateFlags) => {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !flags.print);
    if (interactive && !isInteractiveShellActive()) {
      await showFirstRunWordmark();
      console.log(boxen(`${pc.bold(pc.cyan("OKFgen"))}\n${pc.dim("Generate portable Open Knowledge Format bundles")}\n\n${pc.dim("Built with love by Arindam · github.com/Arindam200")}`, {
        borderStyle: "round",
        borderColor: "cyan",
        padding: 1,
        margin: { top: 1, bottom: 1 },
      }));
      p.log.info(`${pc.dim("Interactive mode")}  ${pc.green("ready")}`);
    }

    const providerResolution = resolveProvider(flags.provider);
    const provider = providerResolution.value
      ? parseProvider(providerResolution.value)
      : await promptProvider(interactive);
    if (interactive && providerResolution.value && providerResolution.source !== "flag") {
      p.log.info(`${providers[provider].label} selected from ${providerResolution.envKey ?? providerResolution.source}`);
    }
    let apiKey = resolveApiKey(provider, flags.apiKey);
    if (apiKey) registerDiagnosticSecret(providers[provider].envKey ?? "API_KEY", apiKey);
    if (providers[provider].requiresKey && !apiKey) {
      if (!interactive) {
        throw new Error(`Set ${providers[provider].envKey} before running non-interactively.`);
      }
      apiKey = unwrap(await p.password({
        message: `Paste your ${providers[provider].label} API key`,
        mask: "*",
        validate: (value) => String(value ?? "").trim() ? undefined : "An API key is required",
      }));
      registerDiagnosticSecret(providers[provider].envKey ?? "API_KEY", apiKey);
      const shouldSaveKey = unwrap(await p.confirm({
        message: `Save it to ~/.okfgen/.env for future sessions?`,
        initialValue: false,
      }));
      if (shouldSaveKey) {
        await saveOkfgenEnv({ [providers[provider].envKey!]: apiKey });
        p.log.success(`Saved ${providers[provider].envKey} with private file permissions`);
      } else {
        p.log.info(`${pc.dim("Hint:")} Your key is used for this run only and is never saved.`);
      }
    } else if (interactive && providers[provider].requiresKey) {
      p.log.success(`${providers[provider].envKey} detected · credential value remains hidden`);
    }

    let model = resolveConfigValue(OKFGEN_MODEL_ENV_KEY, flags.model).value;
    if (!model) {
      if (interactive) model = await promptModel(provider, apiKey, resolveConfigValue(OKFGEN_BASE_URL_ENV_KEY, flags.baseUrl).value);
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
        placeholder: "docs/, schema.sql, URL — comma-separated",
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
    const existingBundle = await inspectExistingBundle(outputDirectory);
    const shouldView = flags.view ?? (interactive
      ? unwrap(await p.confirm({ message: "Open the visual explorer after generation?", initialValue: true }))
      : false);

    if (interactive) {
      if (existingBundle) {
        p.log.info(`Existing OKF bundle found · ${existingBundle.conceptPaths.length} concepts will be improved and log.md will be maintained`);
      } else if (sources.length === 0) {
        p.log.warn("No source material selected · the bundle will be based only on your request");
      }
      console.log(boxen([
        `${pc.bold("Mode")}      ${existingBundle ? pc.cyan("Update existing OKF bundle") : "Create new OKF bundle"}`,
        `${pc.bold("Provider")}  ${providers[provider].label}`,
        `${pc.bold("Model")}     ${model}`,
        `${pc.bold("Sources")}   ${sources.length ? sources.join(", ") : pc.dim("none")}`,
        `${pc.bold("Output")}    ${path.resolve(outputDirectory)}`,
      ].join("\n"), { borderStyle: "single", borderColor: "gray", padding: 1, margin: { bottom: 1 } }));
    }

    const spin = interactive ? p.spinner() : undefined;
    spin?.start(existingBundle ? "Improving existing knowledge bundle" : "Generating knowledge bundle");
    let result;
    try {
      result = await generateBundle({
        request: generationRequest,
        provider,
        model,
        apiKey,
        baseUrl: resolveConfigValue(OKFGEN_BASE_URL_ENV_KEY, flags.baseUrl).value,
        maxRetries: resolveRetryAttempts(),
        outputDirectory,
        sources,
        force: flags.force,
        includeLog,
        onProgress: (event) => spin?.message(event.message),
      });
      spin?.stop(`${result.mode === "updated" ? "Updated" : "Generated"} ${result.plan.concepts.length} concepts`);
    } catch (error) {
      spin?.stop("Generation stopped before completion");
      throw error;
    }
    if (interactive) rememberGeneration(outputDirectory, sources);
    let viewer;
    if (shouldView) {
      try {
        viewer = await startViewer({ directory: outputDirectory, port: parsePort(flags.viewPort), openBrowser: true });
      } catch (error) {
        const warning = `The bundle is ready, but the viewer could not start: ${friendlyError(error)}`;
        if (interactive) p.log.warn(warning);
        else process.stderr.write(`${warning}\n`);
      }
    }
    const warnings = result.validation.issues.filter((issue) => issue.severity === "warning");
    if (interactive) {
      for (const warning of warnings.slice(0, 3)) p.log.warn(`${warning.file}: ${warning.message}`);
      if (warnings.length > 3) p.log.warn(`${warnings.length - 3} more warnings · run okfgen validate ${outputDirectory} for details`);
      p.note(
        [
          `Provider  ${providers[provider].label}`,
          `Model     ${model}`,
          `Files     ${result.files.length}`,
          `Warnings  ${warnings.length}`,
          `Output    ${path.resolve(outputDirectory)}`,
          ...(viewer ? [`Viewer    ${viewer.url}`] : []),
        ].join("\n"),
        result.mode === "updated" ? "Bundle updated" : "Bundle ready",
      );
      p.outro(viewer
        ? `Explorer running at ${viewer.url} · press Ctrl+C to stop`
        : `Validation passed · next: okfgen view ${outputDirectory}`);
    } else {
      process.stdout.write(`${JSON.stringify({
        output: path.resolve(flags.output),
        mode: result.mode,
        concepts: result.plan.concepts.length,
        files: result.files.length,
        warnings: warnings.length,
      })}\n`);
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
        const label = issue.severity === "error" ? pc.red("error") : pc.yellow("warn ");
        process.stdout.write(`${label}  ${pc.bold(issue.file)}: ${issue.message}\n`);
      }
      const status = result.valid ? pc.green("valid") : pc.red("invalid");
      process.stdout.write(`${status}  ${result.filesChecked} Markdown files checked · ${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}\n`);
      if (result.valid) process.stdout.write(`${pc.dim("Hint:")} Explore it with okfgen view ${directory}\n`);
    }
    if (!result.valid) process.exitCode = 1;
  });

program
  .command("providers")
  .description("List supported model providers and credential variables")
  .action(() => {
    process.stdout.write(`${pc.bold("Provider")}     ${pc.bold("Name")}                    ${pc.bold("Credential")}\n`);
    for (const name of providerNames) {
      const provider = providers[name];
      process.stdout.write(`${name.padEnd(12)} ${provider.label.padEnd(23)} ${provider.envKey ?? "no key required"}\n`);
    }
    process.stdout.write(`\n${pc.dim("Hint:")} Set the credential in your environment, or paste it securely during /generate.\n`);
  });

const cliArguments = process.argv.slice(2);
const run = loadOkfgenEnv().then(async () => {
  if (process.stdin.isTTY && process.stdout.isTTY && cliArguments.length === 0) await startInteractiveShell(program, VERSION);
  else await program.parseAsync();
});

run.catch((error: unknown) => {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode;
    return;
  }
  if (error instanceof PromptCancelledError) return;
  const message = friendlyError(error);
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

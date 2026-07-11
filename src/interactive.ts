import boxen from "boxen";
import pc from "picocolors";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import path from "node:path";
import { CommanderError, type Command } from "commander";
import * as p from "@clack/prompts";
import {
  getCredentialStatus,
  OKFGEN_MODEL_ENV_KEY,
  OKFGEN_PROVIDER_ENV_KEY,
  resolveConfigValue,
  resolveProvider,
  saveOkfgenEnv,
  setSessionConfig,
} from "./config.js";
import { friendlyError, PromptCancelledError, registerDiagnosticSecret } from "./diagnostics.js";
import { providerNames, providers, type ProviderName } from "./providers.js";

let shellActive = false;
const session: { output?: string; sources?: string[] } = {};

const WORDMARK = [
  "   ____  __ __ ______",
  "  / __ \\/ //_// ____/___ ____  ____",
  " / / / / ,<  / /_  / __  / _ \\/ __ \\",
  "/ /_/ / /| |/ __/ / /_/ /  __/ / / /",
  "\\____/_/ |_/_/    \\__, /\\___/_/ /_/",
  "                 /____/",
].join("\n");

export function firstRunMarkerPath(environment = process.env): string {
  const home = environment.HOME || homedir();
  return path.join(home, ".okfgen", "welcome-shown");
}

export async function showFirstRunWordmark(markerPath = firstRunMarkerPath()): Promise<boolean> {
  try {
    await writeFile(markerPath, "", { flag: "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      await mkdir(path.dirname(markerPath), { recursive: true });
      return showFirstRunWordmark(markerPath);
    }
    if (code === "EEXIST") return false;
    return false;
  }

  process.stdout.write(`${pc.cyan(WORDMARK)}\n\n`);
  return true;
}

export function splitCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const character of input.trim()) {
    if (escaped) {
      token += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = undefined;
      else token += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
    } else {
      token += character;
    }
  }
  if (escaped) token += "\\";
  if (quote) throw new Error("Unclosed quote");
  if (token) tokens.push(token);
  return tokens;
}

export async function startInteractiveShell(program: Command, version: string): Promise<void> {
  shellActive = true;
  await showFirstRunWordmark();
  const startupProvider = resolveProvider();
  const startupProviderName = startupProvider.value && providerNames.includes(startupProvider.value as ProviderName)
    ? startupProvider.value as ProviderName
    : undefined;
  const startupModel = resolveConfigValue(OKFGEN_MODEL_ENV_KEY);
  console.log(boxen([
    `${pc.cyan(">_")}  ${pc.bold("OKFgen")}  ${pc.dim(`v${version}  Open Knowledge Format toolkit`)}`,
    `${pc.dim("provider:")}  ${startupProviderName ? pc.bold(providers[startupProviderName].label) : pc.yellow("choose with /provider")} ${sourceLabel(startupProvider.source, startupProvider.envKey)}`,
    `${pc.dim("model:")}     ${startupModel.value ? pc.bold(startupModel.value) : pc.dim("choose during /generate")} ${sourceLabel(startupModel.source, startupModel.envKey)}`,
    `${pc.dim("directory:")} ${pc.bold(formatHomePath(process.cwd()))}`,
  ].join("\n"), { borderStyle: "round", borderColor: "cyan", padding: { left: 1, right: 1 }, margin: { bottom: 1 } }));
  console.log(`${pc.dim("—")} ${pc.cyan("Ready")} ${pc.dim("— /generate to start · /commands for everything")}`);

  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const input = (await terminal.question(`\n${pc.cyan(">")} `)).trim();
      if (!input) continue;
      if (!input.startsWith("/")) {
        console.log(pc.yellow("Use a slash command to get started."));
        console.log(`${pc.dim("Hint:")} ${pc.cyan('/generate "Document our API" --source ./docs')}`);
        continue;
      }

      let args: string[];
      try {
        args = splitCommandLine(input.slice(1));
      } catch (error) {
        console.log(pc.red(error instanceof Error ? error.message : String(error)));
        continue;
      }
      const [command, ...rest] = args;
      if (!command) continue;
      if (command === "exit" || command === "quit") break;
      if (command === "help" || command === "commands") {
        printCommandHelp();
        continue;
      }
      try {
        if (command === "status" || command === "config") {
          if (rest[0] === "save") await savePreferences();
          else if (rest[0] === "reset") await resetPreferences();
          else printStatus();
          continue;
        }
        if (command === "provider") {
          await changeProvider(rest[0]);
          continue;
        }
        if (command === "model") {
          await changeModel(rest.join(" "));
          continue;
        }
        if (command === "api-key") {
          await changeApiKey();
          continue;
        }
      } catch (error) {
        if (!(error instanceof PromptCancelledError)) {
          console.log(`${pc.red("Could not update configuration:")} ${friendlyError(error)}`);
        }
        continue;
      }
      if (!["generate", "update", "view", "validate", "providers"].includes(command)) {
        console.log(pc.yellow(`Unknown command /${command}.`));
        console.log(`${pc.dim("Hint:")} Type ${pc.cyan("/commands")} to see the available commands.`);
        continue;
      }

      try {
        const invocation = shellInvocation(command, rest);
        await program.parseAsync(["node", "okfgen", ...invocation]);
        const hint = commandHint(invocation[0] ?? command);
        if (hint) console.log(`\n${pc.dim("Next:")} ${hint}`);
      } catch (error) {
        if (error instanceof PromptCancelledError) continue;
        if (error instanceof CommanderError) {
          if (error.exitCode !== 0) console.log(`${pc.dim("Hint:")} Run ${pc.cyan("/commands")} for syntax and examples.`);
          continue;
        }
        console.log(`${pc.red("Could not run command:")} ${friendlyError(error)}`);
        console.log(`${pc.dim("Hint:")} Run ${pc.cyan(`/commands`)} for syntax and examples.`);
      }
    }
  } finally {
    shellActive = false;
    terminal.close();
  }
  console.log(pc.dim("Goodbye."));
}

export function isInteractiveShellActive(): boolean {
  return shellActive;
}

export function rememberGeneration(output: string, sources: string[]): void {
  session.output = output;
  session.sources = [...sources];
}

export function commandHelpText(): string {
  return [
    `${pc.bold("Commands")}`,
    `  ${pc.cyan("/generate [request]")}     Create or update an OKF bundle`,
    `  ${pc.cyan("/update [request]")}       Refresh the last generated bundle`,
    `  ${pc.cyan("/view [directory]")}       Open the local document explorer`,
    `  ${pc.cyan("/validate [directory]")}   Check an existing bundle`,
    `  ${pc.cyan("/providers")}              List providers and API-key variables`,
    `  ${pc.cyan("/provider [name]")}        Change provider for this session`,
    `  ${pc.cyan("/model [id]")}             Change model for this session`,
    `  ${pc.cyan("/api-key")}                Enter or replace a credential`,
    `  ${pc.cyan("/status")}                 Show effective config and its sources`,
    `  ${pc.cyan("/config save|reset")}      Manage saved provider/model defaults`,
    `  ${pc.cyan("/commands")}               Show this guide`,
    `  ${pc.cyan("/exit")}                   Close OKFgen`,
    "",
    `${pc.bold("Examples")}`,
    `  ${pc.dim('/generate "Document our payments API" --source ./docs')}`,
    `  ${pc.dim('/generate "Refresh this bundle" --output ./knowledge')}`,
    `  ${pc.dim("/validate ./knowledge")}`,
    `  ${pc.dim("/view ./knowledge --port 4400")}`,
    "",
    `${pc.dim("Tip: quote requests or paths that contain spaces.")}`,
  ].join("\n");
}

function shellInvocation(command: string, rest: string[]): string[] {
  if ((command === "view" || command === "validate") && rest.length === 0 && session.output) return [command, session.output];
  if (command === "update") {
    if (!session.output) throw new Error("There is no previous bundle in this session. Run /generate first.");
    const request = rest.length ? rest : ["Refresh this bundle from the latest source material"];
    return ["generate", ...request, "--output", session.output, ...(session.sources?.length ? ["--source", ...session.sources] : [])];
  }
  return [command, ...rest];
}

function printStatus(): void {
  const providerResult = resolveProvider();
  const provider = providerResult.value && providerNames.includes(providerResult.value as ProviderName)
    ? providerResult.value as ProviderName
    : undefined;
  const model = resolveConfigValue(OKFGEN_MODEL_ENV_KEY);
  const credential = provider ? getCredentialStatus(provider) : undefined;
  console.log(boxen([
    `${pc.bold("Provider")}    ${provider ? providers[provider].label : pc.dim("not selected")}  ${sourceLabel(providerResult.source, providerResult.envKey)}`,
    `${pc.bold("Model")}       ${model.value ?? pc.dim("provider default")}  ${sourceLabel(model.source, model.envKey)}`,
    `${pc.bold("Credential")}  ${provider && providers[provider].requiresKey ? (credential?.value ? pc.green("detected") : pc.yellow("missing")) : pc.dim("not required")}  ${credential ? sourceLabel(credential.source, credential.envKey) : ""}`,
    `${pc.bold("Output")}      ${session.output ?? pc.dim("not generated in this session")}`,
  ].join("\n"), { title: "Effective configuration", borderStyle: "round", borderColor: "gray", padding: { left: 1, right: 1 } }));
}

async function changeProvider(input?: string): Promise<void> {
  const previousProvider = resolveProvider().value;
  const selected = input || unwrapPrompt(await p.select({
    message: "Provider for this session",
    options: providerNames.map((name) => ({ value: name, label: providers[name].label, hint: getCredentialStatus(name).value ? "credential detected" : providers[name].hint })),
  }));
  if (!providerNames.includes(selected as ProviderName)) throw new Error(`Unsupported provider: ${selected}`);
  setSessionConfig(OKFGEN_PROVIDER_ENV_KEY, selected);
  if (previousProvider && previousProvider !== selected) setSessionConfig(OKFGEN_MODEL_ENV_KEY, "");
  console.log(`${pc.green("Selected")} ${providers[selected as ProviderName].label}. Use ${pc.cyan("/model")} to choose its model.`);
}

async function changeModel(input?: string): Promise<void> {
  const model = input?.trim() || unwrapPrompt(await p.text({ message: "Model ID", validate: (value) => String(value ?? "").trim() ? undefined : "A model ID is required" }));
  setSessionConfig(OKFGEN_MODEL_ENV_KEY, model);
  console.log(`${pc.green("Selected model")} ${model}`);
}

async function changeApiKey(): Promise<void> {
  let result = resolveProvider();
  if (!result.value || !providerNames.includes(result.value as ProviderName)) {
    await changeProvider();
    result = resolveProvider();
  }
  const provider = result.value as ProviderName;
  const key = providers[provider].envKey;
  if (!key) {
    console.log(`${providers[provider].label} does not require an API key.`);
    return;
  }
  const value = unwrapPrompt(await p.password({ message: `${providers[provider].label} API key`, mask: "*", validate: (input) => String(input ?? "").trim() ? undefined : "An API key is required" }));
  registerDiagnosticSecret(key, value);
  setSessionConfig(key, value);
  const persist = unwrapPrompt(await p.confirm({ message: `Save it to ~/.okfgen/.env for future sessions?`, initialValue: false }));
  if (persist) await saveOkfgenEnv({ [key]: value });
  console.log(persist ? pc.green(`Saved ${key} with private file permissions.`) : pc.green(`${key} is available for this session only.`));
}

async function savePreferences(): Promise<void> {
  const provider = resolveProvider().value;
  const model = resolveConfigValue(OKFGEN_MODEL_ENV_KEY).value;
  const updates: Record<string, string> = {};
  if (provider) updates[OKFGEN_PROVIDER_ENV_KEY] = provider;
  if (model) updates[OKFGEN_MODEL_ENV_KEY] = model;
  if (Object.keys(updates).length === 0) throw new Error("Choose a provider or model before saving preferences.");
  await saveOkfgenEnv(updates);
  console.log(pc.green("Saved provider and model preferences to ~/.okfgen/.env."));
}

async function resetPreferences(): Promise<void> {
  await saveOkfgenEnv({ [OKFGEN_PROVIDER_ENV_KEY]: "", [OKFGEN_MODEL_ENV_KEY]: "" });
  console.log(pc.green("Cleared saved provider and model preferences."));
}

function sourceLabel(source: string, envKey?: string): string {
  if (source === "unset" || source === "default") return pc.dim(`(${source})`);
  return pc.dim(`(${source}${envKey ? `: ${envKey}` : ""})`);
}

function unwrapPrompt<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Operation cancelled");
    throw new PromptCancelledError();
  }
  return value as T;
}

function printCommandHelp(): void {
  console.log(`\n${commandHelpText()}`);
}

function commandHint(command: string): string | undefined {
  if (command === "providers") return `Run ${pc.cyan("/generate")} and choose one of these providers.`;
  if (command === "validate") return `Run ${pc.cyan("/view [directory]")} to explore a valid bundle.`;
  return undefined;
}

function formatHomePath(directory: string): string {
  const home = homedir();
  return directory === home ? "~" : directory.startsWith(`${home}${path.sep}`) ? `~${directory.slice(home.length)}` : directory;
}

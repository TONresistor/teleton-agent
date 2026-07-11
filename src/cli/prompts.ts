/**
 * CLI Prompt Utilities
 *
 * Wrapper around @inquirer/prompts providing a reusable prompter interface.
 * Also exports UI helpers (theme, frame, noteBox) used by the setup wizard.
 */

import { input, select, checkbox, confirm, password } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import { PACKAGE_VERSION } from "../utils/package-info.js";

// ── Branding & Theme ──────────────────────────────────────────────────

export const TON = chalk.hex("#0098EA");
export const GREEN = chalk.green;
export const CYAN = chalk.cyan;
export const DIM = chalk.dim;
export const BOLD = chalk.bold;
export const RED = chalk.red;
export const YELLOW = chalk.yellow;
export const WHITE = chalk.white;

export const inquirerTheme = {
  prefix: { idle: TON("›"), done: GREEN("✔") },
  style: {
    answer: (t: string) => CYAN.bold(t),
    message: (t: string, status: string) => (status === "done" ? DIM(t) : BOLD(t)),
    error: (t: string) => RED.bold(`  ✘ ${t}`),
    help: (t: string) => DIM(t),
    highlight: (t: string) => TON.bold(t),
    description: (t: string) => DIM.italic(t),
  },
  icon: { cursor: TON("❯") },
};

// ── ANSI helpers ──────────────────────────────────────────────────────

export function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, "");
}

export function padRight(s: string, len: number): string {
  return s + " ".repeat(Math.max(0, len - s.length));
}

export function padRightAnsi(s: string, len: number): string {
  const visible = stripAnsi(s).length;
  return s + " ".repeat(Math.max(0, len - visible));
}

export function centerIn(text: string, width: number): string {
  const vis = stripAnsi(text).length;
  const pad = width - vis;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return " ".repeat(Math.max(0, left)) + text + " ".repeat(Math.max(0, right));
}

// ── Frame rendering ───────────────────────────────────────────────────

const BOX_WIDTH = 56;

const ASCII_ART_RAW = [
  "    ______     __     __                 ___                    __",
  "   /_  __/__  / /__  / /_____  ____     /   | ____ ____  ____  / /_",
  "    / / / _ \\/ / _ \\/ __/ __ \\/ __ \\   / /| |/ __ `/ _ \\/ __ \\/ __/",
  "   / / /  __/ /  __/ /_/ /_/ / / / /  / ___ / /_/ /  __/ / / / /_",
  "  /_/  \\___/_/\\___/\\__/\\____/_/ /_/  /_/  |_\\__, /\\___/_/ /_/\\__/",
  "                                           /____/",
];

const ART_WIDTH = Math.max(...ASCII_ART_RAW.map((l) => l.length));
const ASCII_ART = ASCII_ART_RAW.map((l) => l + " ".repeat(ART_WIDTH - l.length));

export const FRAME_WIDTH = Math.max(BOX_WIDTH, ART_WIDTH + 4);

export interface StepDef {
  label: string;
  desc: string;
  value?: string;
}

function frameRow(content: string, border = TON): string {
  const pad = FRAME_WIDTH - stripAnsi(content).length;
  return `  ${border("║")}${content}${" ".repeat(Math.max(0, pad))}${border("║")}`;
}

function emptyRow(border = TON): string {
  return `  ${border("║")}${" ".repeat(FRAME_WIDTH)}${border("║")}`;
}

/** Renders the unified banner + progress frame for the setup wizard */
export function wizardFrame(currentStep: number, steps: StepDef[]): string {
  const W = FRAME_WIDTH;
  const out: string[] = [];

  out.push(`  ${TON("╔" + "═".repeat(W) + "╗")}`);
  out.push(emptyRow());

  for (const line of ASCII_ART) {
    out.push(frameRow(TON.bold(centerIn(line, W))));
  }

  out.push(emptyRow());

  const subtitle = "Autonomous AI agent on Telegram with native TON blockchain integration";
  out.push(frameRow(DIM(centerIn(subtitle, W))));
  out.push(frameRow(DIM(centerIn(`t.me/TeletonAgents  |  v${PACKAGE_VERSION}`, W))));

  out.push(`  ${TON("╠" + "═".repeat(W) + "╣")}`);
  out.push(emptyRow());

  const labelWidth = 14;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    let line: string;
    if (i < currentStep) {
      const val = s.value ?? "";
      line = `  ${GREEN("✔")} ${WHITE(padRight(s.label, labelWidth))}${CYAN(val)}`;
    } else if (i === currentStep) {
      line = `  ${TON.bold("▸")} ${TON.bold(padRight(s.label, labelWidth))}${DIM(s.desc)}`;
    } else {
      line = `  ${DIM("○")} ${DIM(padRight(s.label, labelWidth))}${DIM(s.desc)}`;
    }
    out.push(frameRow(padRightAnsi(line, W)));
  }

  out.push(emptyRow());
  const pct = Math.round((currentStep / steps.length) * 100);
  const barLen = Math.max(10, W - 36);
  const filled = Math.round((currentStep / steps.length) * barLen);
  const bar = TON("█".repeat(filled)) + DIM("░".repeat(barLen - filled));
  const footer = `  ${bar}  ${DIM(`${pct}%  ·  Step ${currentStep + 1} of ${steps.length}`)}`;
  out.push(frameRow(padRightAnsi(footer, W)));

  out.push(emptyRow());
  out.push(`  ${TON("╚" + "═".repeat(W) + "╝")}`);

  return out.join("\n");
}

/** Display a titled note box (informational panel) */
export function noteBox(text: string, title: string, color = YELLOW): void {
  const W = FRAME_WIDTH;
  const titleStr = ` ${title} `;
  const titlePad = W - stripAnsi(titleStr).length - 1;
  console.log(
    `  ${color("┌─")}${color.bold(titleStr)}${color("─".repeat(Math.max(0, titlePad)) + "┐")}`
  );

  const lines = text.split("\n");
  for (const line of lines) {
    const pad = W - stripAnsi(line).length - 2;
    console.log(`  ${color("│")}  ${line}${" ".repeat(Math.max(0, pad))}${color("│")}`);
  }

  console.log(`  ${color("└" + "─".repeat(W) + "┘")}`);
  console.log();
}

/** Fused Configuration Summary + Next Steps box */
export function finalSummaryBox(steps: StepDef[], connected: boolean): string {
  const W = FRAME_WIDTH;
  const B = GREEN;

  const gRow = (content: string) => {
    const pad = W - stripAnsi(content).length;
    return `  ${B("║")}${content}${" ".repeat(Math.max(0, pad))}${B("║")}`;
  };
  const gEmpty = () => `  ${B("║")}${" ".repeat(W)}${B("║")}`;

  const out: string[] = [];

  const t1 = " Configuration Summary ";
  const t1Pad = W - stripAnsi(t1).length - 1;
  out.push(`  ${B("╔═" + B.bold(t1) + "═".repeat(Math.max(0, t1Pad)) + "╗")}`);
  out.push(gEmpty());

  for (const s of steps) {
    const val = s.value ?? DIM("not set");
    const entry = `  ${GREEN("✔")} ${WHITE(padRight(s.label, 14))}${CYAN(val)}`;
    out.push(gRow(entry));
  }

  const t2 = " Next Steps ";
  const t2Pad = W - stripAnsi(t2).length - 1;
  out.push(gEmpty());
  out.push(`  ${B("╠═" + B.bold(t2) + "═".repeat(Math.max(0, t2Pad)) + "╣")}`);
  out.push(gEmpty());

  const items = connected
    ? [
        `${TON("1.")} Start the agent`,
        `   ${CYAN("$ teleton start")}`,
        "",
        `${TON("2.")} Send ${CYAN("/boot")} as your first message`,
        `   to bootstrap the agent's personality`,
        "",
        `${TON("3.")} Customize ${DIM("~/.teleton/workspace/SOUL.md")}`,
        `   to shape your agent's behavior`,
        "",
        `${TON("4.")} Read the docs`,
        `   ${TON.underline("https://github.com/TONresistor/teleton-agent")}`,
      ]
    : [
        `${TON("1.")} Start the agent`,
        `   ${CYAN("$ teleton start")}`,
        "",
        `${TON("2.")} On first launch, you will be asked for:`,
        `   - Telegram verification code`,
        `   - 2FA password (if enabled)`,
        "",
        `${TON("3.")} Send a message to your Telegram account to test`,
      ];

  for (const item of items) {
    const pad = W - stripAnsi(item).length - 2;
    out.push(`  ${B("║")}  ${item}${" ".repeat(Math.max(0, pad))}${B("║")}`);
  }

  out.push(gEmpty());
  out.push(`  ${B("╚" + "═".repeat(W) + "╝")}`);

  return out.join("\n");
}

// ── Re-export @inquirer/prompts for direct use in onboard.ts ──────────

export { input, select, checkbox, confirm, password };

// ── Backward-compatible prompter interface (used by config.ts) ────────

export interface SelectOption<T = string> {
  value: T;
  label: string;
  hint?: string;
}

export interface TextPromptOptions {
  message: string;
  placeholder?: string;
  initialValue?: string;
  validate?: (value: string | undefined) => string | Error | undefined;
}

export interface SelectPromptOptions<T = string> {
  message: string;
  options: SelectOption<T>[];
  initialValue?: T;
}

export interface ConfirmPromptOptions {
  message: string;
  initialValue?: boolean;
}

export interface PrompterSpinner {
  start: (message: string) => void;
  stop: (message: string) => void;
  message: (message: string) => void;
}

export class CancelledError extends Error {
  constructor() {
    super("Operation cancelled by user");
    this.name = "CancelledError";
  }
}

function wrapExitPromptError<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((err) => {
    if (err?.name === "ExitPromptError") throw new CancelledError();
    throw err;
  });
}

/** Adapt validate: clack returns string|Error|undefined, inquirer expects string|true */
function adaptValidate(
  fn?: (value: string | undefined) => string | Error | undefined
): ((value: string) => string | true) | undefined {
  if (!fn) return undefined;
  return (value: string) => {
    const result = fn(value);
    if (result === undefined) return true;
    if (result instanceof Error) return result.message;
    return result;
  };
}

export class InquirerPrompter {
  async intro(title: string): Promise<void> {
    console.log(`\n  ${TON.bold(title)}\n`);
  }

  async outro(message: string): Promise<void> {
    console.log(`\n  ${DIM(message)}\n`);
  }

  async note(message: string, title?: string): Promise<void> {
    noteBox(message, title ?? "Note", YELLOW);
  }

  async text(options: TextPromptOptions): Promise<string> {
    return wrapExitPromptError(
      input({
        message: options.message,
        default: options.initialValue,
        theme: inquirerTheme,
        validate: adaptValidate(options.validate),
      })
    );
  }

  async password(options: {
    message: string;
    validate?: (value: string | undefined) => string | Error | undefined;
  }): Promise<string> {
    return wrapExitPromptError(
      password({
        message: options.message,
        theme: inquirerTheme,
        validate: adaptValidate(options.validate),
      })
    );
  }

  async select<T = string>(options: SelectPromptOptions<T>): Promise<T> {
    return wrapExitPromptError(
      select({
        message: options.message,
        default: options.initialValue,
        theme: inquirerTheme,
        choices: options.options.map((opt) => ({
          value: opt.value,
          name: opt.label,
          description: opt.hint,
        })),
      })
    );
  }

  async confirm(options: ConfirmPromptOptions): Promise<boolean> {
    return wrapExitPromptError(
      confirm({
        message: options.message,
        default: options.initialValue ?? false,
        theme: inquirerTheme,
      })
    );
  }

  async multiselect<T = string>(options: {
    message: string;
    options: SelectOption<T>[];
    required?: boolean;
  }): Promise<T[]> {
    return wrapExitPromptError(
      checkbox({
        message: options.message,
        theme: {
          ...inquirerTheme,
          icon: { cursor: TON("❯"), checked: GREEN("✔"), unchecked: DIM("○") },
        },
        choices: options.options.map((opt) => ({
          value: opt.value,
          name: opt.label,
          description: opt.hint,
        })),
        required: options.required,
      })
    );
  }

  spinner(): PrompterSpinner {
    let s: ReturnType<typeof ora> | null = null;
    return {
      start: (message: string) => {
        s = ora({ text: DIM(message), color: "cyan" }).start();
      },
      stop: (message: string) => {
        if (s) s.succeed(DIM(message));
        s = null;
      },
      message: (message: string) => {
        if (s) s.text = DIM(message);
      },
    };
  }

  log(message: string): void {
    console.log(`  ${DIM("○")} ${message}`);
  }

  warn(message: string): void {
    console.log(`  ${YELLOW("⚠")} ${YELLOW(message)}`);
  }

  error(message: string): void {
    console.log(`  ${RED("✗")} ${RED(message)}`);
  }

  success(message: string): void {
    console.log(`  ${GREEN("✓")} ${GREEN(message)}`);
  }
}

export function createPrompter(): InquirerPrompter {
  return new InquirerPrompter();
}

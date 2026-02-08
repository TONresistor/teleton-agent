/**
 * Wrapper around @clack/prompts for consistent CLI UX
 */

import * as clack from "@clack/prompts";
import { setTimeout } from "timers/promises";

export interface SelectOption<T = string> {
  value: T;
  label: string;
  hint?: string;
}

export interface TextPromptOptions {
  message: string;
  placeholder?: string;
  initialValue?: string;
  validate?: (value: string) => string | undefined;
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

/**
 * CLI Prompter using @clack/prompts
 */
export class ClackPrompter {
  /**
   * Display intro banner
   */
  async intro(title: string): Promise<void> {
    clack.intro(title);
  }

  /**
   * Display outro message
   */
  async outro(message: string): Promise<void> {
    clack.outro(message);
  }

  /**
   * Display note/info
   */
  async note(message: string, title?: string): Promise<void> {
    clack.note(message, title);
  }

  /**
   * Text input prompt
   */
  async text(options: TextPromptOptions): Promise<string> {
    const result = await clack.text({
      message: options.message,
      placeholder: options.placeholder,
      initialValue: options.initialValue,
      validate: options.validate,
    });

    if (clack.isCancel(result)) {
      throw new CancelledError();
    }

    return result as string;
  }

  /**
   * Password input (hidden)
   */
  async password(options: {
    message: string;
    validate?: (value: string) => string | undefined;
  }): Promise<string> {
    const result = await clack.password({
      message: options.message,
      validate: options.validate,
    });

    if (clack.isCancel(result)) {
      throw new CancelledError();
    }

    return result as string;
  }

  /**
   * Select prompt (single choice)
   */
  async select<T = string>(options: SelectPromptOptions<T>): Promise<T> {
    const result = await clack.select({
      message: options.message,
      options: options.options.map((opt) => {
        const mapped: { value: T; label: string; hint?: string } = {
          value: opt.value,
          label: opt.label,
        };
        if (opt.hint) {
          mapped.hint = opt.hint;
        }
        return mapped;
      }) as any,
      initialValue: options.initialValue,
    });

    if (clack.isCancel(result)) {
      throw new CancelledError();
    }

    return result as T;
  }

  /**
   * Confirm (yes/no)
   */
  async confirm(options: ConfirmPromptOptions): Promise<boolean> {
    const result = await clack.confirm({
      message: options.message,
      initialValue: options.initialValue ?? false,
    });

    if (clack.isCancel(result)) {
      throw new CancelledError();
    }

    return result as boolean;
  }

  /**
   * Multi-select prompt
   */
  async multiselect<T = string>(options: {
    message: string;
    options: SelectOption<T>[];
    required?: boolean;
  }): Promise<T[]> {
    const result = await clack.multiselect({
      message: options.message,
      options: options.options.map((opt) => {
        const mapped: { value: T; label: string; hint?: string } = {
          value: opt.value,
          label: opt.label,
        };
        if (opt.hint) {
          mapped.hint = opt.hint;
        }
        return mapped;
      }) as any,
      required: options.required,
    });

    if (clack.isCancel(result)) {
      throw new CancelledError();
    }

    return result as T[];
  }

  /**
   * Spinner for long operations
   */
  spinner(): ClackSpinner {
    const s = clack.spinner();
    return {
      start: (message: string) => s.start(message),
      stop: (message: string) => s.stop(message),
      message: (message: string) => s.message(message),
    };
  }

  /**
   * Log message
   */
  log(message: string): void {
    clack.log.message(message);
  }

  /**
   * Log warning
   */
  warn(message: string): void {
    clack.log.warn(message);
  }

  /**
   * Log error
   */
  error(message: string): void {
    clack.log.error(message);
  }

  /**
   * Log success
   */
  success(message: string): void {
    clack.log.success(message);
  }
}

export interface ClackSpinner {
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

/**
 * Create a new prompter instance
 */
export function createPrompter(): ClackPrompter {
  return new ClackPrompter();
}

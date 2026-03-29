import type {
  CommandPromptAPI,
  PromptConfirmOptions,
  PromptInputOptions,
  PromptSelectOptions,
  PromptSelectOption,
} from "../api/define-command";
import { PromptUnavailableError } from "../runtime/errors";
import type { InteractionPolicy } from "../runtime/noninteractive";
import type { PromptRuntimeOptions } from "./adapter";

type OpenTUIRenderer = {
  readonly root: {
    add(node: unknown): void;
  };
  readonly keyInput: {
    on(event: string, listener: (...args: readonly unknown[]) => void): void;
  };
  destroy(): void;
  requestRender?(): void;
  start?(): void;
};

type OpenTUIRenderable = {
  add?(child: unknown): void;
  focus?(): void;
  on?(event: unknown, listener: (...args: readonly unknown[]) => void): void;
  value?: unknown;
};

type RenderableConstructor = new (
  renderer: OpenTUIRenderer,
  props: Record<string, unknown>,
) => OpenTUIRenderable;

interface OpenTUIModuleShape {
  readonly BoxRenderable: RenderableConstructor;
  readonly InputRenderable?: RenderableConstructor | undefined;
  readonly InputRenderableEvents?: Record<string, unknown> | undefined;
  readonly SelectRenderable: RenderableConstructor;
  readonly SelectRenderableEvents?: Record<string, unknown> | undefined;
  readonly TextRenderable: RenderableConstructor;
  readonly createCliRenderer: () => Promise<OpenTUIRenderer>;
}

interface OpenTUIPromptRuntimeOptions extends PromptRuntimeOptions {
  readonly interaction: InteractionPolicy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isConstructor(value: unknown): value is RenderableConstructor {
  return typeof value === "function";
}

function isRendererFactory(value: unknown): value is () => Promise<OpenTUIRenderer> {
  return typeof value === "function";
}

function normalizePromptMessage(message?: string | undefined, title?: string | undefined): string {
  return message ?? title ?? "Prompt";
}

function getKeyName(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.name !== "string") {
    return undefined;
  }

  return value.name;
}

function isCtrlKey(value: unknown): boolean {
  return isRecord(value) && value.ctrl === true;
}

function resolveEventToken(
  events: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): unknown {
  if (events && key in events) {
    return events[key];
  }

  return fallback;
}

async function loadOpenTUIModule(): Promise<OpenTUIModuleShape | null> {
  const specifier = "@opentui/core";

  try {
    const imported = await import(specifier);

    if (!isRecord(imported)) {
      return null;
    }

    if (
      !isRendererFactory(imported.createCliRenderer) ||
      !isConstructor(imported.BoxRenderable) ||
      !isConstructor(imported.TextRenderable) ||
      !isConstructor(imported.SelectRenderable)
    ) {
      return null;
    }

    const maybeInputRenderable = imported.InputRenderable;
    const maybeInputEvents = imported.InputRenderableEvents;
    const maybeSelectEvents = imported.SelectRenderableEvents;

    return {
      BoxRenderable: imported.BoxRenderable,
      InputRenderable: isConstructor(maybeInputRenderable) ? maybeInputRenderable : undefined,
      InputRenderableEvents: isRecord(maybeInputEvents) ? maybeInputEvents : undefined,
      SelectRenderable: imported.SelectRenderable,
      SelectRenderableEvents: isRecord(maybeSelectEvents) ? maybeSelectEvents : undefined,
      TextRenderable: imported.TextRenderable,
      createCliRenderer: imported.createCliRenderer,
    };
  } catch {
    return null;
  }
}

function createPromptContainer(
  moduleShape: OpenTUIModuleShape,
  renderer: OpenTUIRenderer,
  message: string,
  body: OpenTUIRenderable,
  height: number,
): void {
  const container = new moduleShape.BoxRenderable(renderer, {
    border: true,
    borderStyle: "rounded",
    height,
    id: "rempts-prompt-container",
    padding: 1,
    width: 72,
  });
  const title = new moduleShape.TextRenderable(renderer, {
    content: message,
    fg: "#8bd5ff",
    id: "rempts-prompt-title",
  });

  container.add?.(title);
  container.add?.(body);
  renderer.root.add(container);
}

async function createRenderer(moduleShape: OpenTUIModuleShape): Promise<OpenTUIRenderer> {
  const renderer = await moduleShape.createCliRenderer();
  renderer.start?.();
  return renderer;
}

function closeRenderer(renderer: OpenTUIRenderer): void {
  renderer.destroy();
}

function createCancellationError(message: string): PromptUnavailableError {
  return new PromptUnavailableError(message);
}

async function runInputPrompt(
  moduleShape: OpenTUIModuleShape,
  options: PromptInputOptions,
): Promise<string> {
  if (!moduleShape.InputRenderable) {
    throw createCancellationError("OpenTUI input prompt support is unavailable.");
  }

  const renderer = await createRenderer(moduleShape);
  const input = new moduleShape.InputRenderable(renderer, {
    id: "rempts-input",
    placeholder: options.placeholder ?? "",
    value: options.defaultValue ?? "",
    width: 64,
  });
  const changeEvent = resolveEventToken(moduleShape.InputRenderableEvents, "CHANGE", "change");
  let currentValue = options.defaultValue ?? "";

  return await new Promise<string>((resolve, reject) => {
    const settle = (callback: () => void) => {
      try {
        callback();
      } finally {
        closeRenderer(renderer);
      }
    };

    input.on?.(changeEvent, (nextValue) => {
      if (typeof nextValue === "string") {
        currentValue = nextValue;
      }
    });

    renderer.keyInput.on("keypress", (keyValue) => {
      const keyName = getKeyName(keyValue);

      if (keyName === "enter") {
        const finalValue = typeof input.value === "string" ? input.value : currentValue;
        const normalizedValue = finalValue.trim() || options.defaultValue || "";

        if (normalizedValue.length === 0 && options.required) {
          return;
        }

        settle(() => resolve(normalizedValue));
        return;
      }

      if (keyName === "escape" || (isCtrlKey(keyValue) && keyName === "c")) {
        settle(() => reject(createCancellationError("Prompt cancelled.")));
      }
    });

    createPromptContainer(
      moduleShape,
      renderer,
      normalizePromptMessage(options.message, options.title),
      input,
      7,
    );
    input.focus?.();
    renderer.requestRender?.();
  });
}

async function runSelectPrompt<TValue extends string>(
  moduleShape: OpenTUIModuleShape,
  options: PromptSelectOptions<TValue>,
): Promise<TValue> {
  const renderer = await createRenderer(moduleShape);
  const selectedIndex = options.defaultValue
    ? Math.max(
        0,
        options.options.findIndex((option) => option.value === options.defaultValue),
      )
    : 0;
  const select = new moduleShape.SelectRenderable(renderer, {
    height: Math.max(3, options.options.length + 1),
    id: "rempts-select",
    options: options.options.map((option) => ({
      description: option.description,
      name: option.label,
      value: option.value,
    })),
    selectedIndex,
    width: 64,
  });
  const itemSelectedEvent = resolveEventToken(
    moduleShape.SelectRenderableEvents,
    "ITEM_SELECTED",
    "item-selected",
  );

  return await new Promise<TValue>((resolve, reject) => {
    const settle = (callback: () => void) => {
      try {
        callback();
      } finally {
        closeRenderer(renderer);
      }
    };

    select.on?.(itemSelectedEvent, (_index, optionValue) => {
      if (isRecord(optionValue) && typeof optionValue.value === "string") {
        settle(() => resolve(optionValue.value as TValue));
        return;
      }

      settle(() => reject(createCancellationError("Prompt selection failed.")));
    });

    renderer.keyInput.on("keypress", (keyValue) => {
      const keyName = getKeyName(keyValue);

      if (keyName === "escape" || (isCtrlKey(keyValue) && keyName === "c")) {
        settle(() => reject(createCancellationError("Prompt cancelled.")));
      }
    });

    createPromptContainer(
      moduleShape,
      renderer,
      normalizePromptMessage(options.message, options.title),
      select,
      Math.max(7, options.options.length + 5),
    );
    select.focus?.();
    renderer.requestRender?.();
  });
}

export async function createOpenTUIPromptAdapter(
  options: OpenTUIPromptRuntimeOptions,
): Promise<CommandPromptAPI | null> {
  if (!options.interaction.isTUIAllowed) {
    return null;
  }

  const moduleShape = await loadOpenTUIModule();

  if (!moduleShape) {
    return null;
  }

  return {
    async confirm(promptOptions: PromptConfirmOptions): Promise<boolean> {
      const selection = await runSelectPrompt(moduleShape, {
        defaultValue: promptOptions.defaultValue ? "yes" : "no",
        message: promptOptions.message,
        options: [
          { label: "Yes", value: "yes" },
          { label: "No", value: "no" },
        ],
        title: promptOptions.title,
      });

      return selection === "yes";
    },

    async input(promptOptions: PromptInputOptions): Promise<string> {
      return runInputPrompt(moduleShape, promptOptions);
    },

    async select<TValue extends string>(
      promptOptions: PromptSelectOptions<TValue>,
    ): Promise<TValue> {
      return runSelectPrompt(moduleShape, promptOptions);
    },
  };
}

export function toSelectOptions(
  options: readonly PromptSelectOption[],
): readonly PromptSelectOption[] {
  return options;
}

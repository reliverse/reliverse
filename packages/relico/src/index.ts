import { detectColorSupport, type ColorSupportLevel, type StreamName } from "@reliverse/myenv";

export interface RelicoOptions {
  readonly color?: boolean | ColorSupportLevel | undefined;
  readonly level?: ColorSupportLevel | undefined;
  readonly stream?: StreamName | undefined;
}

export interface RelicoStyle {
  (text: unknown): string;
  readonly open: string;
  readonly close: string;
}

export interface RelicoInstance {
  readonly enabled: boolean;
  readonly level: ColorSupportLevel;
  readonly stream: StreamName;
  readonly reset: RelicoStyle;
  readonly bold: RelicoStyle;
  readonly dim: RelicoStyle;
  readonly italic: RelicoStyle;
  readonly underline: RelicoStyle;
  readonly inverse: RelicoStyle;
  readonly hidden: RelicoStyle;
  readonly strikethrough: RelicoStyle;
  readonly black: RelicoStyle;
  readonly red: RelicoStyle;
  readonly green: RelicoStyle;
  readonly yellow: RelicoStyle;
  readonly blue: RelicoStyle;
  readonly magenta: RelicoStyle;
  readonly cyan: RelicoStyle;
  readonly white: RelicoStyle;
  readonly gray: RelicoStyle;
  readonly bgBlack: RelicoStyle;
  readonly bgRed: RelicoStyle;
  readonly bgGreen: RelicoStyle;
  readonly bgYellow: RelicoStyle;
  readonly bgBlue: RelicoStyle;
  readonly bgMagenta: RelicoStyle;
  readonly bgCyan: RelicoStyle;
  readonly bgWhite: RelicoStyle;
  readonly blackBright: RelicoStyle;
  readonly redBright: RelicoStyle;
  readonly greenBright: RelicoStyle;
  readonly yellowBright: RelicoStyle;
  readonly blueBright: RelicoStyle;
  readonly magentaBright: RelicoStyle;
  readonly cyanBright: RelicoStyle;
  readonly whiteBright: RelicoStyle;
  readonly bgBlackBright: RelicoStyle;
  readonly bgRedBright: RelicoStyle;
  readonly bgGreenBright: RelicoStyle;
  readonly bgYellowBright: RelicoStyle;
  readonly bgBlueBright: RelicoStyle;
  readonly bgMagentaBright: RelicoStyle;
  readonly bgCyanBright: RelicoStyle;
  readonly bgWhiteBright: RelicoStyle;
}

const ANSI_RESET = "\u001B[0m";

function toText(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

function replaceClose(text: string, close: string, open: string): string {
  return text.includes(close) ? text.split(close).join(`${close}${open}`) : text;
}

function createStyle(open: string, close: string, enabled: boolean): RelicoStyle {
  const style = ((value: unknown) => {
    const text = toText(value);
    if (!enabled || text.length === 0) {
      return text;
    }

    return `${open}${replaceClose(text, close, open)}${close}`;
  }) as RelicoStyle;

  Object.defineProperties(style, {
    close: { value: close },
    open: { value: open },
  });

  return style;
}

function resolveLevel(options?: RelicoOptions): ColorSupportLevel {
  if (typeof options?.level === "number") {
    return options.level;
  }

  if (typeof options?.color === "number") {
    return options.color;
  }

  if (typeof options?.color === "boolean") {
    return options.color ? 1 : 0;
  }

  return detectColorSupport(options?.stream ?? "stdout");
}

function createInstance(options?: RelicoOptions): RelicoInstance {
  const stream = options?.stream ?? "stdout";
  const level = resolveLevel(options);
  const enabled = level > 0;
  const style = (open: number, close: number) => createStyle(`\u001B[${open}m`, `\u001B[${close}m`, enabled);

  return {
    bgBlack: style(40, 49),
    bgBlackBright: style(100, 49),
    bgBlue: style(44, 49),
    bgBlueBright: style(104, 49),
    bgCyan: style(46, 49),
    bgCyanBright: style(106, 49),
    bgGreen: style(42, 49),
    bgGreenBright: style(102, 49),
    bgMagenta: style(45, 49),
    bgMagentaBright: style(105, 49),
    bgRed: style(41, 49),
    bgRedBright: style(101, 49),
    bgWhite: style(47, 49),
    bgWhiteBright: style(107, 49),
    bgYellow: style(43, 49),
    bgYellowBright: style(103, 49),
    black: style(30, 39),
    blackBright: style(90, 39),
    blue: style(34, 39),
    blueBright: style(94, 39),
    bold: style(1, 22),
    cyan: style(36, 39),
    cyanBright: style(96, 39),
    dim: style(2, 22),
    enabled,
    gray: style(90, 39),
    green: style(32, 39),
    greenBright: style(92, 39),
    hidden: style(8, 28),
    inverse: style(7, 27),
    italic: style(3, 23),
    level,
    magenta: style(35, 39),
    magentaBright: style(95, 39),
    red: style(31, 39),
    redBright: style(91, 39),
    reset: createStyle(ANSI_RESET, ANSI_RESET, enabled),
    stream,
    strikethrough: style(9, 29),
    underline: style(4, 24),
    white: style(37, 39),
    whiteBright: style(97, 39),
    yellow: style(33, 39),
    yellowBright: style(93, 39),
  };
}

export function createRelico(options?: RelicoOptions): RelicoInstance {
  return createInstance(options);
}

const defaultRelico = createInstance();

export const reset = defaultRelico.reset;
export const bold = defaultRelico.bold;
export const dim = defaultRelico.dim;
export const italic = defaultRelico.italic;
export const underline = defaultRelico.underline;
export const inverse = defaultRelico.inverse;
export const hidden = defaultRelico.hidden;
export const strikethrough = defaultRelico.strikethrough;
export const black = defaultRelico.black;
export const red = defaultRelico.red;
export const green = defaultRelico.green;
export const yellow = defaultRelico.yellow;
export const blue = defaultRelico.blue;
export const magenta = defaultRelico.magenta;
export const cyan = defaultRelico.cyan;
export const white = defaultRelico.white;
export const gray = defaultRelico.gray;
export const bgBlack = defaultRelico.bgBlack;
export const bgRed = defaultRelico.bgRed;
export const bgGreen = defaultRelico.bgGreen;
export const bgYellow = defaultRelico.bgYellow;
export const bgBlue = defaultRelico.bgBlue;
export const bgMagenta = defaultRelico.bgMagenta;
export const bgCyan = defaultRelico.bgCyan;
export const bgWhite = defaultRelico.bgWhite;
export const blackBright = defaultRelico.blackBright;
export const redBright = defaultRelico.redBright;
export const greenBright = defaultRelico.greenBright;
export const yellowBright = defaultRelico.yellowBright;
export const blueBright = defaultRelico.blueBright;
export const magentaBright = defaultRelico.magentaBright;
export const cyanBright = defaultRelico.cyanBright;
export const whiteBright = defaultRelico.whiteBright;
export const bgBlackBright = defaultRelico.bgBlackBright;
export const bgRedBright = defaultRelico.bgRedBright;
export const bgGreenBright = defaultRelico.bgGreenBright;
export const bgYellowBright = defaultRelico.bgYellowBright;
export const bgBlueBright = defaultRelico.bgBlueBright;
export const bgMagentaBright = defaultRelico.bgMagentaBright;
export const bgCyanBright = defaultRelico.bgCyanBright;
export const bgWhiteBright = defaultRelico.bgWhiteBright;

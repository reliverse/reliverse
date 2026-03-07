/**
 * Simple structured logger for Convex runtime.
 *
 * Most logging libraries (pino, winston, etc.) don't work in Convex's runtime
 * environment, so this is a lightweight wrapper around console.log that provides
 * structured JSON output with timestamps, log levels, and arbitrary context.
 *
 * Log level is controlled via the LOG_LEVEL environment variable.
 *
 * @example
 * logger.info("Task created", { taskId: "123", userId: "456" })
 * // Output: { timestamp: "...", level: "INFO", message: "Task created", taskId: "123", userId: "456" }
 *
 * @example
 * logger.error("Failed to create task", { error: err.message, cause: err.cause })
 */
import { env } from "@repo/env/api";

type LogLevel = typeof env.LOG_LEVEL;

export interface BaseLogContext {
  [key: string]: unknown;
}

export type FinalLogEntry<T extends BaseLogContext = BaseLogContext> = {
  timestamp: string;
  level: string;
  message: string;
} & T;

class Logger {
  private readonly _logLevelPriorities: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  private _currentLevel: LogLevel = "info";

  constructor() {
    this._initializeLogLevelFromEnv();
  }

  private _initializeLogLevelFromEnv(): void {
    const envLogLevel = env.LOG_LEVEL;
    if (envLogLevel && this._logLevelPriorities[envLogLevel] !== undefined) {
      this._currentLevel = envLogLevel;
    } else {
      console.log(
        `LOG_LEVEL environment variable not set or invalid. Defaulting to: ${this._currentLevel.toUpperCase()}`,
      );
    }
  }

  setLogLevel(level: LogLevel): void {
    if (this._logLevelPriorities[level] === undefined) {
      console.warn(
        `Invalid log level '${level}', defaulting to '${this._currentLevel.toUpperCase()}'.`,
      );
    } else {
      this._currentLevel = level;
    }
  }

  private _shouldLog(level: LogLevel): boolean {
    return this._logLevelPriorities[level] >= this._logLevelPriorities[this._currentLevel];
  }

  private _log<T extends BaseLogContext>(level: LogLevel, entry: { message: string } & T): void {
    if (!this._shouldLog(level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const formattedEntry: FinalLogEntry<T> = {
      timestamp,
      level: level.toUpperCase(),
      ...entry,
    };

    switch (level) {
      case "info":
        console.info(formattedEntry);
        break;
      case "error":
        console.error(formattedEntry);
        break;
      case "warn":
        console.warn(formattedEntry);
        break;
      case "debug":
        console.debug(formattedEntry);
        break;
      default:
        console.log(formattedEntry); // Fallback
    }
  }

  info<T extends BaseLogContext = BaseLogContext>(message: string, context?: T): void {
    this._log("info", { message, ...(context ?? {}) } as {
      message: string;
    } & T);
  }

  error<T extends BaseLogContext = BaseLogContext>(message: string, context?: T): void {
    this._log("error", { message, ...(context ?? {}) } as {
      message: string;
    } & T);
  }

  warn<T extends BaseLogContext = BaseLogContext>(message: string, context?: T): void {
    this._log("warn", { message, ...(context ?? {}) } as {
      message: string;
    } & T);
  }

  debug<T extends BaseLogContext = BaseLogContext>(message: string, context?: T): void {
    this._log("debug", { message, ...(context ?? {}) } as {
      message: string;
    } & T);
  }
}

export const logger = new Logger();

export class GatehouseRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GatehouseRuntimeError";
    this.code = code;
  }
}

export function gatehouseError(code: string, message: string): never {
  throw new GatehouseRuntimeError(code, message);
}

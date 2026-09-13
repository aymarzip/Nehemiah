export type Result<Value, Failure extends Error = Error> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: Failure };

export const ok = <Value>(value: Value): Result<Value, never> => ({ ok: true, value });
export const err = <Failure extends Error>(error: Failure): Result<never, Failure> => ({
  ok: false,
  error,
});

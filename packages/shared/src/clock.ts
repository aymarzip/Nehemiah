export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  readonly #value: Date;

  constructor(value: Date | string) {
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new TypeError("FixedClock requires a valid date");
    }
    this.#value = new Date(parsed);
  }

  now(): Date {
    return new Date(this.#value);
  }
}

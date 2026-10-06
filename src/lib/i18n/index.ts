import { nl } from "./nl";

type Dictionary = typeof nl;

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

type Lookup<T, K extends string> = K extends `${infer H}.${infer R}`
  ? H extends keyof T
    ? Lookup<T[H], R>
    : never
  : K extends keyof T
    ? T[K]
    : never;

type Placeholders<S> = S extends `${string}{${infer V}}${infer Rest}`
  ? V | Placeholders<Rest>
  : never;

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Shape a future `en.ts` must satisfy. */
export type Messages = Widen<Dictionary>;

/** Every dotted key with a string value, e.g. "toast.orderRegistered". */
export type TranslationKey = Leaves<Dictionary>;

/** Keys without placeholders; use for data-driven lists, e.g. `{ title: PlainTranslationKey }[]`. */
export type PlainTranslationKey = {
  [K in TranslationKey]: [Placeholders<Lookup<Dictionary, K>>] extends [never] ? K : never;
}[TranslationKey];

export type TranslationVars<K extends TranslationKey> = Record<
  Placeholders<Lookup<Dictionary, K>>,
  string | number
>;

type TArgs<K extends TranslationKey> = [Placeholders<Lookup<Dictionary, K>>] extends [never]
  ? []
  : [vars: TranslationVars<K>];

export type Translate = <K extends TranslationKey>(key: K, ...args: TArgs<K>) => string;

const messages: Messages = nl;

function resolve(key: string): string {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, part)) return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : key;
}

/** Replaces {name} placeholders; unknown placeholders are left visible. */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );
}

export const t: Translate = (key, ...args) => {
  const template = resolve(key);
  const vars = args[0] as Record<string, string | number> | undefined;
  return vars ? interpolate(template, vars) : template;
};

/** Hook form of t(), so a locale switch can later be added without touching components. */
export function useT(): Translate {
  return t;
}


export interface Program {
  arguments: string[];
  command: string;
  pid: number;
  [keyword: string]: string[] | string | number;
}

export interface Query {
  pid?: string | string[] | number | undefined;
  ppid?: number | undefined;
  command?: string | RegExp | undefined;
  arguments?: string | RegExp | undefined;
  psargs?: string | string[] | undefined;
  keywords?: string | string[] | undefined;
}

export interface Signal {
  signal: string;
  timeout: number;
}

/**
 *
 * @param query
 * @param cb
 */
export function lookup(query: Query, cb: (err: Error, list: Program[]) => void): void;
export function kill(pID: number | string, cb?: (err?: Error) => void): void;
export function kill(pID: number | string, signal?: string | Signal, cb?: (err?: Error) => void): void;

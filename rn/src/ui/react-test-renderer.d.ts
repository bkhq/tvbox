// Minimal typings for the react-test-renderer copy bundled with jest-expo,
// which ships without @types. Covers only what the tests use.
declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';

  export interface ReactTestInstance {
    type: unknown;
    props: Record<string, any>;
    children: (ReactTestInstance | string)[];
    findByProps(props: Record<string, unknown>): ReactTestInstance;
    findByType(type: unknown): ReactTestInstance;
    findAllByProps(props: Record<string, unknown>): ReactTestInstance[];
    findAllByType(type: unknown): ReactTestInstance[];
    findAll(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance[];
  }

  export interface ReactTestRenderer {
    root: ReactTestInstance;
    toJSON(): unknown;
    update(element: ReactElement): void;
    unmount(): void;
  }

  export function create(element: ReactElement): ReactTestRenderer;
  export function act(callback: () => void | Promise<void>): Promise<void>;
}

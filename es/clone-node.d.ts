import type { Options } from './types';
/**
 * Error thrown when capture is aborted due to limits.
 */
export declare class CaptureAbortedError extends Error {
    readonly reason: 'timeout' | 'max_nodes';
    constructor(message: string, reason: 'timeout' | 'max_nodes');
}
export declare function cloneNode<T extends HTMLElement>(node: T, options: Options, isRoot?: boolean): Promise<T | null>;

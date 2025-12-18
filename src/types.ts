/**
 * Context object passed through the cloning process to track progress
 * and enable non-blocking behavior.
 */
export interface CloneContext {
  /**
   * Counter for number of nodes processed. Used to determine when to yield.
   */
  nodeCount: number
  /**
   * Timestamp of the last yield. Used for time-based yielding.
   */
  lastYieldTime?: number
  /**
   * Total number of nodes to process (estimated). Used for progress callbacks.
   */
  totalNodes?: number
}

export interface Options {
  /**
   * Width in pixels to be applied to node before rendering.
   */
  width?: number
  /**
   * Height in pixels to be applied to node before rendering.
   */
  height?: number
  /**
   * A string value for the background color, any valid CSS color value.
   */
  backgroundColor?: string
  /**
   * Width in pixels to be applied to canvas on export.
   */
  canvasWidth?: number
  /**
   * Height in pixels to be applied to canvas on export.
   */
  canvasHeight?: number
  /**
   * An object whose properties to be copied to node's style before rendering.
   */
  style?: Partial<CSSStyleDeclaration>
  /**
   * An array of style properties to be copied to node's style before rendering.
   * For performance-critical scenarios, users may want to specify only the
   * required properties instead of all styles.
   */
  includeStyleProperties?: string[]
  /**
   * A function taking DOM node as argument. Should return `true` if passed
   * node should be included in the output. Excluding node means excluding
   * it's children as well.
   */
  filter?: (domNode: HTMLElement) => boolean
  /**
   * A number between `0` and `1` indicating image quality (e.g. 0.92 => 92%)
   * of the JPEG image.
   */
  quality?: number
  /**
   * Set to `true` to append the current time as a query string to URL
   * requests to enable cache busting.
   */
  cacheBust?: boolean
  /**
   * Set false to use all URL as cache key.
   * Default: false | undefined - which strips away the query parameters
   */
  includeQueryParams?: boolean
  /**
   * A data URL for a placeholder image that will be used when fetching
   * an image fails. Defaults to an empty string and will render empty
   * areas for failed images.
   */
  imagePlaceholder?: string
  /**
   * The pixel ratio of captured image. Defalut is the actual pixel ratio of
   * the device. Set 1 to use as initial-scale 1 for the image
   */
  pixelRatio?: number
  /**
   * Option to skip the fonts download and embed.
   */
  skipFonts?: boolean
  /**
   * The preferred font format. If specified all other font formats are ignored.
   */
  preferredFontFormat?:
    | 'woff'
    | 'woff2'
    | 'truetype'
    | 'opentype'
    | 'embedded-opentype'
    | 'svg'
    | string
  /**
   * A CSS string to specify for font embeds. If specified only this CSS will
   * be present in the resulting image. Use with `getFontEmbedCSS()` to
   * create embed CSS for use across multiple calls to library functions.
   */
  fontEmbedCSS?: string
  /**
   * A boolean to turn off auto scaling for truly massive images..
   */
  skipAutoScale?: boolean
  /**
   * A string indicating the image format. The default type is image/png; that type is also used if the given type isn't supported.
   */
  type?: string

  /**
   *
   *the second parameter of  window.fetch (Promise<Response> fetch(input[, init]))
   *
   */
  fetchRequestInit?: RequestInit
  /**
   * An event handler for the error event when any image in html has problem with loading.
   */
  onImageErrorHandler?: OnErrorEventHandler

  // ============================================
  // NON-BLOCKING OPTIONS (Performance Tuning)
  // ============================================

  /**
   * Enable non-blocking mode. When true, the library will periodically yield
   * to the main thread during DOM traversal and cloning, preventing UI freezes.
   *
   * @default false
   */
  nonBlocking?: boolean

  /**
   * Number of nodes to process before yielding to the main thread.
   * Lower values = more responsive UI but slower total time.
   * Higher values = faster total time but may cause UI jank.
   *
   * Note: If `yieldBudget` is set, time-based yielding takes precedence.
   * Only applies when `nonBlocking` is true.
   * @default 50
   */
  yieldEvery?: number

  /**
   * Maximum time in milliseconds to spend on processing before yielding to the main thread.
   * This enables time-based yielding instead of node-count based yielding.
   * Recommended value: 16ms (one frame at 60fps) for maximum responsiveness.
   *
   * When set, this takes precedence over `yieldEvery`.
   * Only applies when `nonBlocking` is true.
   * @default undefined (uses node-count based yielding)
   */
  yieldBudget?: number

  /**
   * Progress callback that gets invoked periodically during capture.
   * Receives the number of nodes processed and the total estimated nodes.
   *
   * Only applies when `nonBlocking` is true.
   * @param processed Number of nodes processed so far
   * @param total Total number of nodes to process (estimated)
   */
  onProgress?: (processed: number, total: number) => void

  /**
   * Maximum number of nodes to process. If the DOM exceeds this count,
   * the capture will be aborted and the promise will reject.
   * Set to 0 or undefined to disable the limit.
   *
   * @default undefined (no limit)
   */
  maxNodes?: number

  /**
   * Maximum time in milliseconds to spend on capture. If exceeded,
   * the capture will be aborted and the promise will reject.
   * Set to 0 or undefined to disable the timeout.
   *
   * @default undefined (no timeout)
   */
  timeout?: number

  /**
   * Internal context object for tracking progress. Not meant to be set by users.
   * @internal
   */
  _context?: CloneContext

  /**
   * Internal start time for timeout tracking.
   * @internal
   */
  _startTime?: number
}

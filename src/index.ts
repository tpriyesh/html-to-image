/* eslint-disable no-underscore-dangle */
import { Options } from './types'
import { cloneNode, CaptureAbortedError } from './clone-node'
import { embedImages } from './embed-images'
import { applyStyle } from './apply-style'
import { embedWebFonts, getWebFontCSS } from './embed-webfonts'
import {
  getImageSize,
  getPixelRatio,
  createImage,
  canvasToBlob,
  nodeToDataURL,
  checkCanvasDimensions,
} from './util'

// Re-export error class for consumers
export { CaptureAbortedError }

/**
 * Initializes the options with context for non-blocking mode.
 * This is called at the start of each public API function.
 * @param node The node being captured (for estimating total nodes)
 * @param options The user-provided options
 */
function initializeOptions<T extends HTMLElement>(
  node: T,
  options: Options,
): Options {
  const initialized = { ...options }

  // Initialize context for tracking progress
  if (
    options.nonBlocking ||
    options.maxNodes ||
    options.timeout ||
    options.onProgress
  ) {
    const domNodes = estimateDOMComplexity(node)

    // The library traverses the DOM multiple times:
    // 1. cloneNode() - clones entire tree
    // 2. embedImages() - traverses again for images
    // 3. embedWebFonts() - traverses again for fonts
    // So total operations ≈ domNodes × 2.5 (not all phases visit all nodes)
    const estimatedTotalOps = Math.floor(domNodes * 2.5)

    // eslint-disable-next-line no-underscore-dangle
    initialized._context = {
      nodeCount: 0,
      lastYieldTime: Date.now(),
      totalNodes: estimatedTotalOps,
    }
    // eslint-disable-next-line no-underscore-dangle
    initialized._startTime = Date.now()
  }

  return initialized
}

/**
 * Estimates the DOM complexity before starting capture.
 * Returns the total number of nodes.
 */
function estimateDOMComplexity(node: HTMLElement): number {
  return node.querySelectorAll('*').length + 1
}

/**
 * Pre-flight check for DOM complexity.
 * Throws CaptureAbortedError if maxNodes would be exceeded.
 */
function checkDOMComplexity(node: HTMLElement, options: Options): void {
  if (options.maxNodes) {
    const nodeCount = estimateDOMComplexity(node)
    if (nodeCount > options.maxNodes) {
      throw new CaptureAbortedError(
        `Capture aborted: DOM has ${nodeCount} nodes, exceeds maximum of ${options.maxNodes}`,
        'max_nodes',
      )
    }
  }
}

export async function toSvg<T extends HTMLElement>(
  node: T,
  options: Options = {},
): Promise<string> {
  // Initialize options with context for non-blocking mode
  const opts = initializeOptions(node, options)

  // Pre-flight check for DOM complexity
  checkDOMComplexity(node, opts)

  const { width, height } = getImageSize(node, opts)
  const clonedNode = (await cloneNode(node, opts, true)) as HTMLElement
  await embedWebFonts(clonedNode, opts)
  await embedImages(clonedNode, opts)
  applyStyle(clonedNode, opts)
  const datauri = await nodeToDataURL(clonedNode, width, height)
  return datauri
}

export async function toCanvas<T extends HTMLElement>(
  node: T,
  options: Options = {},
): Promise<HTMLCanvasElement> {
  // toSvg will handle initialization, so just pass options through
  const { width, height } = getImageSize(node, options)
  const svg = await toSvg(node, options)
  const img = await createImage(svg)

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  const ratio = options.pixelRatio || getPixelRatio()
  const canvasWidth = options.canvasWidth || width
  const canvasHeight = options.canvasHeight || height

  canvas.width = canvasWidth * ratio
  canvas.height = canvasHeight * ratio

  if (!options.skipAutoScale) {
    checkCanvasDimensions(canvas)
  }
  canvas.style.width = `${canvasWidth}`
  canvas.style.height = `${canvasHeight}`

  if (options.backgroundColor) {
    context.fillStyle = options.backgroundColor
    context.fillRect(0, 0, canvas.width, canvas.height)
  }

  context.drawImage(img, 0, 0, canvas.width, canvas.height)

  return canvas
}

export async function toPixelData<T extends HTMLElement>(
  node: T,
  options: Options = {},
): Promise<Uint8ClampedArray> {
  const { width, height } = getImageSize(node, options)
  const canvas = await toCanvas(node, options)
  const ctx = canvas.getContext('2d')!
  return ctx.getImageData(0, 0, width, height).data
}

export async function toPng<T extends HTMLElement>(
  node: T,
  options: Options = {},
): Promise<string> {
  const canvas = await toCanvas(node, options)
  return canvas.toDataURL()
}

export async function toJpeg<T extends HTMLElement>(
  node: T,
  options: Options = {},
): Promise<string> {
  const canvas = await toCanvas(node, options)
  return canvas.toDataURL('image/jpeg', options.quality || 1)
}

export async function toBlob<T extends HTMLElement>(
  node: T,
  options: Options = {},
): Promise<Blob | null> {
  const canvas = await toCanvas(node, options)
  const blob = await canvasToBlob(canvas)
  return blob
}

export async function getFontEmbedCSS<T extends HTMLElement>(
  node: T,
  options: Options = {},
): Promise<string> {
  // Initialize options for consistency (though fonts don't use yielding much)
  const opts = initializeOptions(node, options)
  return getWebFontCSS(node, opts)
}

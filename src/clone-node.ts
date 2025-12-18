/* eslint-disable no-underscore-dangle, no-plusplus, no-await-in-loop, no-restricted-syntax */
import type { Options } from './types'
import { clonePseudoElements } from './clone-pseudos'
import {
  createImage,
  toArray,
  isInstanceOfElement,
  getStyleProperties,
  yieldToMain,
} from './util'
import { getMimeType } from './mimes'
import { resourceToDataURL } from './dataurl'

/**
 * Error thrown when capture is aborted due to limits.
 */
export class CaptureAbortedError extends Error {
  constructor(
    message: string,
    public readonly reason: 'timeout' | 'max_nodes',
  ) {
    super(message)
    this.name = 'CaptureAbortedError'
  }
}

/**
 * Checks if the capture should be aborted due to timeout or node limits.
 * Throws CaptureAbortedError if limits are exceeded.
 */
function checkLimits(options: Options): void {
  const context = options._context

  // Check max nodes limit
  if (options.maxNodes && context && context.nodeCount >= options.maxNodes) {
    throw new CaptureAbortedError(
      `Capture aborted: exceeded maximum node limit of ${options.maxNodes}`,
      'max_nodes',
    )
  }

  // Check timeout
  if (options.timeout && options._startTime) {
    const elapsed = Date.now() - options._startTime
    if (elapsed >= options.timeout) {
      throw new CaptureAbortedError(
        `Capture aborted: exceeded timeout of ${options.timeout}ms`,
        'timeout',
      )
    }
  }
}

/**
 * Yields to main thread if non-blocking mode is enabled.
 * Supports both time-based and node-count based yielding.
 * Invokes progress callback if provided.
 */
async function maybeYieldToMain(options: Options): Promise<void> {
  if (!options.nonBlocking || !options._context) {
    return
  }

  const context = options._context
  context.nodeCount++

  // Check limits before continuing
  checkLimits(options)

  // Invoke progress callback if provided
  if (options.onProgress && context.totalNodes) {
    options.onProgress(context.nodeCount, context.totalNodes)
  }

  let shouldYield = false

  // Time-based yielding (takes precedence)
  if (options.yieldBudget !== undefined) {
    const timeSinceLastYield =
      Date.now() - (context.lastYieldTime ?? options._startTime ?? Date.now())
    if (timeSinceLastYield >= options.yieldBudget) {
      shouldYield = true
    }
  }
  // Node-count based yielding (fallback)
  else {
    const yieldEvery = options.yieldEvery ?? 50
    if (context.nodeCount % yieldEvery === 0) {
      shouldYield = true
    }
  }

  if (shouldYield) {
    context.lastYieldTime = Date.now()
    await yieldToMain()
  }
}

/**
 * Clones a canvas element by converting it to an image.
 * For large canvases, uses OffscreenCanvas in chunks to avoid blocking.
 */
async function cloneCanvasElement(
  canvas: HTMLCanvasElement,
  options?: Options,
) {
  // Check if canvas is empty
  const testDataURL = canvas.toDataURL()
  if (testDataURL === 'data:,') {
    return canvas.cloneNode(false) as HTMLCanvasElement
  }

  const width = canvas.width
  const height = canvas.height
  const isLargeCanvas = width * height > 500000 // > 500K pixels

  // For small canvases or if OffscreenCanvas not supported, use original method
  if (!isLargeCanvas || !('OffscreenCanvas' in window)) {
    return createImage(testDataURL)
  }

  // For large canvases: Use chunked approach to avoid long blocking
  try {
    const dataURL = await canvasToDataURLChunked(canvas, options)
    return createImage(dataURL)
  } catch (e) {
    // Fallback to synchronous method
    console.warn('Chunked canvas capture failed, using fallback:', e)
    return createImage(canvas.toDataURL())
  }
}

/**
 * Converts a large canvas to data URL in chunks to avoid blocking.
 * Uses ImageData chunks and yields between processing.
 */
async function canvasToDataURLChunked(
  sourceCanvas: HTMLCanvasElement,
  options?: Options,
): Promise<string> {
  const width = sourceCanvas.width
  const height = sourceCanvas.height
  const ctx = sourceCanvas.getContext('2d')

  if (!ctx) {
    return sourceCanvas.toDataURL()
  }

  // Create an OffscreenCanvas for the final composition
  const offscreen = new OffscreenCanvas(width, height)
  const offCtx = offscreen.getContext(
    '2d',
  ) as OffscreenCanvasRenderingContext2D | null

  if (!offCtx) {
    return sourceCanvas.toDataURL()
  }

  // Process in horizontal strips to yield periodically
  const STRIP_HEIGHT = 256 // Process 256 rows at a time
  const totalStrips = Math.ceil(height / STRIP_HEIGHT)

  for (let i = 0; i < totalStrips; i += 1) {
    const y = i * STRIP_HEIGHT
    const stripHeight = Math.min(STRIP_HEIGHT, height - y)

    // Get image data for this strip
    const imageData = ctx.getImageData(0, y, width, stripHeight)

    // Put it on the offscreen canvas
    offCtx.putImageData(imageData, 0, y)

    // Yield to main thread between strips (if non-blocking mode)
    if (options?.nonBlocking && i % 4 === 3) {
      // eslint-disable-next-line no-await-in-loop
      await yieldToMain()
    }
  }

  // Convert to blob (this part still blocks but for smaller data)
  const blob = await (offscreen as any).convertToBlob({ type: 'image/png' })

  // Convert blob to data URL
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function cloneVideoElement(video: HTMLVideoElement, options: Options) {
  if (video.currentSrc) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = video.clientWidth
    canvas.height = video.clientHeight
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataURL = canvas.toDataURL()
    return createImage(dataURL)
  }

  const poster = video.poster
  const contentType = getMimeType(poster)
  const dataURL = await resourceToDataURL(poster, contentType, options)
  return createImage(dataURL)
}

async function cloneIFrameElement(iframe: HTMLIFrameElement, options: Options) {
  try {
    if (iframe?.contentDocument?.body) {
      return (await cloneNode(
        iframe.contentDocument.body,
        options,
        true,
      )) as HTMLBodyElement
    }
  } catch {
    // Failed to clone iframe
  }

  return iframe.cloneNode(false) as HTMLIFrameElement
}

async function cloneSingleNode<T extends HTMLElement>(
  node: T,
  options: Options,
): Promise<HTMLElement> {
  if (isInstanceOfElement(node, HTMLCanvasElement)) {
    return cloneCanvasElement(node, options)
  }

  if (isInstanceOfElement(node, HTMLVideoElement)) {
    return cloneVideoElement(node, options)
  }

  if (isInstanceOfElement(node, HTMLIFrameElement)) {
    return cloneIFrameElement(node, options)
  }

  return node.cloneNode(isSVGElement(node)) as T
}

const isSlotElement = (node: HTMLElement): node is HTMLSlotElement =>
  node.tagName != null && node.tagName.toUpperCase() === 'SLOT'

const isSVGElement = (node: HTMLElement): node is HTMLSlotElement =>
  node.tagName != null && node.tagName.toUpperCase() === 'SVG'

async function cloneChildren<T extends HTMLElement>(
  nativeNode: T,
  clonedNode: T,
  options: Options,
): Promise<T> {
  if (isSVGElement(clonedNode)) {
    return clonedNode
  }

  let children: T[] = []

  if (isSlotElement(nativeNode) && nativeNode.assignedNodes) {
    children = toArray<T>(nativeNode.assignedNodes())
  } else if (
    isInstanceOfElement(nativeNode, HTMLIFrameElement) &&
    nativeNode.contentDocument?.body
  ) {
    children = toArray<T>(nativeNode.contentDocument.body.childNodes)
  } else {
    children = toArray<T>((nativeNode.shadowRoot ?? nativeNode).childNodes)
  }

  if (
    children.length === 0 ||
    isInstanceOfElement(nativeNode, HTMLVideoElement)
  ) {
    return clonedNode
  }

  // Process children with periodic yielding to prevent UI blocking
  for (const child of children) {
    // Yield to main thread periodically (if non-blocking mode enabled)
    await maybeYieldToMain(options)

    const clonedChild = await cloneNode(child, options)
    if (clonedChild) {
      clonedNode.appendChild(clonedChild)
    }
  }

  return clonedNode
}

function cloneCSSStyle<T extends HTMLElement>(
  nativeNode: T,
  clonedNode: T,
  options: Options,
) {
  const targetStyle = clonedNode.style
  if (!targetStyle) {
    return
  }

  const sourceStyle = window.getComputedStyle(nativeNode)
  if (sourceStyle.cssText) {
    targetStyle.cssText = sourceStyle.cssText
    targetStyle.transformOrigin = sourceStyle.transformOrigin
  } else {
    getStyleProperties(options).forEach((name) => {
      let value = sourceStyle.getPropertyValue(name)
      if (name === 'font-size' && value.endsWith('px')) {
        const reducedFont =
          Math.floor(parseFloat(value.substring(0, value.length - 2))) - 0.1
        value = `${reducedFont}px`
      }

      if (
        isInstanceOfElement(nativeNode, HTMLIFrameElement) &&
        name === 'display' &&
        value === 'inline'
      ) {
        value = 'block'
      }

      if (name === 'd' && clonedNode.getAttribute('d')) {
        value = `path(${clonedNode.getAttribute('d')})`
      }

      targetStyle.setProperty(
        name,
        value,
        sourceStyle.getPropertyPriority(name),
      )
    })
  }
}

function cloneInputValue<T extends HTMLElement>(nativeNode: T, clonedNode: T) {
  if (isInstanceOfElement(nativeNode, HTMLTextAreaElement)) {
    clonedNode.innerHTML = nativeNode.value
  }

  if (isInstanceOfElement(nativeNode, HTMLInputElement)) {
    clonedNode.setAttribute('value', nativeNode.value)
  }
}

function cloneSelectValue<T extends HTMLElement>(nativeNode: T, clonedNode: T) {
  if (isInstanceOfElement(nativeNode, HTMLSelectElement)) {
    const clonedSelect = clonedNode as any as HTMLSelectElement
    const selectedOption = Array.from(clonedSelect.children).find(
      (child) => nativeNode.value === child.getAttribute('value'),
    )

    if (selectedOption) {
      selectedOption.setAttribute('selected', '')
    }
  }
}

function decorate<T extends HTMLElement>(
  nativeNode: T,
  clonedNode: T,
  options: Options,
): T {
  if (isInstanceOfElement(clonedNode, Element)) {
    cloneCSSStyle(nativeNode, clonedNode, options)
    clonePseudoElements(nativeNode, clonedNode, options)
    cloneInputValue(nativeNode, clonedNode)
    cloneSelectValue(nativeNode, clonedNode)
  }

  return clonedNode
}

async function ensureSVGSymbols<T extends HTMLElement>(
  clone: T,
  options: Options,
) {
  const uses = clone.querySelectorAll ? clone.querySelectorAll('use') : []
  if (uses.length === 0) {
    return clone
  }

  const processedDefs: { [key: string]: HTMLElement } = {}
  for (let i = 0; i < uses.length; i++) {
    // Yield periodically during SVG symbol processing
    await maybeYieldToMain(options)

    const use = uses[i]
    const id = use.getAttribute('xlink:href')
    if (id) {
      const exist = clone.querySelector(id)
      const definition = document.querySelector(id) as HTMLElement
      if (!exist && definition && !processedDefs[id]) {
        // eslint-disable-next-line no-await-in-loop
        processedDefs[id] = (await cloneNode(definition, options, true))!
      }
    }
  }

  const nodes = Object.values(processedDefs)
  if (nodes.length) {
    const ns = 'http://www.w3.org/1999/xhtml'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('xmlns', ns)
    svg.style.position = 'absolute'
    svg.style.width = '0'
    svg.style.height = '0'
    svg.style.overflow = 'hidden'
    svg.style.display = 'none'

    const defs = document.createElementNS(ns, 'defs')
    svg.appendChild(defs)

    for (let i = 0; i < nodes.length; i++) {
      defs.appendChild(nodes[i])
    }

    clone.appendChild(svg)
  }

  return clone
}

export async function cloneNode<T extends HTMLElement>(
  node: T,
  options: Options,
  isRoot?: boolean,
): Promise<T | null> {
  if (!isRoot && options.filter && !options.filter(node)) {
    return null
  }

  return Promise.resolve(node)
    .then((clonedNode) => cloneSingleNode(clonedNode, options) as Promise<T>)
    .then((clonedNode) => cloneChildren(node, clonedNode, options))
    .then((clonedNode) => decorate(node, clonedNode, options))
    .then((clonedNode) => ensureSVGSymbols(clonedNode, options))
}

import { embedResources } from './embed-resources';
import { toArray, isInstanceOfElement, yieldToMain } from './util';
import { isDataUrl, resourceToDataURL } from './dataurl';
import { getMimeType } from './mimes';
/**
 * Yields to main thread if non-blocking mode is enabled.
 * Supports both time-based and node-count based yielding.
 * Invokes progress callback if provided.
 */
async function maybeYieldToMain(options) {
    var _a, _b, _c;
    if (!options.nonBlocking || !options._context) {
        return;
    }
    const context = options._context;
    context.nodeCount++;
    // Invoke progress callback if provided
    if (options.onProgress && context.totalNodes) {
        options.onProgress(context.nodeCount, context.totalNodes);
    }
    let shouldYield = false;
    // Time-based yielding (takes precedence)
    if (options.yieldBudget !== undefined) {
        const timeSinceLastYield = Date.now() - ((_b = (_a = context.lastYieldTime) !== null && _a !== void 0 ? _a : options._startTime) !== null && _b !== void 0 ? _b : Date.now());
        if (timeSinceLastYield >= options.yieldBudget) {
            shouldYield = true;
        }
    }
    // Node-count based yielding (fallback)
    else {
        const yieldEvery = (_c = options.yieldEvery) !== null && _c !== void 0 ? _c : 50;
        if (context.nodeCount % yieldEvery === 0) {
            shouldYield = true;
        }
    }
    if (shouldYield) {
        context.lastYieldTime = Date.now();
        await yieldToMain();
    }
}
async function embedProp(propName, node, options) {
    var _a;
    const propValue = (_a = node.style) === null || _a === void 0 ? void 0 : _a.getPropertyValue(propName);
    if (propValue) {
        const cssString = await embedResources(propValue, null, options);
        node.style.setProperty(propName, cssString, node.style.getPropertyPriority(propName));
        return true;
    }
    return false;
}
async function embedBackground(clonedNode, options) {
    ;
    (await embedProp('background', clonedNode, options)) ||
        (await embedProp('background-image', clonedNode, options));
    (await embedProp('mask', clonedNode, options)) ||
        (await embedProp('-webkit-mask', clonedNode, options)) ||
        (await embedProp('mask-image', clonedNode, options)) ||
        (await embedProp('-webkit-mask-image', clonedNode, options));
}
async function embedImageNode(clonedNode, options) {
    const isImageElement = isInstanceOfElement(clonedNode, HTMLImageElement);
    if (!(isImageElement && !isDataUrl(clonedNode.src)) &&
        !(isInstanceOfElement(clonedNode, SVGImageElement) &&
            !isDataUrl(clonedNode.href.baseVal))) {
        return;
    }
    const url = isImageElement ? clonedNode.src : clonedNode.href.baseVal;
    const dataURL = await resourceToDataURL(url, getMimeType(url), options);
    await new Promise((resolve, reject) => {
        clonedNode.onload = resolve;
        clonedNode.onerror = options.onImageErrorHandler
            ? (...attributes) => {
                try {
                    resolve(options.onImageErrorHandler(...attributes));
                }
                catch (error) {
                    reject(error);
                }
            }
            : reject;
        const image = clonedNode;
        if (image.decode) {
            image.decode = resolve;
        }
        if (image.loading === 'lazy') {
            image.loading = 'eager';
        }
        if (isImageElement) {
            clonedNode.srcset = '';
            clonedNode.src = dataURL;
        }
        else {
            clonedNode.href.baseVal = dataURL;
        }
    });
}
async function embedChildren(clonedNode, options) {
    const children = toArray(clonedNode.childNodes);
    // Process children with periodic yielding to prevent UI blocking
    for (const child of children) {
        await maybeYieldToMain(options);
        await embedImages(child, options);
    }
}
export async function embedImages(clonedNode, options) {
    if (isInstanceOfElement(clonedNode, Element)) {
        await embedBackground(clonedNode, options);
        await embedImageNode(clonedNode, options);
        await embedChildren(clonedNode, options);
    }
}
//# sourceMappingURL=embed-images.js.map
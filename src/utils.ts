import { AllHtmlEntities as Entities } from 'html-entities'
import _ from 'lodash'
import blocks from './block-tags.json'
import treeAdapter from './tree-adapter'
import voids from './void-tags.json'

export function isElement(val?: treeAdapter.Node | null): val is treeAdapter.Element {
    return !!(val && treeAdapter.isElementNode(val))
}

export function isParentNode(val?: treeAdapter.Node | null): val is treeAdapter.ParentNode {
    return !!(val && 'childNodes' in val && val['childNodes'])
}

export function assertIsElement(val?: treeAdapter.Node | null): asserts val is treeAdapter.Element {
    if (!isElement(val))
        throw new Error('Expected Element')
}

/**
 * Wrap code with delimiters
 * @param {String} code
 * @param {String} delimiter The delimiter to start with, additional backticks
 * will be added if needed; like if the code contains a sequence of backticks
 * that would end the code block prematurely.
 */
export function delimitCode(code: string, delimiter: string) {
    while (new RegExp(`([^\`]|^)${delimiter}([^\`]|$)`).test(code)) {
        // Make sure that the delimiter isn't being used inside of the text. If it
        // is, we need to increase the number of times the delimiter is repeated.
        delimiter += '`'
    }

    if (code[0] === '`') {
        code = ` ${code}`
    } // add starting space
    if (code.slice(-1) === '`') {
        code += ' '
    } // add ending space
    return delimiter + code + delimiter
}

export function getAttribute(node: treeAdapter.Node, attribute: string) {
    return treeAdapter.getAttrList(node).find(attr => attr.name === attribute)?.value || null
}

/**
 * Check if node has more attributes than ones provided
 * @return {boolean} true if no extra attributes otherwise false
 */
export function noExtraAttributes(node: treeAdapter.Node, ...attributes: string[]) {
    const attrSet = new Set(attributes)
    return !treeAdapter.getAttrList(node).find(({ name }) => !attrSet.has(name))
}

export function cleanText(node: treeAdapter.Node) {
    const parent = node.parentNode

    let text = decodeHtmlEntities(treeAdapter.getTextNodeContent(node))

    if (![isElement(parent) && parent.tagName, isElement(parent.parentNode) ? parent.parentNode.tagName : undefined].includes('pre')) {
        text = text.replace(/\s+/g, ' ') // excessive whitespace & linebreaks
    }

    if (isElement(parent) && ['code', 'pre'].includes(parent.tagName)) {
        // these tags contain whitespace-sensitive content, so we can't apply
        // advanced text cleaning
        return text
    } else {
        return text
            .replace(/\u2014/g, '--'  /* em-dashes */)
            .replace(/\u2018|\u2019/g, '\'' /* opening/closing singles & apostrophes */)
            .replace(/\u201c|\u201d/g, '"' /* opening/closing doubles */)
            .replace(/\u2026/g, '...' /* ellipses */)
    }
}

const htmlEntities = new Entities()
export function decodeHtmlEntities(text: string) {
    return htmlEntities.decode(text)
}

const blocksSet = new Set(blocks)
export function isBlock(node: treeAdapter.Node) {
    if (isElement(node))
        if (node.tagName === 'code' && (isElement(node.parentNode) ? node.parentNode.tagName : undefined) === 'pre') {
            return true // code tags in a pre are treated as blocks
        } else {
            return blocksSet.has(node.tagName)
        }

    return false
}

const voidsSet = new Set(voids)
export function isVoid(node: treeAdapter.Node) {
    return isElement(node) && voidsSet.has(node.tagName)
}

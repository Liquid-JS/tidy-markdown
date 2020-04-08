import fm from 'front-matter'
import yaml from 'js-yaml'
import _ from 'lodash'
import marked from 'marked'
import { parseFragment } from 'parse5'
import { ConverterFilter, Converters, Link } from './converters'
import { assertIsConverterNode, ConverterNode, isConverterNode } from './node'
import treeAdapter from './tree-adapter'
import { cleanText, isBlock, isElement, isParentNode } from './utils'

const {
    createElement,
    detachNode,
    getCommentNodeContent,
    getTextNodeContent,
    insertBefore,
    insertText,
    isCommentNode,
    isTextNode
} = treeAdapter

/**
 * Some people accidently skip levels in their headers (like jumping from h1 to
 * h3), which screws up things like tables of contents. This function fixes
 * that.
 * The algorithm assumes that relations between nearby headers are correct and
 * will try to preserve them. For example, "h1, h3, h3" becomes "h1, h2, h2"
 * rather than "h1, h2, h3".
 */
function fixHeaders(dom: treeAdapter.Node, ensureFirstHeaderIsH1: boolean) {
    const topLevelHeaders = new Array<treeAdapter.Element>() // the headers that aren't nested in any other elements
    if (isParentNode(dom))
        for (const child of Array.from(dom.childNodes)) {
            if (isElement(child) && /h[0-6]/.test(child.tagName)) {
                topLevelHeaders.push(child)
            }
        }

    // there are no headers in this document, so skip
    if (topLevelHeaders.length === 0) {
        return
    }

    // by starting at 0, we force the first header to be an h1 (or an h0, but that
    // doesn't exist)
    let lastHeaderDepth = 0

    if (!ensureFirstHeaderIsH1) {
        // set the depth to `firstHeaderDepth - 1` so the rest of the function will
        // act as though that was the root
        lastHeaderDepth = parseInt(topLevelHeaders[0].tagName.charAt(1), 10) - 1 || 0
    }

    // we track the rootDepth to ensure that no headers go "below" the level of the
    // first one. for example h3, h4, h2 would need to be corrected to h3, h4, h3.
    // this is really only needed when the first header isn't an h1.
    const rootDepth = lastHeaderDepth + 1

    let i = 0
    while (i < topLevelHeaders.length) {
        const headerDepth = parseInt(topLevelHeaders[i].tagName.charAt(1), 10)
        if (rootDepth <= headerDepth && headerDepth <= lastHeaderDepth + 1) {
            lastHeaderDepth = headerDepth // header follows all rules, move on to next
        } else {
            // find all the children of that header and cut them down by the amount in
            // the gap between the offending header and the last good header. For
            // example, a jump from h1 to h3 would be `gap = 1` and all headers
            // directly following that h3 which are h3 or greater would need to be
            // reduced by 1 level. and of course the offending header is reduced too.
            // if the issue is that the offending header is below the root header, then
            // the same procedure is applied, but *increasing* the offending header &
            // children to the nearest acceptable level.
            const gap = headerDepth <= rootDepth
                ? headerDepth - rootDepth
                : headerDepth - (lastHeaderDepth + 1)

            for (let e = i; e < topLevelHeaders.length; e++) {
                const childHeaderDepth = parseInt(topLevelHeaders[e].tagName.charAt(1), 10)
                if (childHeaderDepth >= headerDepth) {
                    topLevelHeaders[e].tagName = `h${childHeaderDepth - gap}`
                } else {
                    break
                }
            }

            // don't let it increment `i`. we need to get the offending header checked
            // again so it sets the new `lastHeaderDepth`
            continue
        }
        i++
    }
}

function convertCommentNode(node: treeAdapter.Node) {
    const commentElement = createElement('_comment', null!, [])
    insertText(commentElement, getCommentNodeContent(node))
    insertBefore(node.parent, commentElement, node)
    detachNode(node)
    return commentElement as treeAdapter.Element
}

/**
 * Flattens DOM tree into single array
 */
function bfsOrder(node: treeAdapter.Node) {
    const inqueue = [node]
    const outqueue = new Array<treeAdapter.Node>()
    while (inqueue.length > 0) {
        const elem = inqueue.shift()!
        outqueue.push(elem)
        if (isParentNode(elem))
            inqueue.push(...elem.childNodes
                .map(child => isCommentNode(child)
                    ? convertCommentNode(child as treeAdapter.CommentNode)
                    : child
                )
                .filter(isElement)
            )
    }

    outqueue.shift() // remove root node
    return outqueue
}

function getChildText(child: treeAdapter.Node) {
    if (isConverterNode(child)) {
        return child._replacement
    } else if (isTextNode(child)) {
        return cleanText(child)
    } else {
        throw new Error(`Unsupported node type: ${child.type}`)
    }
}

/**
 * Contructs a Markdown string of replacement text for a given node
 */
function getContent(node: treeAdapter.Node) {
    if (isTextNode(node)) {
        return getTextNodeContent(node)
    }

    let content = ''
    let previousSibling: treeAdapter.Node | null = null

    if (isParentNode(node))
        node.childNodes.forEach(child => {
            let childText = getChildText(child)

            // prevent extra whitespace around `<br>`s
            if (isElement(child) && child.tagName === 'br') {
                content = content.trimRight()
            }
            if ((isElement(previousSibling) ? previousSibling.tagName : undefined) === 'br') {
                childText = childText.trimLeft()
            }

            if (previousSibling != null) {
                const leading = isConverterNode(child) && child._whitespace?.leading || ''
                const trailing = isConverterNode(previousSibling) && previousSibling._whitespace?.trailing || ''
                content += `${leading}${trailing}`.replace(/\n{3,}/, '\n\n')
            }

            content += childText
            previousSibling = child
        })

    return content
}

function canConvert(node: treeAdapter.Node, filter: ConverterFilter) {
    if (typeof filter === 'string') {
        return isElement(node) && filter === node.tagName
    } else if (Array.isArray(filter)) {
        return isElement(node) && Array.from(filter).includes(node.tagName)
    } else if (typeof filter === 'function') {
        return filter(node)
    } else {
        throw new TypeError('`filter` needs to be a string, array, or function')
    }
}

function findConverter(node: treeAdapter.Node) {
    return Converters.find(converter => canConvert(node, converter.filter))
}

function isFlankedByWhitespace(side: 'left' | 'right', node: treeAdapter.Node) {
    let regExp: RegExp
    let sibling: treeAdapter.Node | undefined

    if (side === 'left') {
        sibling = node.previousSibling
        regExp = /\s$/
    } else {
        sibling = node.nextSibling
        regExp = /^\s/
    }

    if (sibling && !isBlock(sibling)) {
        return regExp.test(getContent(sibling))
    } else {
        return false
    }
}

function flankingWhitespace(node: treeAdapter.Node) {
    let leading = ''
    let trailing = ''

    if (!isBlock(node)) {
        const content = getContent(node)
        const hasLeading = /^\s/.test(content)
        const hasTrailing = /\s$/.test(content)
        if (hasLeading && !isFlankedByWhitespace('left', node)) {
            leading = ' '
        }
        if (hasTrailing && !isFlankedByWhitespace('right', node)) {
            trailing = ' '
        }
    }

    // add whitespace from leading / trailing whitespace attributes in first / last
    // child nodes
    if (isParentNode(node)) {
        const first = node.childNodes[0]
        const last = node.childNodes.slice(-1)?.[0]
        leading += isConverterNode(first) && first._whitespace?.leading || ''
        trailing += isConverterNode(last) && last._whitespace?.trailing || ''
    }

    return { leading, trailing }
}

/*
 * Finds a Markdown converter, gets the replacement, and sets it on
 * `_replacement`
*/
function process(node: treeAdapter.Node, links: Link[]) {
    assertIsConverterNode(node)
    let whitespace: { leading: string, trailing: string }
    const content = getContent(node).trim()
    const converter = node._converter

    if (converter.surroundingBlankLines) {
        whitespace = { leading: '\n\n', trailing: '\n\n' }
    } else {
        whitespace = flankingWhitespace(node)
        if (converter.trailingWhitespace != null) {
            whitespace.trailing += converter.trailingWhitespace
        }
    }

    if (isElement(node) && node.tagName === 'li') {
        // li isn't allowed to have leading whitespace
        whitespace.leading = ''
    }

    node._replacement = converter.replacement(content, node, links)
    node._whitespace = whitespace
}

/**
 * Remove whitespace text nodes from children
 */
function removeEmptyNodes(node: treeAdapter.Node) {
    if (isParentNode(node))
        node.childNodes
            .filter(child => {
                if (isTextNode(child) && getTextNodeContent(child).trim() === '') {
                    const { previousSibling } = child
                    const { nextSibling } = child
                    if (!previousSibling || !nextSibling || isBlock(previousSibling) || isBlock(nextSibling)) {
                        return true
                    }
                }
            })
            .forEach(child => detachNode(child))
}

export interface Options {
    ensureFirstHeaderIsH1?: boolean
    alignHeaders?: boolean
}

export default function (dirtyMarkdown: string, options: Options = {}) {
    let content
    if (typeof dirtyMarkdown !== 'string') {
        throw new TypeError('Markdown input is not a string')
    }

    const {
        ensureFirstHeaderIsH1 = true,
        alignHeaders = true
    } = options

    let out = ''

    // handle yaml front-matter
    try {
        content = fm(dirtyMarkdown)
        if (Object.keys(content.attributes).length !== 0) {
            out += `---\n${yaml.safeDump(content.attributes).trim()}\n---\n\n`
        }
        content = content.body
    } catch (error) {
        // parsing failed, just ignore front-matter
        content = dirtyMarkdown
    }

    const ast = marked.lexer(content)

    const rawLinks = ast.links // see issue: https://github.com/chjj/marked/issues/472
    let links = Object.keys(rawLinks).map(link => ({
        name: link.toLowerCase(),
        url: rawLinks[link].href,
        title: rawLinks[link].title || null
    } as Link))

    links = _.sortBy(links, ['name', 'url'])

    let html = marked.parser(ast)

    // Escape potential ol triggers
    html = html.replace(/(\d+)\. /g, '$1\\. ')
    const root = parseFragment(html, { treeAdapter }) as treeAdapter.DocumentFragment

    // remove empty nodes that are direct children of the root first
    removeEmptyNodes(root)
    bfsOrder(root).forEach(removeEmptyNodes)

    if (alignHeaders) {
        fixHeaders(root, ensureFirstHeaderIsH1)
    }

    bfsOrder(root)
        .map(node => {
            const converter = findConverter(node)
            if (converter) {
                const converterNode: typeof node & ConverterNode = node as any
                converterNode._converter = converter
                return converterNode
            }
            return node
        })
        .reverse() // Process nodes in reverse (so deepest child elements are first).
        .forEach(node => process(node, links))

    out += getContent(root).trimRight() + '\n'

    if (links.length > 0) {
        out += '\n'
    }
    for (const { name, url, title } of Array.from(links)) {
        const optionalTitle = title ? ` \"${title}\"` : ''
        out += `[${name}]: ${url}${optionalTitle}\n`
    }

    return out
}

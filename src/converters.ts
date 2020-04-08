import indent from 'indent'
import { serialize } from 'parse5'
import languageCodeRewrite from './language-code-rewrites.json'
import { isConverterNode } from './node'
import { extractRows, formatHeaderSeparator, formatRow, getColumnWidths } from './tables'
import treeAdapter from './tree-adapter'
import { assertIsElement, delimitCode, getAttribute, isElement, isParentNode, noExtraAttributes } from './utils'

const CODE_HIGHLIGHT_REGEX = /(?:highlight highlight|lang(?:uage)?)-(\S+)/
const { insertTextBefore, insertText, isTextNode } = treeAdapter

function indentChildren(node: treeAdapter.Node) {
    let allChildrenAreElements = true
    if (isParentNode(node))
        for (const child of Array.from(node.childNodes)) {
            if (isTextNode(child)) {
                allChildrenAreElements = false
            }
        }

    if (allChildrenAreElements) {
        if (isParentNode(node))
            Array.from(node.childNodes)
                .forEach(child => insertTextBefore(node, '\n  ', child))
        return insertText(node, '\n')
    }
}

// TODO: handle indenting nested children

// regex taken from https://github.com/chjj/marked/blob/8f9d0b/lib/marked.js#L452
function isValidLink(link) {
    return /.+(?:@|:\/).+/.test(link)
}

const fallback = () => true

export type ConverterFilter = ((node: treeAdapter.Node) => boolean) | string | string[]

export interface Link {
    url: string,
    title: string | null,
    name: string
}

export interface Converter {
    surroundingBlankLines?: boolean
    trailingWhitespace?: string

    filter: ConverterFilter
    replacement(content: string, node: treeAdapter.Node, links: Link[]): string
}

/**
 * This array holds a set of "converters" that process DOM nodes and output
 * Markdown. The `filter` property determines what nodes the converter is run
 * on. The `replacement` function takes the content of the node and the node
 * itself and returns a string of Markdown. The `surroundingBlankLines` option
 * determines whether or not the block should have a blank line before and after
 * it. Converters are matched to nodes starting from the top of the converters
 * list and testing each one downwards.
 * @type {Array}
 */
export const Converters = new Array<Converter>(
    {
        filter(node) {
            return isConverterNode(node.parentNode) && node.parentNode._converter.filter === fallback
        },
        surroundingBlankLines: false,
        replacement(_content, node) {
            indentChildren(node)
            return ''
        }
    },
    {
        filter: 'p',
        surroundingBlankLines: true,
        replacement(content) {
            return content
        }
    },
    {
        filter: ['td', 'th'],
        surroundingBlankLines: false,
        replacement(content) {
            return content
        }
    },
    {
        filter: ['tbody', 'thead', 'tr'],
        surroundingBlankLines: false,
        replacement() {
            return ''
        }
    },
    {
        filter: ['del', 's', 'strike'],
        surroundingBlankLines: false,
        replacement(content) {
            return `~~${content}~~`
        }
    },
    {
        filter: ['em', 'i'],
        surroundingBlankLines: false,
        replacement(content) {
            if (content.indexOf('_') >= 0) {
                return `*${content.replace(/\*/g, '\\*')}*`
            } else {
                return `_${content.replace(/_/g, '\\_')}_`
            }
        }
    },
    {
        filter: ['strong', 'b'],
        surroundingBlankLines: false,
        replacement(content) {
            return `**${content.replace(/\*/g, '\\*')}**`
        }
    },
    {
        filter: 'br',
        surroundingBlankLines: false,
        trailingWhitespace: '\n',
        replacement() {
            return '<br>'
        }
    },
    {
        filter: 'a',
        surroundingBlankLines: false,
        replacement(content, node, links) {
            const refUrl = getAttribute(node, 'href') || ''
            const refTitle = getAttribute(node, 'title')
            const referenceLink = links.find(({ url, title }) => url == refUrl && title == refTitle)
            if (referenceLink) {
                if (content.toLowerCase() === referenceLink.name) {
                    return `[${content}]`
                } else {
                    return `[${content}][${referenceLink.name}]`
                }
            } else if (refTitle) {
                return `[${content}](${refUrl} \"${refTitle}\")`
            } else if (isValidLink(refUrl) && (content === refUrl || content === refUrl.replace(/^mailto:/, ''))) {
                return `<${content}>`
            } else {
                return `[${content}](${refUrl})`
            }
        }
    },
    {
        filter(node) {
            // Ignore img nodes that have custom styling or other attributes
            return isElement(node) && node.tagName === 'img' && noExtraAttributes(node, 'alt', 'src', 'title')
        },
        surroundingBlankLines: false,
        replacement(_content, node, links) {
            const alt = getAttribute(node, 'alt') || ''
            const refUrl = getAttribute(node, 'src') || ''
            const refTitle = getAttribute(node, 'title')
            const referenceLink = links.find(({ url, title }) => url == refUrl && title == refTitle)
            if (referenceLink) {
                if (alt.toLowerCase() === referenceLink.name) {
                    return `![${alt}]`
                } else {
                    return `![${alt}][${referenceLink.name}]`
                }
            } else if (refTitle) {
                return `![${alt}](${refUrl} \"${refTitle}\")`
            } else {
                return `![${alt}](${refUrl})`
            }
        }
    },
    {
        filter(node) {
            return node.type === 'checkbox' && isElement(node.parentNode) && node.parentNode.tagName === 'li'
        },
        surroundingBlankLines: false,
        replacement(_content, node) {
            return (node['checked'] ? '[x]' : '[ ]') + ' '
        }
    },
    {
        filter: 'table',
        surroundingBlankLines: true,
        replacement(_content, node) {
            const { alignments, rows } = extractRows(node)
            const columnWidths = getColumnWidths(rows)
            // const totalCols = rows[0].length

            const out = [
                formatRow(rows[0], alignments, columnWidths),
                formatHeaderSeparator(alignments, columnWidths),
                ...rows.slice(1).map(row => formatRow(row, alignments, columnWidths))
            ]

            return out.join('\n')
        }
    },
    {
        filter: 'pre',
        surroundingBlankLines: true,
        replacement(content, node) {
            let language: string | undefined
            if (isParentNode(node)) {
                const first = node.childNodes[0]
                if (isElement(first) && first.tagName === 'code') {
                    language = getAttribute(node.childNodes[0], 'class')?.match(CODE_HIGHLIGHT_REGEX)?.[1]
                }
            }
            if (language == null && isElement(node.parentNode) && node.parentNode.tagName === 'div') {
                language = getAttribute(node.parentNode, 'class')?.match(CODE_HIGHLIGHT_REGEX)?.[1]
            }
            if (language != null) {
                language = language.toLowerCase()
                if (languageCodeRewrite[language] != null) {
                    language = languageCodeRewrite[language]
                }
            }
            return delimitCode(`${language || ''}\n${content}\n`, '```')
        }
    },
    {
        filter: 'code',
        surroundingBlankLines: false,
        replacement(content, node) {
            if ((isElement(node.parentNode) && node.parentNode.tagName) !== 'pre') {
                return delimitCode(content, '`') // inline code
            } else {
                // code that we'll handle once it reaches the pre tag. we only bother
                // passing it through this converter to avoid it being serialized before
                // it gets to the pre tag
                return content
            }
        }
    },
    {
        filter(node) {
            return isElement(node) && node.tagName === 'div' && CODE_HIGHLIGHT_REGEX.test(node['className'])
        },
        surroundingBlankLines: true,
        replacement(content) {
            return content
        }
    },
    {
        filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
        surroundingBlankLines: true,
        replacement(content, node) {
            assertIsElement(node)
            const hLevel = parseInt(node.tagName.charAt(1), 10)
            return `${'#'.repeat(hLevel)} ${content}`
        }
    },
    {
        filter: 'hr',
        surroundingBlankLines: true,
        replacement() {
            return '-'.repeat(80)
        }
    },
    {
        filter: 'blockquote',
        surroundingBlankLines: true,
        replacement(content) {
            return indent(content, '> ')
        }
    },
    {
        filter: 'li',
        surroundingBlankLines: false,
        trailingWhitespace: '\n',
        replacement(content, node) {
            if (Array.from(content).includes('\n')) {
                // the indent here is for all the lines after the first, so we only need
                // do it if there's a linebreak in the content
                content = indent(content, '  ').trimLeft()
            }
            const parent = node.parentNode
            const prefix = isElement(parent) && parent.tagName === 'ol' ? parent.childNodes.indexOf(node) + 1 + '. ' : '- '
            return prefix + content
        }
    },
    {
        filter: ['ul', 'ol'],
        surroundingBlankLines: true,
        replacement(content) {
            return content
        }
    },
    {
        filter: '_comment',
        replacement(content) {
            return `<!-- ${content} -->`
        }
    },
    {
        filter: fallback,
        surroundingBlankLines: true,
        replacement(_content, node) {
            indentChildren(node)
            return serialize({ children: [node], nodeName: '#document-fragment', quirksMode: false },
                { treeAdapter })
        }
    }
)

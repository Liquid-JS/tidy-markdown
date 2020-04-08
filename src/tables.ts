import wcwidth from 'wcwidth'
import { isConverterNode } from './node'
import treeAdapter from './tree-adapter'
import { getAttribute, isElement, isParentNode } from './utils'

export type Alignment = 'left' | 'center' | 'right'

function pad(length: number, text: string, char?: string): string
function pad(text: string, length: number, char?: string): string
function pad(text: string | number, length: string | number, char: string = ' ') {
    if (char == null) {
        char = ' '
    }
    const invert = typeof text === 'number'
    if (invert) {
        [length, text] = Array.from([text, length])
    }
    text = text.toString()
    let res = ''
    const padlength = (length as number) - wcwidth(text)
    res += char.repeat(padlength)
    if (invert) {
        return res + text
    } else {
        return text + res
    }
}

/**
 * Determines the alignment for a table cell by reading the style attribute
 * @return {String|null} One of 'right', 'left', 'center', or null
 */
function getCellAlignment(node: treeAdapter.ParentNode) {
    return getAttribute(node, 'style')?.match(/text-align:\s*(right|left|center)/)?.[1] as Alignment || null
}

/**
 * Join an array of cells (columns) from a single row.
 * @param {String[]} columns
 * @return {String} The joined row.
 */
function joinColumns(columns: string[]) {
    if (columns.length > 1) {
        return columns.join(' | ')
    } else {
        // use a leading pipe for single column tables, otherwise the output won't
        // render as a table
        return `| ${columns[0]}`
    }
}

function extractColumns(row: treeAdapter.Node) {
    const columns = new Array<string>()
    const alignments = new Array<Alignment>()
    if (isParentNode(row))
        row.childNodes
            .forEach(column => {
                // we don't care if it's a `th` or `td` because we cannot represent the
                // difference in markdown anyway - the first row always represents the
                // headers
                if (isElement(column) && ['th', 'td'].includes(column.tagName) && isConverterNode(column)) {
                    columns.push(column._replacement)
                    alignments.push(getCellAlignment(column))
                } else if (treeAdapter.isTextNode(column)) {
                    throw new Error(`Cannot handle ${isElement(column) && column.tagName} in table row`)
                }
            })

    return { columns, alignments }
}

export function extractRows(node: treeAdapter.Node) {
    const alignments = new Array<Alignment>()
    const rows = new Array<string[]>()
    const inqueue = [node]
    while (inqueue.length > 0) {
        const elem = inqueue.shift()
        if (isParentNode(elem))
            elem.childNodes.forEach(child => {
                if (isElement(child) && child.tagName === 'tr') {
                    const row = extractColumns(child)
                    rows.push(row.columns)

                    // alignments in markdown are column-wide, so after the first row we just
                    // want to make sure there aren't any conflicting values within a single
                    // column
                    for (let i = 0; i < row.alignments.length; i++) {
                        const alignment = row.alignments[i]
                        if (i + 1 > alignments.length) {
                            // if all previous rows were shorter, or if we are at the beginning
                            // of the table, then we need to populate the alignments array
                            alignments.push(alignment)
                        }
                        if (alignment !== alignments[i]) {
                            throw new Error(`Alignment in a table column ${i} is not consistent`)
                        }
                    }
                } else if (treeAdapter.isElementNode(child)) {
                    inqueue.push(child)
                }
            })
    }

    // when there are more alignments than headers (from columns that extend beyond
    // the headers), and those alignments aren't doing anything, it looks better to
    // remove them
    while (alignments.length > rows[0].length && alignments.slice(-1)[0] === null) {
        alignments.pop()
    }

    return { alignments, rows }
}

export function formatRow(row: string[], alignments: Alignment[], columnWidths: number[]) {
    // apply padding around each cell for alignment and column width
    row = row.map((column, i) => {
        switch (alignments[i]) {
            case 'right':
                return pad(columnWidths[i], column)
            case 'center':
                // rounding causes a bias to the left because we can't have half a char
                const whitespace = columnWidths[i] - column.length
                const leftPadded = pad(Math.floor(whitespace / 2) + column.length, column)
                return pad(leftPadded, Math.ceil(whitespace / 2) + leftPadded.length)
            default:
                // left is the default alignment when formatting
                return pad(column, columnWidths[i])

        }
    })

    // trimRight is to remove any trailing whitespace added by the padding
    return joinColumns(row).trimRight()
}

export function formatHeaderSeparator(alignments: Alignment[], columnWidths: number[]) {
    const columns = alignments.map((alignment, i) => {
        switch (alignment) {
            case 'center':
                return `:${pad('', columnWidths[i] - 2, '-')}:`
            case 'left':
                return `:${pad('', columnWidths[i] - 1, '-')}`
            case 'right':
                return pad('', columnWidths[i] - 1, '-') + ':'
            default:
                return pad('', columnWidths[i], '-')
        }
    })
    return joinColumns(columns)
}

export function getColumnWidths(rows: string[][]) {
    const columnWidths = rows[0].map((row) => (row || '').length)
    rows.forEach((row) => {
        row.forEach((column, i) => {
            if (i < columnWidths.length)
                columnWidths[i] = Math.max(wcwidth(column), columnWidths[i])
        })
    })
    return columnWidths
}

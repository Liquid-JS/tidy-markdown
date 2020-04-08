import { Converter } from './converters'
import treeAdapter from './tree-adapter'

export interface ConverterNode {
    _converter: Converter
    _replacement: string
    _whitespace: { leading: string, trailing: string } | undefined
}

export function isConverterNode<T extends treeAdapter.Node>(val?: treeAdapter.Node | null): val is (T & ConverterNode) {
    return !!(val && Object.hasOwnProperty.call(val, '_converter'))
}

export function assertIsConverterNode<T extends treeAdapter.Node>(val?: treeAdapter.Node | null): asserts val is (T & ConverterNode) {
    if (!isConverterNode(val))
        throw new Error('Expected ConverterNode')
}

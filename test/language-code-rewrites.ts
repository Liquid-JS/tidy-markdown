import 'should'
import rewrites from '../src/language-code-rewrites.json'

describe('language-code-rewrites', () => {
    it('shouldn\'t map output keys to any input keys', () => {
        const inputKeys = Object.keys(rewrites)
        return (() => {
            const result = Object.keys(rewrites).map(inputKey => {
                const outputKey = rewrites[inputKey]
                return inputKeys.should.not.containEql(outputKey)
            })
            return result
        })()
    })
})

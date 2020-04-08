import 'should'
import { Converters } from '../src/converters'

describe('converters', () => {
    it('should define a replacement function', () => Converters.map(converter => converter.replacement.should.type('function')))
})

import { ArgumentParser } from 'argparse'
import tidyMarkdown from './'

// tslint:disable-next-line: no-var-requires
const packageInfo = require('../package.json')

const argparser = new ArgumentParser({
    addHelp: true,
    description: packageInfo.description + ` Unformatted Markdown is read from \
STDIN, formatted, and written to STDOUT.`,
    version: packageInfo.version
})

argparser.addArgument(['--no-ensure-first-header-is-h1'], {
    action: 'storeFalse',
    help: `Disable fixing the first header when it isn\'t an H1. This is useful if \
the markdown you\'re processing isn\'t a full document, but rather a piece of \
a larger document.`,
    defaultValue: true,
    dest: 'ensureFirstHeaderIsH1'
})

const argv = argparser.parseArgs()

process.stdin.setEncoding('utf8')
process.stdin.on('readable', () => {
    let chunk: string
    let buffer = ''
    // tslint:disable-next-line: no-conditional-assignment
    while ((chunk = process.stdin.read()) !== null) {
        buffer += chunk
    }
    if (buffer !== '') {
        process.stdout.write(tidyMarkdown(buffer, argv))
    }
})

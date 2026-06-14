const { execFileSync } = require('node:child_process')

const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)

const testFilePattern = /(^|\/)(test|tests|__tests__)\/|(\.test|\.spec)\.[^/]+$/
const committedTestFiles = trackedFiles.filter((file) =>
  testFilePattern.test(file.replace(/\\/g, '/'))
)

if (committedTestFiles.length > 0) {
  console.error('Test files must remain local-only. Remove these files from Git tracking:')
  for (const file of committedTestFiles) {
    console.error(`- ${file}`)
  }
  process.exit(1)
}

console.log('No committed test files found.')

const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const packageJsonPath = join(__dirname, '..', 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const expectedTag = `v${packageJson.version}`
const actualTag = process.env.GITHUB_REF_NAME ?? ''

if (actualTag !== expectedTag) {
  console.error(`Release tag mismatch: expected ${expectedTag}, got ${actualTag || '<missing>'}.`)
  process.exit(1)
}

console.log(`Release tag ${actualTag} matches package version ${packageJson.version}.`)

const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const packageJsonPath = join(__dirname, '..', 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

const expectedTemplate = '${productName}.Setup-${version}.${ext}'
const artifactName = packageJson.build?.nsis?.artifactName

if (artifactName !== expectedTemplate) {
  console.error(`Windows NSIS artifactName must be ${expectedTemplate}, got ${artifactName || '<missing>'}.`)
  process.exit(1)
}

const expectedName = `${packageJson.build.productName}.Setup-${packageJson.version}.exe`
const expandedName = artifactName
  .replace('${productName}', packageJson.build.productName)
  .replace('${version}', packageJson.version)
  .replace('${ext}', 'exe')

if (expandedName !== expectedName) {
  console.error(`Windows update artifact name must be ${expectedName}, got ${expandedName}.`)
  process.exit(1)
}

console.log(`Windows update artifact name verified: ${expandedName}`)

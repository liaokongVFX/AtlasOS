const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const rootDir = join(__dirname, '..')
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function readPngDimensions(relativePath) {
  const filePath = join(rootDir, relativePath)
  const data = readFileSync(filePath)

  if (data.length < 24 || !data.subarray(0, 8).equals(pngSignature) || data.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`${relativePath} is not a valid PNG file.`)
  }

  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20)
  }
}

function readIcoSizes(relativePath) {
  const filePath = join(rootDir, relativePath)
  const data = readFileSync(filePath)

  if (data.length < 6 || data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) {
    throw new Error(`${relativePath} is not a valid ICO file.`)
  }

  const count = data.readUInt16LE(4)
  const sizes = []
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16
    if (data.length < offset + 16) throw new Error(`${relativePath} has a truncated ICO directory.`)
    sizes.push({
      width: data[offset] || 256,
      height: data[offset + 1] || 256
    })
  }

  return sizes
}

const failures = []

function expectPng(relativePath, expected) {
  try {
    const { width, height } = readPngDimensions(relativePath)

    if (expected.width !== undefined && width !== expected.width) {
      failures.push(`${relativePath} must be ${expected.width}px wide, got ${width}px.`)
    }
    if (expected.height !== undefined && height !== expected.height) {
      failures.push(`${relativePath} must be ${expected.height}px tall, got ${height}px.`)
    }
    if (expected.minWidth !== undefined && width < expected.minWidth) {
      failures.push(`${relativePath} must be at least ${expected.minWidth}px wide, got ${width}px.`)
    }
    if (expected.minHeight !== undefined && height < expected.minHeight) {
      failures.push(`${relativePath} must be at least ${expected.minHeight}px tall, got ${height}px.`)
    }
    if (expected.square && width !== height) {
      failures.push(`${relativePath} must be square, got ${width}x${height}px.`)
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }
}

function expectIco(relativePath, expectedSizes) {
  try {
    const sizes = readIcoSizes(relativePath)
    for (const expectedSize of expectedSizes) {
      if (!sizes.some((size) => size.width === expectedSize && size.height === expectedSize)) {
        failures.push(`${relativePath} must include a ${expectedSize}x${expectedSize}px image.`)
      }
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }
}

expectPng('build/icon.png', { minWidth: 512, minHeight: 512, square: true })
expectPng('build/icon-16.png', { width: 16, height: 16 })
expectPng('build/icon-32.png', { width: 32, height: 32 })
expectIco('build/icon.ico', [16, 32, 256])

if (failures.length > 0) {
  console.error(['Build asset verification failed:', ...failures.map((failure) => `- ${failure}`)].join('\n'))
  process.exit(1)
}

console.log('Build assets verified.')

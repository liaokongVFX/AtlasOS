const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const sharp = require('sharp')

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
  return readIcoImages(relativePath).map(({ width, height }) => ({ width, height }))
}

function readIcoImages(relativePath) {
  const filePath = join(rootDir, relativePath)
  const data = readFileSync(filePath)

  if (data.length < 6 || data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) {
    throw new Error(`${relativePath} is not a valid ICO file.`)
  }

  const count = data.readUInt16LE(4)
  const images = []
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16
    if (data.length < offset + 16) throw new Error(`${relativePath} has a truncated ICO directory.`)
    const bytes = data.readUInt32LE(offset + 8)
    const imageOffset = data.readUInt32LE(offset + 12)
    if (data.length < imageOffset + bytes) throw new Error(`${relativePath} has a truncated ICO image.`)
    images.push({
      width: data[offset] || 256,
      height: data[offset + 1] || 256,
      data: data.subarray(imageOffset, imageOffset + bytes)
    })
  }

  return images
}

const failures = []

async function expectPng(relativePath, expected) {
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
    if (expected.roundedCorners) {
      await expectImageRoundedCorners(relativePath, readFileSync(join(rootDir, relativePath)))
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }
}

async function expectImageRoundedCorners(label, input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3]
  const transparentCorners = [
    ['top-left', alphaAt(0, 0)],
    ['top-right', alphaAt(info.width - 1, 0)],
    ['bottom-left', alphaAt(0, info.height - 1)],
    ['bottom-right', alphaAt(info.width - 1, info.height - 1)]
  ]
  const opaqueEdges = [
    ['top', alphaAt(Math.floor(info.width / 2), 0)],
    ['right', alphaAt(info.width - 1, Math.floor(info.height / 2))],
    ['bottom', alphaAt(Math.floor(info.width / 2), info.height - 1)],
    ['left', alphaAt(0, Math.floor(info.height / 2))]
  ]

  for (const [corner, alpha] of transparentCorners) {
    if (alpha > 1) failures.push(`${label} must have transparent rounded corners; ${corner} alpha was ${alpha}.`)
  }
  for (const [edge, alpha] of opaqueEdges) {
    if (alpha < 250) failures.push(`${label} must keep ${edge} edge center opaque; alpha was ${alpha}.`)
  }
}

async function expectIco(relativePath, expectedSizes, expected = {}) {
  try {
    const images = readIcoImages(relativePath)
    const sizes = images.map(({ width, height }) => ({ width, height }))
    for (const expectedSize of expectedSizes) {
      if (!sizes.some((size) => size.width === expectedSize && size.height === expectedSize)) {
        failures.push(`${relativePath} must include a ${expectedSize}x${expectedSize}px image.`)
      }
    }
    if (expected.roundedCorners) {
      for (const image of images) {
        await expectImageRoundedCorners(`${relativePath} ${image.width}x${image.height}`, image.data)
      }
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }
}

async function main() {
  await expectPng('build/icon.png', { minWidth: 512, minHeight: 512, square: true, roundedCorners: true })
  await expectPng('build/icon-16.png', { width: 16, height: 16, roundedCorners: true })
  await expectPng('build/icon-32.png', { width: 32, height: 32, roundedCorners: true })
  await expectPng('docs/assets/readme/atlasos-logo.png', { width: 256, height: 256, roundedCorners: true })
  await expectIco('build/icon.ico', [16, 32, 256], { roundedCorners: true })

  if (failures.length > 0) {
    console.error(['Build asset verification failed:', ...failures.map((failure) => `- ${failure}`)].join('\n'))
    process.exit(1)
  }

  console.log('Build assets verified.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

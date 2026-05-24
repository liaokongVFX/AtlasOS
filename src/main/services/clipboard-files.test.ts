import { describe, expect, it } from 'vitest'
import {
  parseFileUriListPaths,
  parseNullSeparatedUtf16Paths,
  parseWindowsHdropPaths,
  readClipboardFilePathsFromNativeFormats
} from './clipboard-files'

function createWindowsHdropBuffer(paths: string[]): Buffer {
  const header = Buffer.alloc(20)
  header.writeUInt32LE(20, 0)
  header.writeUInt32LE(1, 16)

  const fileList = Buffer.from(`${paths.join('\0')}\0\0`, 'utf16le')
  return Buffer.concat([header, fileList])
}

describe('clipboard file path parsing', () => {
  it('parses multiple paths from Windows CF_HDROP data', () => {
    const paths = ['C:\\Users\\xhwz2\\Desktop\\one.txt', 'D:\\Projects\\AtlasOS\\README.md']

    expect(parseWindowsHdropPaths(createWindowsHdropBuffer(paths))).toEqual(paths)
  })

  it('parses FileNameW style UTF-16 paths', () => {
    const buffer = Buffer.from('C:\\Users\\xhwz2\\Desktop\\one.txt\0\0', 'utf16le')

    expect(parseNullSeparatedUtf16Paths(buffer)).toEqual(['C:\\Users\\xhwz2\\Desktop\\one.txt'])
  })

  it('parses file URI lists and ignores comments', () => {
    const buffer = Buffer.from('# copied files\r\nfile:///C:/Users/xhwz2/Desktop/one.txt\r\nfile:///D:/Projects/AtlasOS/README.md')

    expect(parseFileUriListPaths(buffer)).toEqual([
      'C:\\Users\\xhwz2\\Desktop\\one.txt',
      'D:\\Projects\\AtlasOS\\README.md'
    ])
  })

  it('parses UTF-16 file URI lists from clipboard buffers', () => {
    const buffer = Buffer.from('file:///C:/Users/xhwz2/Desktop/one.txt\r\n', 'utf16le')

    expect(parseFileUriListPaths(buffer)).toEqual(['C:\\Users\\xhwz2\\Desktop\\one.txt'])
  })

  it('accepts absolute file paths in URI list payloads from native clipboards', () => {
    expect(parseFileUriListPaths('C:\\Users\\xhwz2\\Desktop\\one.txt\r\nhttps://example.com/file.txt')).toEqual([
      'C:\\Users\\xhwz2\\Desktop\\one.txt'
    ])
  })

  it('reads the first supported native clipboard format without duplicates', () => {
    const hdrop = createWindowsHdropBuffer(['C:\\Users\\xhwz2\\Desktop\\one.txt'])
    const filename = Buffer.from('C:\\Users\\xhwz2\\Desktop\\one.txt\0\0', 'utf16le')
    const buffers = new Map([
      ['CF_HDROP', hdrop],
      ['FileNameW', filename]
    ])

    expect(
      readClipboardFilePathsFromNativeFormats(['CF_HDROP', 'FileNameW'], (format) => buffers.get(format) ?? Buffer.alloc(0))
    ).toEqual(['C:\\Users\\xhwz2\\Desktop\\one.txt'])
  })

  it('uses the text reader for text/uri-list when Electron exposes no buffer bytes', () => {
    expect(
      readClipboardFilePathsFromNativeFormats(
        ['text/uri-list'],
        () => Buffer.alloc(0),
        () => 'file:///C:/Users/xhwz2/Desktop/one.txt\r\n'
      )
    ).toEqual(['C:\\Users\\xhwz2\\Desktop\\one.txt'])
  })
})

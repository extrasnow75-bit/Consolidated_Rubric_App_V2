import { describe, it, expect, vi } from 'vitest'

// googleDrive.ts imports googleAuth.ts, which imports electron at module load. Only the pure
// helper is under test here, so stub the module rather than standing up an Electron environment.
vi.mock('./googleAuth', () => ({ getAccessToken: async () => 'stub-token' }))

const { extractFileIdFromUrl } = await import('./googleDrive')

describe('extractFileIdFromUrl', () => {
  const ID = '1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUvWxYz'

  it('reads a Google Docs URL', () => {
    expect(extractFileIdFromUrl(`https://docs.google.com/document/d/${ID}/edit`)).toBe(ID)
  })

  it('reads a Google Sheets URL', () => {
    expect(extractFileIdFromUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toBe(ID)
  })

  it('reads a Drive file URL', () => {
    expect(extractFileIdFromUrl(`https://drive.google.com/file/d/${ID}/view?usp=sharing`)).toBe(ID)
  })

  it('reads the older open?id= form', () => {
    expect(extractFileIdFromUrl(`https://drive.google.com/open?id=${ID}`)).toBe(ID)
  })

  it('reads an id in a later query parameter', () => {
    expect(extractFileIdFromUrl(`https://drive.google.com/open?usp=x&id=${ID}`)).toBe(ID)
  })

  it('accepts a bare file id', () => {
    expect(extractFileIdFromUrl(ID)).toBe(ID)
  })

  it('accepts a bare file id with surrounding whitespace', () => {
    expect(extractFileIdFromUrl(`  ${ID}  `)).toBe(ID)
  })

  it('rejects a short bare word rather than treating it as an id', () => {
    // Without the length floor, typing "rubric" into the link box would be accepted as a file id
    // and fail later as a confusing 404 instead of a clear "that is not a link" message.
    expect(() => extractFileIdFromUrl('rubric')).toThrow(/Google Docs or Sheets link/)
  })

  it('rejects an unrelated URL', () => {
    expect(() => extractFileIdFromUrl('https://example.com/some/page')).toThrow()
  })

  it('rejects empty input', () => {
    expect(() => extractFileIdFromUrl('')).toThrow()
  })
})

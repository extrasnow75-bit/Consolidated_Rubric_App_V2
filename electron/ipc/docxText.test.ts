import { describe, it, expect } from 'vitest'
import { extractDocxText } from './docxText'

/**
 * One test file for one line, because that line was wrong in every build shipped so far.
 *
 * mammoth takes `{ arrayBuffer }` in the browser and `{ path }` or `{ buffer }` in Node, and its
 * type definitions accept all three whichever build is loaded. So when the web app's
 * browser-shaped call moved into the main process untouched, nothing complained: it typechecked,
 * it built, it packaged, and it failed only at run time with "Could not find file in options" —
 * a message naming neither mammoth nor the option it actually wanted.
 *
 * Every .docx route through Gemini went through this function, so the whole of Part 2's
 * "convert a Word document" was dead. Nothing else in the suite touches mammoth, so nothing else
 * would notice it reverting.
 */

// A real .docx: a three-entry zip holding [Content_Types].xml, _rels/.rels and word/document.xml,
// with two short paragraphs in the body. Genuinely parseable rather than a stub — a stub mammoth
// rejected would pass the last test here for the wrong reason.
const DOCX_BASE64 =
  'UEsDBBQAAAAIACcdMV1FCOEt7QAAAK4BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE7zyF5SuKHTgghJL0wM8R' +
  'OJQHWNmbxMJ/8rqlfXs2bekBVT3as9/MaLrVLnixxUIuxV7eqVYKjCZZF6defq3fmkcpqEK04FPEXu6R5Gq46db7jCQYjtTL' +
  'udb8pDWZGQOQShkjK2MqASo/y6QzmG+YUN+37YM2KVaMtamLhxy6Fxxh46t43fH3sQjjUjwf75aoXkLO3hmoLOtF1Re5gp6u' +
  'gNto/7VrTs0Uk4cbml2m21PCBy9TnEXxCaW+Q2A7/ZOK1TaZTeAIdb3ohbw0js7gmV/cckkGiXjy4NVZCeDiXw99mHv4BVBL' +
  'AwQUAAAACAAnHTFduYFEcbAAAAAqAQAACwAAAF9yZWxzLy5yZWxzjc87DsIwDAbgnVNE3mlaBoRQky4IqSsqB4gSN41oHkrC' +
  'o7cnAwMgBkbbvz/LbfewM7lhTMY7Bk1VA0EnvTJOMzgPx/UOSMrCKTF7hwwWTNDxVXvCWeSykyYTEimISwymnMOe0iQntCJV' +
  'PqArk9FHK3Ipo6ZByIvQSDd1vaXx3QD+YZJeMYi9aoAMS8B/bD+ORuLBy6tFl3+c+EoUWUSNmcHdR0XVq10VFihv6ceL/AlQ' +
  'SwMEFAAAAAgAJx0xXcdBPba0AAAACwEAABEAAAB3b3JkL2RvY3VtZW50LnhtbG2PTQoCMQyF956idK8dXYgM87PSC6gHqNPo' +
  'DEyT0kTHub2tIIK4+UJeeO+Rqn36UT0g8kBY6/Wq0AqwIzfgrdbn02G504rForMjIdR6BtZts6im0lF394CiUgJyOdW6Fwml' +
  'Mdz14C2vKACm25Wit5LWeDMTRRcidcCcCvxoNkWxNd4OqJsUeSE35xkyYoY0px54YHUUK5DrKpPVzPhm+DXsn+DDaOOs1oUK' +
  'wn8M5lNlvm80L1BLAQIUAxQAAAAIACcdMV1FCOEt7QAAAK4BAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10u' +
  'eG1sUEsBAhQDFAAAAAgAJx0xXbmBRHGwAAAAKgEAAAsAAAAAAAAAAAAAAIABHgEAAF9yZWxzLy5yZWxzUEsBAhQDFAAAAAgA' +
  'Jx0xXcdBPba0AAAACwEAABEAAAAAAAAAAAAAAIAB9wEAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAADAAMAuQAAANoCAAAA' +
  'AA=='

const docx = (data: string) => ({
  name: 'eCampus Demo Rubrics.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  data,
})

describe('extractDocxText', () => {
  it('reads the text out of a real .docx', async () => {
    const text = await extractDocxText(docx(DOCX_BASE64))
    expect(text).toContain('Thesis Statement')
    expect(text).toContain('Exemplary 10 pts')
  })

  it('does not throw the error the browser-shaped call threw', async () => {
    // Asserting on the string keeps the regression legible: this is what the user saw, relayed
    // through IPC as "Error invoking remote method 'gemini:generateAllCsvsFromDoc'".
    await expect(extractDocxText(docx(DOCX_BASE64))).resolves.toBeTruthy()
    await expect(extractDocxText(docx(DOCX_BASE64))).resolves.not.toMatch(
      /Could not find file in options/,
    )
  })

  it('says the document is unreadable rather than passing empty text on', async () => {
    // An empty or protected file must not reach Gemini as a blank prompt, which would come back
    // as a confident answer about nothing.
    const empty = Buffer.from('not a zip at all').toString('base64')
    await expect(extractDocxText(docx(empty))).rejects.toThrow()
  })
})

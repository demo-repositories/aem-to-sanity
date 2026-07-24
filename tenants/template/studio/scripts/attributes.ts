/**
 * Self-contained attribute diagnostic report for Sanity support.
 *
 * Produces a summary of all indexed attribute paths in the dataset,
 * grouped by document type. Excludes internal document types
 * (sanity.*, system.*) that do not count toward the attribute limit.
 *
 * This is a standalone version with no local imports — safe to share
 * with customers or run in any Sanity project.
 *
 * Usage:
 *   sanity exec scripts/attributes.ts --with-user-token
 *   sanity exec scripts/attributes.ts --with-user-token -- --project=abc123 --dataset=production
 *   sanity exec scripts/attributes.ts --with-user-token -- --file=export.ndjson
 */

import {createReadStream} from 'node:fs'
import {createInterface} from 'node:readline'
import {parseArgs} from 'node:util'

import {DEFAULT_STUDIO_CLIENT_OPTIONS, type SanityDocument} from 'sanity'
import {getCliClient} from 'sanity/cli'

// ---------------------------------------------------------------------------
// Attribute collector
// ---------------------------------------------------------------------------

interface Attribute {
  key: string
  type: string
}

interface DatasetStats {
  fields: {
    count: {
      value: number
      limit: number
    }
  }
}

const INTERNAL_TYPE_FILTER =
  '!(string::startsWith(_type, "sanity.") || string::startsWith(_type, "system."))'

function getSanityType(value: unknown): string | null {
  if (value === undefined) return null
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'object') {
    if ('_ref' in value) return 'reference'
    return 'object'
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanKey(key: string): string {
  if (key.startsWith('.')) return key.slice(1)
  return key
}

interface AttributeCollector {
  add(document: unknown, documentType?: string): void
  readonly size: number
  result(): Attribute[]
  typesForAttribute(key: string, type: string): Set<string> | undefined
}

function createAttributeCollector(): AttributeCollector {
  const seen = new Set<string>()
  const attrs: Attribute[] = []
  const docTypesByAttr = new Map<string, Set<string>>()

  function walk(
    value: unknown,
    key: string,
    documentType: string | undefined,
    perDocSeen: Set<string> | null,
  ): void {
    const type = getSanityType(value)
    if (type === null) return

    const entry = key + '\0' + type
    const isNew = !seen.has(entry)
    if (isNew) {
      seen.add(entry)
      attrs.push({key, type})
    }

    if (documentType && perDocSeen && !perDocSeen.has(entry)) {
      perDocSeen.add(entry)
      const cleaned = key.charCodeAt(0) === 46 ? key.slice(1) + '\0' + type : entry
      let types = docTypesByAttr.get(cleaned)
      if (!types) {
        types = new Set()
        docTypesByAttr.set(cleaned, types)
      }
      types.add(documentType)
    }

    switch (type) {
      case 'array':
        if (Array.isArray(value)) {
          const childKey = key + '[]'
          for (let i = 0; i < value.length; i++) {
            walk(value[i], childKey, documentType, perDocSeen)
          }
        }
        break
      case 'object':
      case 'reference':
        if (isRecord(value)) {
          for (const childKey of Object.keys(value)) {
            walk(value[childKey], key + '.' + childKey, documentType, perDocSeen)
          }
        }
        break
    }
  }

  return {
    add(document: unknown, documentType?: string) {
      walk(document, '', documentType, documentType ? new Set() : null)
    },
    get size() {
      return seen.size
    },
    result() {
      return attrs
        .filter((attr) => attr.key !== '')
        .map((attr) => ({key: cleanKey(attr.key), type: attr.type}))
        .sort((a, b) => a.key.localeCompare(b.key))
    },
    typesForAttribute(key: string, type: string) {
      return docTypesByAttr.get(key + '\0' + type)
    },
  }
}

// ---------------------------------------------------------------------------
// CLI script
// ---------------------------------------------------------------------------

const {values} = parseArgs({
  options: {
    dataset: {type: 'string'},
    project: {type: 'string'},
    file: {type: 'string'},
  },
  allowPositionals: true,
})

const client = getCliClient(DEFAULT_STUDIO_CLIENT_OPTIONS).withConfig({
  ...(values.dataset && {dataset: values.dataset}),
  ...(values.project && {projectId: values.project}),
})

const PROGRESS_INTERVAL = 10_000

function isSanityDocument(value: unknown): value is SanityDocument {
  if (typeof value !== 'object' || value === null) return false
  return '_type' in value && typeof value._type === 'string' && '_id' in value && typeof value._id === 'string'
}

function isInternalType(type: string): boolean {
  return type.startsWith('sanity.') || type.startsWith('system.')
}

function parseDocument(line: string): SanityDocument | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!isSanityDocument(parsed)) return null
    if (isInternalType(parsed._type)) return null
    return parsed
  } catch {
    return null
  }
}

async function* readNdjsonFile(filePath: string): AsyncGenerator<SanityDocument> {
  process.stderr.write(`Reading from file: ${filePath}\n`)
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const doc = parseDocument(line)
    if (doc) yield doc
  }
}

async function* streamExport(): AsyncGenerator<SanityDocument> {
  const config = client.config()

  const types = await client.fetch<string[]>(
    `array::compact(array::unique(*[${INTERNAL_TYPE_FILTER}]._type))`,
  )

  process.stderr.write(`Streaming documents from \`/export\` endpoint...\n`)

  let cursor: string | null = ''
  let chunk = 1

  while (cursor !== null) {
    const exportUrl = new URL(client.getUrl(`/data/export/${config.dataset}`))
    exportUrl.searchParams.set('types', types.join(','))
    exportUrl.searchParams.set('nextCursor', cursor)

    const response = await fetch(exportUrl, {
      headers: {Authorization: `Bearer ${config.token}`},
    })

    if (!response.ok || !response.body) {
      throw new Error(`Export request failed: ${response.status} ${response.statusText}`)
    }

    cursor = null
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let remainder = ''

    try {
      while (true) {
        const {done, value} = await reader.read()
        if (done) break

        const text = remainder + decoder.decode(value, {stream: true})
        const lastNewline = text.lastIndexOf('\n')
        if (lastNewline === -1) {
          remainder = text
          continue
        }
        remainder = text.slice(lastNewline + 1)
        const lines = text.slice(0, lastNewline).split('\n')
        for (const line of lines) {
          yield* parseLine(line)
        }
      }
    } finally {
      reader.releaseLock()
    }

    if (remainder.trim()) {
      yield* parseLine(remainder)
    }

    if (cursor !== null) {
      chunk++
      process.stderr.write(`  Continuing export (chunk ${chunk})...\n`)
    }
  }

  function* parseLine(line: string): Generator<SanityDocument> {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed === 'object' && parsed !== null && 'nextCursor' in parsed && typeof parsed.nextCursor === 'string') {
        cursor = parsed.nextCursor
        return
      }
      if (isSanityDocument(parsed) && !isInternalType(parsed._type)) {
        yield parsed
      }
    } catch {
      // skip unparseable lines
    }
  }
}

async function main() {
  const config = client.config()

  const {
    fields: {
      count: {value: apiCount, limit: apiLimit},
    },
  } = await client.request<DatasetStats>({
    uri: `/data/stats/${config.dataset}`,
    method: 'GET',
  })

  const collector = createAttributeCollector()
  const docCounts = new Map<string, number>()
  let totalDocs = 0

  const source = values.file ? readNdjsonFile(values.file) : streamExport()

  for await (const doc of source) {
    totalDocs++
    collector.add(doc, doc._type)
    docCounts.set(doc._type, (docCounts.get(doc._type) ?? 0) + 1)

    if (totalDocs % PROGRESS_INTERVAL === 0) {
      process.stderr.write(
        `\r  ${totalDocs.toLocaleString()} docs | ${docCounts.size} types | ${collector.size.toLocaleString()} unique attrs`,
      )
    }
  }

  process.stderr.write(
    `\r  ${totalDocs.toLocaleString()} docs | ${docCounts.size} types | ${collector.size.toLocaleString()} unique attrs\n`,
  )

  const all = collector.result()

  const typeAttrCounts = new Map<string, number>()
  for (const attr of all) {
    const types = collector.typesForAttribute(attr.key, attr.type)
    if (types) {
      for (const typeName of types) {
        typeAttrCounts.set(typeName, (typeAttrCounts.get(typeName) ?? 0) + 1)
      }
    }
  }

  const perType = [...docCounts.entries()]
    .map(([type, docCount]) => ({type, count: typeAttrCounts.get(type) ?? 0, docCount}))
    .sort((a, b) => b.count - a.count)

  console.log()
  console.log(`ATTRIBUTE DIAGNOSTIC REPORT`)
  console.log(`==========================`)
  console.log(`Project:  ${config.projectId}`)
  console.log(`Dataset:  ${config.dataset}`)
  console.log(`Date:     ${new Date().toISOString()}`)
  console.log()
  console.log(`API count (includes sanity.*/system.*): ${apiCount.toLocaleString()}`)
  console.log(`Limit:                                 ${apiLimit.toLocaleString()}`)
  console.log(`Computed (user document types only):    ${all.length.toLocaleString()}`)
  console.log(`Document types:                        ${docCounts.size.toLocaleString()}`)
  console.log(`Total documents:                       ${totalDocs.toLocaleString()}`)
  console.log()
  console.log(`ATTRIBUTES BY TYPE (sorted by count)`)
  console.log(`------------------------------------`)
  for (const entry of perType) {
    console.log(
      `  ${entry.type.padEnd(40)} ${entry.count.toLocaleString().padStart(7)} attrs  ${entry.docCount.toLocaleString().padStart(8)} docs`,
    )
  }
  console.log()
  console.log(`ALL ATTRIBUTES (${all.length.toLocaleString()})`)
  console.log(`------------------------------------`)
  for (const attr of all) {
    console.log(`  ${attr.key.padEnd(60)} ${attr.type}`)
  }
}

const config = client.config()
process.stderr.write(`Targeting project: ${config.projectId}, dataset: ${config.dataset}\n`)

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})

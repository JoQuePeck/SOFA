import { ASTNode, Kind, NameNode } from 'graphql'

import xxhash, { XXHashAPI }  from 'xxhash-wasm'
import { logger } from '../logger'
import { createHash } from 'crypto'

let h32: ((input: string, seed?: number) => number) | undefined
let api: XXHashAPI

(async () => {
  api = await xxhash()
  h32 = api.h32
  logger.debug(`xxhash loaded`)
})()

function getContentHashInt(content: string) {
  if (h32 === undefined) {
    return createHash('md5').update(content).digest().readInt32BE(0)
  }
  return h32(content, 0x1234)
}

function normalizeNode(node: ASTNode): string {
  return buildStructuralSignature(node) as string
}

type HashNode = ASTNode & {
  hash?: number
}
let upNumber = 0

const MAX_DEPTH = 3
const MAX_ARRARY_LENGTH = 8

function buildStructuralSignature(node: HashNode, depth = 0): string | number {
  if (depth > MAX_DEPTH) {
    if (node.hash) {
      return node.hash
    }
    const tempHash = calculateNodeHash(node)
    node.hash = tempHash
    return node.hash
  }

  const parts: (string | number)[] = new Array(128)
  parts.push(node.kind)
  const nextDepth = depth + 1

  const pushArrayFunc = (node: HashNode) => {
    parts.push(node.hash || buildStructuralSignature(node, nextDepth + MAX_DEPTH))
  }
  const pushSimpelifiedFunc = (num: number) => {
    if (num >= MAX_ARRARY_LENGTH) {
      parts.push('RI', upNumber++)
      return true
    }
    return false
  }
  const pushArray = (nodes?: readonly HashNode[]) => {
    if (!nodes || pushSimpelifiedFunc(nodes?.length ?? 0)) return
    nodes?.forEach(pushArrayFunc)
  }

  switch (node.kind) {
    case Kind.FIELD:
      parts.push(getNamedNodeInfo(node.name))
      if (node.alias) parts.push('alias', getNamedNodeInfo(node.alias))
      pushArray(node.arguments)
      pushArray(node.directives)
      pushArray(node.selectionSet?.selections)
      break
    case Kind.FRAGMENT_SPREAD:
      parts.push(getNamedNodeInfo(node.name))
      pushArray(node.directives)
      break
    case Kind.INLINE_FRAGMENT:
      parts.push('typeCondition', getTypeSignature(node.typeCondition))
      pushArray(node.directives)
      pushArray(node.selectionSet.selections)
      break
    case Kind.OPERATION_DEFINITION:
      parts.push('OperationTypeNode', node.operation)
      parts.push(getNamedNodeInfo(node.name))

      pushArray(node.variableDefinitions)
      pushArray(node.directives)
      pushArray(node.selectionSet.selections)
      break
    case Kind.DOCUMENT:
      pushArray(node.definitions)
      break
    case Kind.FRAGMENT_DEFINITION:
      parts.push(
        parts.push(getNamedNodeInfo(node.name)),
        getTypeSignature(node.typeCondition)
      )
      pushArray(node.directives)
      pushArray(node.selectionSet.selections)
      break
    case Kind.SELECTION_SET:
      pushArray(node.selections)
      break
    case Kind.NAME:
      parts.push(parts.push(getNamedNodeInfo(node)))
      break
    case Kind.ARGUMENT:
      parts.push(parts.push(getNamedNodeInfo(node.name)), getValueSignature(node.value))
      break
    default:
      const isValueType = isValueNodeType(node)
      const isTypeNodeType = isTypeNode(node)
      if (isValueType) {
        parts.push(getValueSignature(node))
      } else if (isTypeNodeType) {
        parts.push(getTypeSignature(node))
      } else {
        parts.push(simplifyUnknownNode(node))
      }
      break
  }

  return parts.join()
}

const isTypeNode = (node: ASTNode) => {
  const kinds = [Kind.NAMED_TYPE, Kind.LIST_TYPE, Kind.NON_NULL_TYPE]
  return kinds.includes(node.kind)
}

function getTypeSignature(type?: HashNode): string | number {
  if (!type) return 'UNDEF'

  switch (type.kind) {
    case Kind.NAMED_TYPE:
      return getNamedNodeInfo(type.name)
    case Kind.LIST_TYPE:
      return `[${getTypeSignature(type.type)}]`
    case Kind.NON_NULL_TYPE:
      return `${getTypeSignature(type.type)}!`
    default:
      return 'UNKNOWN'
  }
}

const isValueNodeType = (node: ASTNode) => {
  const kinds = [
    Kind.STRING, Kind.INT, Kind.FLOAT, Kind.BOOLEAN, Kind.ENUM,
    Kind.NULL, Kind.VARIABLE, Kind.LIST, Kind.OBJECT
  ]
  return kinds.includes(node.kind)
}

function getValueSignature(value?: HashNode): string | number {
  if (!value) return 'UNDEF'

  switch (value.kind) {
    case Kind.STRING:
      return `S:${value.value}`
    case Kind.INT:
      return `I:${value.value}`
    case Kind.FLOAT:
      return `F:${value.value}`
    case Kind.BOOLEAN:
      return `B:${value.value}`
    case Kind.ENUM:
      return `E:${value.value}`
    case Kind.NULL:
      return 'NULL'
    case Kind.VARIABLE:
      return getNamedNodeInfo(value.name)
    case Kind.LIST:
      const listValues = value.values.map(getValueSignature).join(',')
      return `L:[${listValues}]`
    case Kind.OBJECT:
      const fields = value.fields.map((f: any) =>
        `${f.name.value}:${getValueSignature(f.value)}`
      ).join(',')
      return `O:{${fields}}`
    default:
      return 'UNKNOWN'
  }
}

function getNamedNodeInfo(node?: NameNode & HashNode) {
  if (node?.hash) return node.hash
  return `NameNode_${node?.value ?? 'UNDEF'}`
}

function calculateNodeHash(node: HashNode): number {
  const simplified = {
    kind: node.kind,
    name: extractNodeName(node),
    signature: extractNodeSignature(node)
  }
  const content = JSON.stringify(simplified)

  return getContentHashInt(content)
}

function extractNodeName(node: any): string | undefined {
  if (node.name?.value) return node.name.value
  if (node.operation) return node.operation
  return undefined
}

function extractNodeSignature(node: any): string {
  const features: string[] = []

  if (node.arguments?.length) {
    features.push(`args:${node.arguments.length}`)
  }
  if (node.selectionSet?.selections?.length) {
    features.push(`sels:${node.selectionSet.selections.length}`)
  }
  if (node.directives?.length) {
    features.push(`dirs:${node.directives.length}`)
  }
  if (node.variableDefinitions?.length) {
    features.push(`vars:${node.variableDefinitions.length}`)
  }

  return features.join(',')
}

function simplifyUnknownNode(node: HashNode): string {
  return JSON.stringify(node, (key, value) => {
    if (key === 'hash') {
      return undefined
    }
    return value
  })
}

function getNodeHash(node: HashNode): number {
  const content = normalizeNode(node)
  return getContentHashInt(content)
}

const nodeCache = new Map<string, Map<number, HashNode>>()

export function getCachedNode(node: HashNode): ASTNode {
  const hash: number = getNodeHash(node)
  const kind = node.kind

  if (!node.hash) {
    node.hash = hash
  }

  const kindCache = nodeCache.get(kind)
  if (kindCache && kindCache.has(hash)) {
    return kindCache.get(hash)!
  }

  if (!nodeCache.has(kind)) {
    nodeCache.set(kind, new Map<number, HashNode>())
  }

  nodeCache.get(kind)!.set(hash, node)
  return node
}

export function cleanCacheNode() {
  nodeCache.forEach(kindCache => {
    kindCache.forEach(node => clearNodeHashes(node))
    kindCache.clear()
  })
  nodeCache.clear()
  upNumber = 0
}

export function clearNodeHashes(node: HashNode): void {
  if (node.hash) {
    delete node.hash
  }
}
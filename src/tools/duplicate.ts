import { ASTNode, print } from 'graphql';
import { createHash } from 'crypto';

function normalizeNode(node: ASTNode): string {
  const clone = structuredClone(node);
  delete (clone as any).loc;
  delete (clone as any).description;
  return print(clone);
}

function getNodeHash(node: ASTNode): string {
  const content = normalizeNode(node);
  return createHash('sha256').update(content).digest('hex');
}

const nodeCache = new Map<string, ASTNode>();

export function getCachedNode(node: ASTNode): ASTNode {
  const hash = getNodeHash(node);
  
  if (nodeCache.has(hash)) {
    return nodeCache.get(hash)!;
  }
  
  nodeCache.set(hash, node);
  return node;
}

export function cleanCacheNode() {
    nodeCache.clear();
}
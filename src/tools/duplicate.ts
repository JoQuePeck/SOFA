import { ASTNode, print } from 'graphql';
import { createHash } from 'crypto';

// 标准化节点内容
function normalizeNode(node: ASTNode): string {
  const clone = structuredClone(node);
  delete (clone as any).loc;  // 移除位置信息
  delete (clone as any).description; // 移除描述
  return print(clone); // GraphQL 官方打印方法
}

// 生成内容哈希
function getNodeHash(node: ASTNode): string {
  const content = normalizeNode(node);
  return createHash('sha256').update(content).digest('hex');
}

// 使用缓存
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
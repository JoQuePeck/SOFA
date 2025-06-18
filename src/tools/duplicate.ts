import { createHash } from 'crypto';
import { ArgumentNode, ASTNode, ObjectFieldNode, ValueNode } from 'graphql';

// 替换原来的normalizeNode函数
function normalizeNode(node: ASTNode): string {
  return buildStructuralSignature(node);
}

type HashNode = ASTNode & {
  hash?: string
}

const MAX_DEPTH = 3

function buildStructuralSignature(node: HashNode, depth = 0): string {
  // 如果超过最大深度且节点已有hash，直接使用缓存的hash
  if (depth > MAX_DEPTH) {
    if (node.hash) {
      return `cached{${node.hash}}`;
    }
    // 如果没有hash，先计算并缓存
    const tempHash = calculateNodeHash(node);
    node.hash = tempHash;
    return `cached{${tempHash}}`;
  }

  const parts: string[] = [node.kind];
  const nextDepth = depth + 1;
  
  switch (node.kind) {
    case 'Field':
      parts.push('F');
      if (node.name) parts.push(node.name.value);
      
      // 处理别名
      if (node.alias) parts.push('AS', node.alias.value);
      
      // 处理参数
      if (node.arguments?.length) {
        parts.push('A');
        // 按参数名排序确保一致性
        const sortedArgs = (node.arguments as ArgumentNode[]).sort((a, b) => 
          a.name.value.localeCompare(b.name.value)
        );
        sortedArgs.forEach(arg => {
          parts.push(arg.name.value);
          parts.push(getValueSignature(arg.value));
        });
      }
      
      // 处理指令
      if (node.directives?.length) {
        parts.push('D');
        node.directives.forEach(dir => {
          parts.push(dir.name.value);
          if (dir.arguments?.length) {
            dir.arguments.forEach(arg => {
              parts.push(arg.name.value);
              parts.push(getValueSignature(arg.value));
            });
          }
        });
      }
      
      // 处理选择集
      if (node.selectionSet) {
        parts.push('S');
        node.selectionSet.selections.forEach(sel => {
          parts.push(buildStructuralSignature(sel, nextDepth));
        });
      }
      break;
      
    case 'FragmentSpread':
      parts.push('FS', node.name.value);
      if (node.directives?.length) {
        parts.push('D');
        node.directives.forEach(dir => {
          parts.push(dir.name.value);
          if (dir.arguments?.length) {
            dir.arguments.forEach(arg => {
              parts.push(arg.name.value);
              parts.push(getValueSignature(arg.value));
            });
          }
        });
      }
      break;
      
    case 'InlineFragment':
      parts.push('IF');
      if (node.typeCondition) {
        parts.push('T', node.typeCondition.name.value);
      }
      if (node.directives?.length) {
        parts.push('D');
        node.directives.forEach(dir => {
          parts.push(dir.name.value);
          if (dir.arguments?.length) {
            dir.arguments.forEach(arg => {
              parts.push(arg.name.value);
              parts.push(getValueSignature(arg.value));
            });
          }
        });
      }
      node.selectionSet.selections.forEach(sel => {
        parts.push(buildStructuralSignature(sel, nextDepth));
      });
      break;
      
    case 'OperationDefinition':
      parts.push('O', node.operation);
      if (node.name) parts.push(node.name.value);
      
      // 处理变量定义
      if (node.variableDefinitions?.length) {
        parts.push('V');
        // 按变量名排序
        const sortedVars = [...node.variableDefinitions].sort((a, b) =>
          a.variable.name.value.localeCompare(b.variable.name.value)
        );
        sortedVars.forEach(varDef => {
          parts.push(varDef.variable.name.value);
          parts.push(getTypeSignature(varDef.type));
          if (varDef.defaultValue) {
            parts.push('DEF', getValueSignature(varDef.defaultValue));
          }
        });
      }
      
      // 处理指令
      if (node.directives?.length) {
        parts.push('D');
        node.directives.forEach(dir => {
          parts.push(dir.name.value);
          if (dir.arguments?.length) {
            dir.arguments.forEach(arg => {
              parts.push(arg.name.value);
              parts.push(getValueSignature(arg.value));
            });
          }
        });
      }
      
      // 处理选择集
      node.selectionSet.selections.forEach(sel => {
        parts.push(buildStructuralSignature(sel, nextDepth));
      });
      break;
      
    case 'Document':
      parts.push('D');
      if (node.definitions) {
        node.definitions.forEach(def => {
          parts.push(buildStructuralSignature(def, nextDepth));
        });
      }
      break;
      
    case 'FragmentDefinition':
      parts.push('FD', node.name.value);
      parts.push('ON', node.typeCondition.name.value);
      if (node.directives?.length) {
        parts.push('D');
        node.directives.forEach(dir => {
          parts.push(dir.name.value);
          if (dir.arguments?.length) {
            dir.arguments.forEach(arg => {
              parts.push(arg.name.value);
              parts.push(getValueSignature(arg.value));
            });
          }
        });
      }
      node.selectionSet.selections.forEach(sel => {
        parts.push(buildStructuralSignature(sel, nextDepth));
      });
      break;
      
    default:
      // 对于其他节点类型，使用简化处理
      parts.push(JSON.stringify(simplifyUnknownNode(node, nextDepth)));
  }
  
  return parts.join('|');
}

// 单独的hash计算函数，用于超深度节点
function calculateNodeHash(node: HashNode): string {
  // 为超深度节点生成简化的hash
  const simplified = {
    kind: node.kind,
    // 提取关键标识符
    name: extractNodeName(node),
    // 添加一些关键属性来区分相似节点
    signature: extractNodeSignature(node)
  };
  
  const content = JSON.stringify(simplified);
  return createHash('sha256').update(content).digest('hex').substring(0, 12); // 使用短hash
}

function extractNodeName(node: any): string | undefined {
  if (node.name?.value) return node.name.value;
  if (node.operation) return node.operation;
  return undefined;
}

function extractNodeSignature(node: any): string {
  // 提取节点的关键特征，用于区分相似节点
  const features: string[] = [];
  
  if (node.arguments?.length) {
    features.push(`args:${node.arguments.length}`);
  }
  if (node.selectionSet?.selections?.length) {
    features.push(`sels:${node.selectionSet.selections.length}`);
  }
  if (node.directives?.length) {
    features.push(`dirs:${node.directives.length}`);
  }
  if (node.variableDefinitions?.length) {
    features.push(`vars:${node.variableDefinitions.length}`);
  }
  
  return features.join(',');
}

function getValueSignature(value: ValueNode): string {
  if (!value) return 'NULL';
  
  switch (value.kind) {
    case 'StringValue':
      return `S:${value.value}`;
    case 'IntValue':
      return `I:${value.value}`;
    case 'FloatValue':
      return `F:${value.value}`;
    case 'BooleanValue':
      return `B:${value.value}`;
    case 'EnumValue':
      return `E:${value.value}`;
    case 'NullValue':
      return 'NULL';
    case 'Variable':
      return `V:${value.name.value}`;
    case 'ListValue':
      const listValues = value.values.map(getValueSignature).join(',');
      return `L:[${listValues}]`;
    case 'ObjectValue':
      // 按字段名排序确保一致性
      const sortedFields = (value.fields as ObjectFieldNode[]).sort((a, b) =>
        a.name.value.localeCompare(b.name.value)
      );
      const fields = sortedFields.map((f: any) => 
        `${f.name.value}:${getValueSignature(f.value)}`
      ).join(',');
      return `O:{${fields}}`;
    default:
      return value.kind || 'UNKNOWN';
  }
}

function getTypeSignature(type: any): string {
  if (!type) return '';
  
  switch (type.kind) {
    case 'NamedType':
      return type.name.value;
    case 'ListType':
      return `[${getTypeSignature(type.type)}]`;
    case 'NonNullType':
      return `${getTypeSignature(type.type)}!`;
    default:
      return type.kind || '';
  }
}

function simplifyUnknownNode(node: HashNode, depth = 0): any {
  if (depth > MAX_DEPTH) {
    // 超深度时使用缓存hash
    if (node.hash) {
      return `cached{${node.hash}}`;
    }
    const tempHash = calculateNodeHash(node);
    node.hash = tempHash;
    return `cached{${tempHash}}`;
  }

  if (!node || typeof node !== 'object') return node;

  const nextDepth = depth + 1;
  
  if (Array.isArray(node)) {
    return node.map((n) => simplifyUnknownNode(n, nextDepth));
  }
  
  const simplified: any = { kind: node.kind };
  
  for (const [key, value] of Object.entries(node)) {
    // 跳过位置和描述信息以及hash缓存字段
    if (key === 'loc' || key === 'description' || key === 'hash') continue;
    
    // 处理name字段
    if (key === 'name' && value && typeof value === 'object' && 'value' in value) {
      simplified[key] = value.value;
    } else if (value && typeof value === 'object') {
      simplified[key] = simplifyUnknownNode(value, nextDepth);
    } else {
      simplified[key] = value;
    }
  }
  
  return simplified;
}

// 生成内容哈希
function getNodeHash(node: HashNode): string {
  const content = normalizeNode(node);
  return createHash('sha256').update(content).digest('hex');
}

// 使用缓存
const nodeCache = new Map<string, HashNode>();

export function getCachedNode(node: HashNode): ASTNode {
  const hash = getNodeHash(node);

  if (!node.hash) {
    node.hash = hash;
  }
  
  if (nodeCache.has(hash)) {
    return nodeCache.get(hash)!;
  }
  
  nodeCache.set(hash, node);
  return node;
}

export function cleanCacheNode() {
  nodeCache.clear();
}

// 额外的工具函数：清理节点上的hash缓存
export function clearNodeHashes(node: HashNode): void {
  if (node.hash) {
    delete node.hash;
  }
  
  // 递归清理子节点的hash
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        value.forEach(item => {
          if (item && typeof item === 'object' && 'kind' in item) {
            clearNodeHashes(item as HashNode);
          }
        });
      } else if ('kind' in value) {
        clearNodeHashes(value as HashNode);
      }
    }
  }
}
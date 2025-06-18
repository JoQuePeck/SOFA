import { createHash } from 'crypto';
import { ArgumentNode, ASTNode, ObjectFieldNode, ValueNode } from 'graphql';

function normalizeNode(node: ASTNode): string {
  return buildStructuralSignature(node);
}

type HashNode = ASTNode & {
  hash?: string
}

const MAX_DEPTH = 3

function buildStructuralSignature(node: HashNode, depth = 0): string {
  if (depth > MAX_DEPTH) {
    if (node.hash) {
      return `cached{${node.hash}}`;
    }
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

      if (node.alias) parts.push('AS', node.alias.value);

      if (node.arguments?.length) {
        parts.push('A');
        const sortedArgs = (node.arguments as ArgumentNode[]).sort((a, b) => 
          a.name.value.localeCompare(b.name.value)
        );
        sortedArgs.forEach(arg => {
          parts.push(arg.name.value);
          parts.push(getValueSignature(arg.value));
        });
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
      

      if (node.variableDefinitions?.length) {
        parts.push('V');

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
      parts.push(JSON.stringify(simplifyUnknownNode(node, nextDepth)));
  }
  return parts.join('|');
}


function calculateNodeHash(node: HashNode): string {
  const simplified = {
    kind: node.kind,
    name: extractNodeName(node),
    signature: extractNodeSignature(node)
  };

  const content = JSON.stringify(simplified);
  return createHash('sha256').update(content).digest('hex').substring(0, 12);
}

function extractNodeName(node: any): string | undefined {
  if (node.name?.value) return node.name.value;
  if (node.operation) return node.operation;
  return undefined;
}

function extractNodeSignature(node: any): string {
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
    if (key === 'loc' || key === 'description' || key === 'hash') continue;

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

function getNodeHash(node: HashNode): string {
  const content = normalizeNode(node);
  return createHash('sha256').update(content).digest('hex');
}

const nodeCache = new Map<string, ASTNode>();

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

export function clearNodeHashes(node: HashNode): void {
  if (node.hash) {
    delete node.hash;
  }

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
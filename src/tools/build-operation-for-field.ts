import {
  ArgumentNode,
  FieldNode,
  getNamedType,
  GraphQLArgument,
  GraphQLField,
  GraphQLInputType,
  GraphQLList,
  GraphQLNamedType,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  InlineFragmentNode,
  isEnumType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  Kind,
  ListTypeNode,
  NonNullTypeNode,
  OperationDefinitionNode,
  OperationTypeNode,
  SelectionNode,
  SelectionSetNode,
  TypeNode,
  VariableDefinitionNode,
} from 'graphql';
import { getDefinedRootType, getRootTypeNames } from './rootTypes.js';
import { getCachedNode } from './duplicate.js';

let operationVariables: VariableDefinitionNode[] = [];
let fieldTypeMap = new Map();

function addOperationVariable(variable: VariableDefinitionNode) {
  operationVariables.push(variable);
}

function resetOperationVariables() {
  operationVariables = [];
}

function resetFieldMap() {
  fieldTypeMap = new Map();
}

export type Skip = string[];
export type Force = string[];
export type Ignore = string[];

export type SelectedFields =
  | {
      [key: string]: SelectedFields;
    }
  | boolean;

export function buildOperationNodeForField({
  schema,
  kind,
  field,
  models,
  ignore = [],
  depthLimit,
  circularReferenceDepth,
  argNames,
  selectedFields = true,
}: {
  schema: GraphQLSchema;
  kind: OperationTypeNode;
  field: string;
  models?: string[];
  ignore?: Ignore;
  depthLimit?: number;
  circularReferenceDepth?: number;
  argNames?: string[];
  selectedFields?: SelectedFields;
}) {
  resetOperationVariables();
  resetFieldMap();

  const rootTypeNames = getRootTypeNames(schema);

  const operationNode = buildOperationAndCollectVariables({
    schema,
    fieldName: field,
    kind,
    models: models || [],
    ignore,
    depthLimit: depthLimit || Infinity,
    circularReferenceDepth: circularReferenceDepth || 1,
    argNames,
    selectedFields,
    rootTypeNames,
  });

  // attach variables
  (operationNode as any).variableDefinitions = [...operationVariables];

  resetOperationVariables();
  resetFieldMap();

  return operationNode;
}

// function saveShareSelectionNode() {

// }

function buildOperationAndCollectVariables({
  schema,
  fieldName,
  kind,
  models,
  ignore,
  depthLimit,
  circularReferenceDepth,
  argNames,
  selectedFields,
  rootTypeNames,
}: {
  schema: GraphQLSchema;
  fieldName: string;
  kind: OperationTypeNode;
  models: string[];
  ignore: Ignore;
  depthLimit: number;
  circularReferenceDepth: number;
  argNames?: string[];
  selectedFields: SelectedFields;
  rootTypeNames: Set<string>;
}): OperationDefinitionNode {
  const type = getDefinedRootType(schema, kind);
  const field = type.getFields()[fieldName];
  const operationName = `${fieldName}_${kind}`;

  if (field.args) {
    for (const arg of field.args) {
      const argName = arg.name;
      if (!argNames || argNames.includes(argName)) {
        addOperationVariable(resolveVariable(arg, argName));
      }
    }
  }

  return {
    kind: Kind.OPERATION_DEFINITION,
    operation: kind,
    name: {
      kind: Kind.NAME,
      value: operationName,
    },
    variableDefinitions: [],
    selectionSet: {
      kind: Kind.SELECTION_SET,
      selections: [
        resolveField({
          type,
          field,
          models,
          firstCall: true,
          path: [],
          ancestors: [],
          ignore,
          depthLimit,
          circularReferenceDepth,
          schema,
          depth: 0,
          argNames,
          selectedFields,
          rootTypeNames,
        }),
      ],
    },
  };
}

function resolveSelectionSet({
  parent,
  type,
  models,
  firstCall,
  path,
  ancestors,
  ignore,
  depthLimit,
  circularReferenceDepth,
  schema,
  depth,
  argNames,
  selectedFields,
  rootTypeNames,
}: {
  parent: GraphQLNamedType;
  type: GraphQLNamedType;
  models: string[];
  path: string[];
  ancestors: GraphQLNamedType[];
  firstCall?: boolean;
  ignore: Ignore;
  depthLimit: number;
  circularReferenceDepth: number;
  schema: GraphQLSchema;
  depth: number;
  selectedFields: SelectedFields;
  argNames?: string[];
  rootTypeNames: Set<string>;
}): SelectionSetNode | void {
  if (typeof selectedFields === 'boolean' && depth > depthLimit) {
    return;
  }

  if (isUnionType(type)) {
    const types = type.getTypes();
    const selections: InlineFragmentNode[] = [];
    
    // 避免创建中间数组，直接构建结果
    for (const t of types) {
      // 复用 ancestors 数组，避免展开
      ancestors.push(t);
      const hasCircular = hasCircularRef(ancestors, {
        depth: circularReferenceDepth,
      });
      ancestors.pop(); // 恢复原状态
      
      if (!hasCircular) {
        const selectionSet = resolveSelectionSet({
          parent: type,
          type: t,
          models,
          path,
          ancestors,
          ignore,
          depthLimit,
          circularReferenceDepth,
          schema,
          depth,
          argNames,
          selectedFields,
          rootTypeNames,
        }) as SelectionSetNode;
        
        // 只有当 selectionSet 有内容时才创建节点
        if (selectionSet?.selections?.length > 0) {
          selections.push({
            kind: Kind.INLINE_FRAGMENT,
            typeCondition: {
              kind: Kind.NAMED_TYPE,
              name: {
                kind: Kind.NAME,
                value: t.name,
              },
            },
            selectionSet,
          });
        }
      }
    }

    return selections.length > 0 ? {
      kind: Kind.SELECTION_SET,
      selections,
    } : undefined;
  }

  if (isInterfaceType(type)) {
    // 缓存类型映射查找结果，避免重复计算
    const typeMapValues = Object.values(schema.getTypeMap());
    const selections: InlineFragmentNode[] = [];
    
    for (const t of typeMapValues) {
      if (isObjectType(t) && t.getInterfaces().includes(type)) {
        // 复用 ancestors 数组
        ancestors.push(t as GraphQLObjectType);
        const hasCircular = hasCircularRef(ancestors, {
          depth: circularReferenceDepth,
        });
        ancestors.pop();
        
        if (!hasCircular) {
          const selectionSet = resolveSelectionSet({
            parent: type,
            type: t as GraphQLObjectType,
            models,
            path,
            ancestors,
            ignore,
            depthLimit,
            circularReferenceDepth,
            schema,
            depth,
            argNames,
            selectedFields,
            rootTypeNames,
          }) as SelectionSetNode;
          
          if (selectionSet?.selections?.length > 0) {
            selections.push({
              kind: Kind.INLINE_FRAGMENT,
              typeCondition: {
                kind: Kind.NAMED_TYPE,
                name: {
                  kind: Kind.NAME,
                  value: t.name,
                },
              },
              selectionSet,
            });
          }
        }
      }
    }

    return selections.length > 0 ? {
      kind: Kind.SELECTION_SET,
      selections,
    } : undefined;
  }

  if (isObjectType(type) && !rootTypeNames.has(type.name)) {
    const isIgnored =
      ignore.includes(type.name) || ignore.includes(`${parent.name}.${path[path.length - 1]}`);
    const isModel = models.includes(type.name);

    if (!firstCall && isModel && !isIgnored) {
      // 复用静态对象，避免重复创建
      return STATIC_ID_SELECTION_SET;
    }

    const fields = type.getFields();
    const fieldNames = Object.keys(fields);
    const selections: SelectionNode[] = [];

    // 直接遍历，避免创建中间数组
    for (const fieldName of fieldNames) {
      const field = fields[fieldName];
      const namedType = getNamedType(field.type);
      
      // 复用 ancestors 数组
      ancestors.push(namedType);
      const hasCircular = hasCircularRef(ancestors, {
        depth: circularReferenceDepth,
      });
      ancestors.pop();
      
      if (!hasCircular) {
        const selectedSubFields =
          typeof selectedFields === 'object' ? selectedFields[fieldName] : true;
        
        if (selectedSubFields) {
          // 复用 path 数组
          path.push(fieldName);
          const fieldSelection = resolveField({
            type,
            field,
            models,
            path,
            ancestors,
            ignore,
            depthLimit,
            circularReferenceDepth,
            schema,
            depth,
            argNames,
            selectedFields: selectedSubFields,
            rootTypeNames,
          });
          path.pop(); // 恢复原状态
          
          // 验证选择是否有效
          if (fieldSelection != null) {
            if ('selectionSet' in fieldSelection) {
              if (fieldSelection.selectionSet?.selections?.length || 0 > 0) {
                selections.push(fieldSelection);
              }
            } else {
              selections.push(fieldSelection);
            }
          }
        }
      }
    }

    return selections.length > 0 ? getCachedNode({
      kind: Kind.SELECTION_SET,
      selections,
    }) as SelectionSetNode : undefined;
  }
}

// 静态常量，避免重复创建相同的对象
const STATIC_ID_SELECTION_SET: SelectionSetNode = {
  kind: Kind.SELECTION_SET,
  selections: [
    {
      kind: Kind.FIELD,
      name: {
        kind: Kind.NAME,
        value: 'id',
      },
    },
  ],
};

function resolveVariable(arg: GraphQLArgument, name?: string): VariableDefinitionNode {
  function resolveVariableType(type: GraphQLList<any>): ListTypeNode;
  function resolveVariableType(type: GraphQLNonNull<any>): NonNullTypeNode;
  function resolveVariableType(type: GraphQLInputType): TypeNode;
  function resolveVariableType(type: GraphQLInputType): TypeNode {
    if (isListType(type)) {
      return {
        kind: Kind.LIST_TYPE,
        type: resolveVariableType(type.ofType),
      };
    }

    if (isNonNullType(type)) {
      return {
        kind: Kind.NON_NULL_TYPE,
        // for v16 compatibility
        type: resolveVariableType(type.ofType) as any,
      };
    }

    return {
      kind: Kind.NAMED_TYPE,
      name: {
        kind: Kind.NAME,
        value: type.name,
      },
    };
  }

  return getCachedNode({
    kind: Kind.VARIABLE_DEFINITION,
    variable: {
      kind: Kind.VARIABLE,
      name: {
        kind: Kind.NAME,
        value: name || arg.name,
      },
    },
    type: resolveVariableType(arg.type),
  }) as VariableDefinitionNode;
}

function getArgumentName(name: string, path: string[]): string {
  return [...path, name].join('_');
}

function resolveField({
  type,
  field,
  models,
  firstCall,
  path,
  ancestors,
  ignore,
  depthLimit,
  circularReferenceDepth,
  schema,
  depth,
  argNames,
  selectedFields,
  rootTypeNames,
}: {
  type: GraphQLObjectType;
  field: GraphQLField<any, any>;
  models: string[];
  path: string[];
  ancestors: GraphQLNamedType[];
  firstCall?: boolean;
  ignore: Ignore;
  depthLimit: number;
  circularReferenceDepth: number;
  schema: GraphQLSchema;
  depth: number;
  selectedFields: SelectedFields;
  argNames?: string[];
  rootTypeNames: Set<string>;
}): SelectionNode {
  const namedType = getNamedType(field.type);
  let args: ArgumentNode[] = [];
  let removeField = false;
  if (field.args && field.args.length) {
    // 预分配数组容量，避免动态扩容
    args = new Array<ArgumentNode>(field.args.length);
    let validArgsCount = 0;
    
    // 直接遍历，避免 map().filter() 创建中间数组
    for (let i = 0; i < field.args.length; i++) {
      const arg = field.args[i];
      const argumentName = getArgumentName(arg.name, path);
      
      if (argNames && !argNames.includes(argumentName)) {
        if (isNonNullType(arg.type)) {
          removeField = true;
          break; // 提前退出，避免继续处理
        }
        continue; // 跳过当前参数
      }
      
      if (!firstCall) {
        addOperationVariable(resolveVariable(arg, argumentName));
      }
      
      args[validArgsCount++] = {
        kind: Kind.ARGUMENT,
        name: {
          kind: Kind.NAME,
          value: arg.name,
        },
        value: {
          kind: Kind.VARIABLE,
          name: {
            kind: Kind.NAME,
            value: argumentName, // 复用已计算的值
          },
        },
      };
    }

    // 只保留有效的参数，避免稀疏数组
    if (validArgsCount < args.length) {
      args.length = validArgsCount;
    }
  }

  if (removeField) {
    return null as any;
  }

  // 复用 path 数组，避免创建新数组
  path.push(field.name);
  const fieldPathStr = path.join('.');
  path.pop(); // 恢复原状态

  let fieldName = field.name;
  const existingFieldType = fieldTypeMap.get(fieldPathStr);
  const currentFieldTypeStr = field.type.toString();
  
  if (existingFieldType && existingFieldType !== currentFieldTypeStr) {
    // 缓存类型字符串转换结果，避免重复计算
    fieldName += currentFieldTypeStr
      .replace(/!/g, 'NonNull')
      .replace(/\[/g, 'List')
      .replace(/\]/g, '');
  }
  fieldTypeMap.set(fieldPathStr, currentFieldTypeStr);
  
  // 预计算基础字段对象，避免重复创建
  const baseField: FieldNode = {
    kind: Kind.FIELD,
    name: {
      kind: Kind.NAME,
      value: field.name,
    },
    arguments: args,
  };
  
  // 只有在需要时才添加 alias
  if (fieldName !== field.name) {
    (baseField as any).alias = {
      kind: Kind.NAME,
      value: fieldName,
    };
  }
  
  if (!isScalarType(namedType) && !isEnumType(namedType)) {
    // 复用 path 和 ancestors 数组，避免展开操作
    path.push(field.name);
    ancestors.push(type);
    
    const selectionSet = resolveSelectionSet({
      parent: type,
      type: namedType,
      models,
      firstCall,
      path,
      ancestors,
      ignore,
      depthLimit,
      circularReferenceDepth,
      schema,
      depth: depth + 1,
      argNames,
      selectedFields,
      rootTypeNames,
    });
    
    // 恢复数组状态
    path.pop();
    ancestors.pop();
    
    // 只有在有选择集时才设置
    if (selectionSet) {
      (baseField as any).selectionSet = selectionSet;
    }
  }
  
  return getCachedNode(baseField) as SelectionNode;
}

function hasCircularRef(
  types: GraphQLNamedType[],
  config: {
    depth: number;
  } = {
    depth: 1,
  },
): boolean {
  const type = types[types.length - 1];

  if (isScalarType(type)) {
    return false;
  }

  const size = types.filter(t => t.name === type.name).length;
  return size > config.depth;
}

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
  NamedTypeNode,
  NameNode,
  NonNullTypeNode,
  OperationDefinitionNode,
  OperationTypeNode,
  SelectionNode,
  SelectionSetNode,
  TypeNode,
  VariableDefinitionNode,
  VariableNode,
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
  (operationNode as any).variableDefinitions = operationVariables;

  resetOperationVariables();
  resetFieldMap();

  return operationNode;
}

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
          ancestors: new Array(128),
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

    for (const t of types) {
      ancestors.push(t);
      const hasCircular = hasCircularRef(ancestors, {
        depth: circularReferenceDepth,
      })
      ancestors.pop()
      if (hasCircular) continue

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
      }) as SelectionSetNode

      if (selectionSet?.selections?.length == 0) continue

      selections.push(getCachedNode({
        kind: Kind.INLINE_FRAGMENT,
        typeCondition: getCachedNode({
          kind: Kind.NAMED_TYPE,
          name: getCachedNode({
            kind: Kind.NAME,
            value: t.name,
          }) as NameNode,
        }) as NamedTypeNode,
        selectionSet,
      }) as InlineFragmentNode)
    }

    return selections.length > 0 ? getCachedNode({
      kind: Kind.SELECTION_SET,
      selections,
    }) as SelectionSetNode : undefined;
  }

  if (isInterfaceType(type)) {
    const typeMapValues = Object.values(schema.getTypeMap());
    const selections: InlineFragmentNode[] = [];

    for (const t of typeMapValues) {
      if (isObjectType(t) && t.getInterfaces().includes(type)) {
        ancestors.push(t as GraphQLObjectType);
        const hasCircular = hasCircularRef(ancestors, {
          depth: circularReferenceDepth,
        })
        ancestors.pop()

        if (hasCircular) continue

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
        }) as SelectionSetNode

        if (selectionSet?.selections?.length == 0) continue

        selections.push(getCachedNode({
          kind: Kind.INLINE_FRAGMENT,
          typeCondition: getCachedNode({
            kind: Kind.NAMED_TYPE,
            name: getCachedNode({
              kind: Kind.NAME,
              value: t.name,
            }) as NameNode,
          }) as NamedTypeNode,
          selectionSet,
        }) as InlineFragmentNode)
      }
    }

    return selections.length > 0 ? getCachedNode({
      kind: Kind.SELECTION_SET,
      selections,
    }) as SelectionSetNode : undefined;
  }

  if (isObjectType(type) && !rootTypeNames.has(type.name)) {
    const isIgnored =
      ignore.includes(type.name) || ignore.includes(`${parent.name}.${path[path.length - 1]}`);
    const isModel = models.includes(type.name);

    if (!firstCall && isModel && !isIgnored) {
      return STATIC_ID_SELECTION_SET;
    }

    const fields = type.getFields();
    const fieldNames = Object.keys(fields);
    const selections: SelectionNode[] = [];

    for (const fieldName of fieldNames) {
      const field = fields[fieldName];
      const namedType = getNamedType(field.type);

      ancestors.push(namedType)
      const hasCircular = hasCircularRef(ancestors, {
        depth: circularReferenceDepth,
      })
      ancestors.pop()

      if (hasCircular) continue

      const selectedSubFields =
        typeof selectedFields === 'object' ? selectedFields[fieldName] : true

      if (!selectedSubFields) continue
      path.push(fieldName)
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
      })
      path.pop()

      if (fieldSelection == null) continue

      if ('selectionSet' in fieldSelection) {
        if (fieldSelection.selectionSet?.selections?.length || 0 > 0) {
          selections.push(fieldSelection)
        }
      } else {
        selections.push(fieldSelection)
      }
    }

    return selections.length > 0 ? getCachedNode({
      kind: Kind.SELECTION_SET,
      selections,
    }) as SelectionSetNode : undefined;
  }
}

const STATIC_ID_SELECTION_SET = getCachedNode({
  kind: Kind.SELECTION_SET,
  selections: [
    getCachedNode({
      kind: Kind.FIELD,
      name: getCachedNode({
        kind: Kind.NAME,
        value: 'id',
      }) as NameNode,
    }) as SelectionNode,
  ],
}) as SelectionSetNode;

function resolveVariable(arg: GraphQLArgument, name?: string): VariableDefinitionNode {
  function resolveVariableType(type: GraphQLList<any>): ListTypeNode;
  function resolveVariableType(type: GraphQLNonNull<any>): NonNullTypeNode;
  function resolveVariableType(type: GraphQLInputType): TypeNode;
  function resolveVariableType(type: GraphQLInputType): TypeNode {
    if (isListType(type)) {
      return getCachedNode({
        kind: Kind.LIST_TYPE,
        type: resolveVariableType(type.ofType),
      }) as TypeNode;
    }

    if (isNonNullType(type)) {
      return getCachedNode({
        kind: Kind.NON_NULL_TYPE,
        // for v16 compatibility
        type: resolveVariableType(type.ofType) as any,
      }) as TypeNode;
    }

    return getCachedNode({
      kind: Kind.NAMED_TYPE,
      name: getCachedNode({
        kind: Kind.NAME,
        value: type.name,
      }) as NameNode,
    }) as TypeNode;
  }

  return getCachedNode({
    kind: Kind.VARIABLE_DEFINITION,
    variable: getCachedNode({
      kind: Kind.VARIABLE,
      name: getCachedNode({
        kind: Kind.NAME,
        value: name || arg.name,
      }) as NameNode,
    }) as VariableNode,
    type: resolveVariableType(arg.type),
  }) as VariableDefinitionNode;
}

function getArgumentName(name: string, path: string[]): string {
  if(path.length === 0) return name
  return `${path.join('_')}_${name}`
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
    args = new Array<ArgumentNode>(field.args.length)
    let validArgsCount = 0
    
    for (let i = 0; i < field.args.length; i++) {
      const arg = field.args[i]
      const argumentName = getArgumentName(arg.name, path)
      
      if (argNames && !argNames.includes(argumentName)) {
        if (isNonNullType(arg.type)) {
          removeField = true
          break
        }
        continue
      }

      if (!firstCall) {
        addOperationVariable(resolveVariable(arg, argumentName));
      }

      args[validArgsCount++] = getCachedNode({
        kind: Kind.ARGUMENT,
        name: getCachedNode({
          kind: Kind.NAME,
          value: arg.name,
        }) as NameNode,
        value: getCachedNode({
          kind: Kind.VARIABLE,
          name: getCachedNode({
            kind: Kind.NAME,
            value: argumentName,
          }) as NameNode,
        }) as VariableNode,
      }) as ArgumentNode
    }

    if (validArgsCount < args.length) {
      args.length = validArgsCount
    }
  }

  if (removeField) {
    return null as any
  }

  path.push(field.name)
  const fieldPathStr = path.join('.')
  path.pop()

  let fieldName = field.name
  const existingFieldType = fieldTypeMap.get(fieldPathStr)
  const currentFieldTypeStr = field.type.toString()

  if (existingFieldType && existingFieldType !== currentFieldTypeStr) {
    fieldName += currentFieldTypeStr
      .replace(/!/g, 'NonNull')
      .replace(/\[/g, 'List')
      .replace(/\]/g, '')
  }
  fieldTypeMap.set(fieldPathStr, currentFieldTypeStr)

  const baseField: FieldNode = {
    kind: Kind.FIELD,
    name: getCachedNode({
      kind: Kind.NAME,
      value: field.name,
    }) as NameNode,
    arguments: args,
  }

  if (fieldName !== field.name) {
    (baseField as any).alias = getCachedNode({
      kind: Kind.NAME,
      value: fieldName,
    }) as NameNode
  }

  if (!isScalarType(namedType) && !isEnumType(namedType)) {
    path.push(field.name)
    ancestors.push(type)

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
    })

    path.pop()
    ancestors.pop()

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
